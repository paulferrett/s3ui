import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  CloudFrontClient,
  CreateInvalidationCommand,
} from "@aws-sdk/client-cloudfront";
import { authenticate } from "./auth.js";
import sharp from "sharp";
import { analyzeImage } from "./describe.js";

const s3 = new S3Client({});
const cf = new CloudFrontClient({});
const BUCKETS: string[] = JSON.parse(process.env.BUCKETS ?? "[]");
const AUTH_MODE = process.env.AUTH_MODE ?? "setup";
const SITE_URL = process.env.SITE_URL;
const DISTRIBUTION_ID = process.env.DISTRIBUTION_ID;
const DIR_CONFIG_FILE = process.env.DIR_CONFIG_FILE ?? ".s3ui.json";
const UPLOAD_CONCURRENCY = Number(process.env.UPLOAD_CONCURRENCY ?? "10");

interface TransformSpec {
  key: string;
  width?: number;
  height?: number;
  fit?: string;
  quality?: number;
  format?: string;
}

const TRANSFORMS: TransformSpec[] = JSON.parse(
  process.env.TRANSFORMS ?? "[]",
);
const TRANSFORM_PREFIXES = TRANSFORMS.map((t) => `${t.key}/`);

const IMAGE_EXTENSIONS = new Set([
  "jpeg",
  "jpg",
  "png",
  "webp",
  "avif",
  "gif",
  "tiff",
]);

function isImage(key: string): boolean {
  const ext = key.split(".").pop()?.toLowerCase();
  return !!ext && IMAGE_EXTENSIONS.has(ext);
}

function isTransformOutput(key: string): boolean {
  return TRANSFORM_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function validBucket(bucket: string | undefined): bucket is string {
  return !!bucket && BUCKETS.includes(bucket);
}

/** Normalize a filename: lowercase, spaces/underscores to hyphens, strip special chars, collapse runs. */
function sanitizeFilename(name: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot === -1 ? name : name.substring(0, dot);
  const ext = dot === -1 ? "" : name.substring(dot).toLowerCase();

  const clean = base
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")   // strip diacritics
    .toLowerCase()
    .replace(/[\s_]+/g, "-")           // spaces/underscores → hyphen
    .replace(/[^a-z0-9\-]/g, "")       // strip everything else
    .replace(/-{2,}/g, "-")            // collapse multiple hyphens
    .replace(/^-|-$/g, "");            // trim leading/trailing hyphens

  return (clean || "file") + ext;
}

/** Normalize only the filename part of a key, preserving the directory prefix. */
function sanitizeKey(key: string): string {
  const lastSlash = key.lastIndexOf("/");
  if (lastSlash === -1) return sanitizeFilename(key);
  return key.substring(0, lastSlash + 1) + sanitizeFilename(key.substring(lastSlash + 1));
}

function contentTypeToMime(ct: string | undefined): string {
  if (!ct) return "application/octet-stream";
  return ct;
}

// --- Dir config helpers ---

interface PhotoMeta {
  file: string;
  description: string;
  altText: string;
  tags: string[];
  quality: number;
  generated: string;
}

interface DirConfig {
  order?: string[];
  photoMetas?: PhotoMeta[];
}

async function readDirConfig(bucket: string, prefix: string): Promise<{ config: DirConfig; etag?: string }> {
  const key = prefix + DIR_CONFIG_FILE;
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = await res.Body?.transformToString();
    return { config: body ? JSON.parse(body) : {}, etag: res.ETag };
  } catch (err: unknown) {
    if (err && typeof err === "object" && "name" in err && (err as { name: string }).name === "NoSuchKey") return { config: {} };
    return { config: {} };
  }
}

async function writeDirConfigSafe(
  bucket: string,
  prefix: string,
  config: DirConfig,
  etag?: string,
): Promise<void> {
  const key = prefix + DIR_CONFIG_FILE;
  const params: Record<string, unknown> = {
    Bucket: bucket,
    Key: key,
    Body: JSON.stringify(config, null, 2),
    ContentType: "application/json",
  };
  // Conditional write: If-Match on existing, If-None-Match on new
  if (etag) {
    (params as Record<string, string>).IfMatch = etag;
  } else {
    (params as Record<string, string>).IfNoneMatch = "*";
  }
  await s3.send(new PutObjectCommand(params as Parameters<typeof s3.send>[0] extends { input: infer I } ? I : never));
}

/** Read-merge-write with optimistic concurrency. Retries on conflict. */
async function mergeDirConfig(
  bucket: string,
  prefix: string,
  updater: (config: DirConfig) => DirConfig,
  maxRetries = 3,
): Promise<DirConfig> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const { config, etag } = await readDirConfig(bucket, prefix);
    const merged = updater(config);
    try {
      await writeDirConfigSafe(bucket, prefix, merged, etag);
      return merged;
    } catch (err: unknown) {
      const code = (err as { name?: string })?.name ?? "";
      if ((code === "PreconditionFailed" || code === "ConditionalCheckFailedException") && attempt < maxRetries) {
        const delay = 200 + Math.random() * 300 * (attempt + 1);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw new Error("mergeDirConfig: max retries exceeded");
}

function applyOrder<T>(items: T[], getFilename: (item: T) => string, order?: string[]): T[] {
  if (!order || order.length === 0) return items;
  const orderIndex = new Map(order.map((name, i) => [name, i]));
  return [...items].sort((a, b) => {
    const ai = orderIndex.get(getFilename(a));
    const bi = orderIndex.get(getFilename(b));
    if (ai !== undefined && bi !== undefined) return ai - bi;
    if (ai !== undefined) return -1;
    if (bi !== undefined) return 1;
    return getFilename(a).localeCompare(getFilename(b));
  });
}

// Parallel HeadObject with concurrency limit
async function headObjectsParallel(
  bucket: string,
  keys: string[],
  concurrency: number,
): Promise<
  Map<
    string,
    { size: number; lastModified: string; contentType: string; width: number | null; height: number | null }
  >
> {
  const results = new Map<
    string,
    { size: number; lastModified: string; contentType: string; width: number | null; height: number | null }
  >();
  let idx = 0;

  async function next(): Promise<void> {
    while (idx < keys.length) {
      const key = keys[idx++];
      try {
        const head = await s3.send(
          new HeadObjectCommand({ Bucket: bucket, Key: key }),
        );
        const meta = head.Metadata ?? {};
        results.set(key, {
          size: head.ContentLength ?? 0,
          lastModified: head.LastModified?.toISOString() ?? "",
          contentType: contentTypeToMime(head.ContentType),
          width: meta.width ? Number(meta.width) : null,
          height: meta.height ? Number(meta.height) : null,
        });
      } catch (err) {
        console.error(`HeadObject failed for ${key}:`, err);
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, keys.length) }, () => next());
  await Promise.all(workers);
  return results;
}

export async function handler(event: {
  requestContext: { http: { method: string; path: string } };
  headers: Record<string, string>;
  queryStringParameters?: Record<string, string>;
  body?: string;
}) {
  const { method, path } = event.requestContext.http;
  const query = event.queryStringParameters ?? {};
  const authHeader =
    event.headers["authorization"] ?? event.headers["Authorization"];

  // --- Public endpoint ---
  if (method === "GET" && path === "/api/auth-info") {
    return json(200, {
      mode: AUTH_MODE,
      buckets: BUCKETS,
      dirConfigFile: DIR_CONFIG_FILE,
      uploadConcurrency: UPLOAD_CONCURRENCY,
      siteUrl: SITE_URL ?? "",
      transforms: TRANSFORMS.map((t) => ({
        key: t.key,
        ...(t.width && { width: t.width }),
        ...(t.height && { height: t.height }),
        ...(t.format && { format: t.format }),
      })),
    });
  }

  // --- Auth required ---
  if (!(await authenticate(authHeader))) {
    return json(401, { error: "Unauthorized" });
  }

  // GET /api/objects?bucket=&prefix=
  if (method === "GET" && path === "/api/objects") {
    const bucket = query.bucket;
    if (!validBucket(bucket)) return json(400, { error: "Invalid bucket" });

    const prefix = query.prefix ?? "";
    const result = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        Delimiter: "/",
      }),
    );

    const objects = (result.Contents ?? [])
      .filter((o) => o.Key !== prefix && !o.Key?.endsWith("/" + DIR_CONFIG_FILE))
      .map((o) => ({
        key: o.Key!,
        size: o.Size ?? 0,
        lastModified: o.LastModified?.toISOString() ?? "",
      }));

    const { config: dirConfig } = await readDirConfig(bucket, prefix);
    const ordered = applyOrder(objects, (o) => o.key.slice(prefix.length), dirConfig.order);

    const describedFiles = (dirConfig.photoMetas ?? []).map((m) => m.file);

    return json(200, {
      folders: (result.CommonPrefixes ?? []).map((p) => p.Prefix),
      objects: ordered,
      describedFiles,
    });
  }

  // GET /api/presign/get?bucket=&key=
  if (method === "GET" && path === "/api/presign/get") {
    const bucket = query.bucket;
    const key = query.key;
    if (!validBucket(bucket) || !key)
      return json(400, { error: "Invalid bucket or key" });

    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: bucket, Key: key }),
      { expiresIn: 3600 },
    );
    return json(200, { url });
  }

  // POST /api/presign/put
  if (method === "POST" && path === "/api/presign/put") {
    const body = JSON.parse(event.body ?? "{}");
    const { bucket, contentType } = body;
    const key = body.key as string | undefined;
    if (!validBucket(bucket) || !key)
      return json(400, { error: "Invalid bucket or key" });

    const normalizedKey = sanitizeKey(key);
    const url = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: bucket,
        Key: normalizedKey,
        ContentType: contentType,
      }),
      { expiresIn: 600 },
    );
    return json(200, { url, key: normalizedKey });
  }

  // DELETE /api/objects?bucket=&key=
  if (method === "DELETE" && path === "/api/objects") {
    const bucket = query.bucket;
    const key = query.key;
    if (!validBucket(bucket) || !key)
      return json(400, { error: "Invalid bucket or key" });

    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    return json(200, { ok: true });
  }

  // GET /api/manifest?bucket=
  if (method === "GET" && path === "/api/manifest") {
    const bucket = query.bucket;
    if (!validBucket(bucket)) return json(400, { error: "Invalid bucket" });

    // Paginated ListObjectsV2 — full bucket scan
    const allKeys: string[] = [];
    let continuationToken: string | undefined;

    do {
      const result = await s3.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          ContinuationToken: continuationToken,
        }),
      );

      for (const obj of result.Contents ?? []) {
        const key = obj.Key;
        if (!key) continue;
        // Skip transform outputs and non-images
        if (isTransformOutput(key)) continue;
        if (!isImage(key)) continue;
        allKeys.push(key);
      }

      continuationToken = result.NextContinuationToken;
    } while (continuationToken);

    // HeadObject on each image (parallel, concurrency 20)
    const headData = await headObjectsParallel(bucket, allKeys, 20);

    // Group by directory
    const dirMap = new Map<
      string,
      Array<{
        file: string;
        width: number | null;
        height: number | null;
        type: string;
        size: number;
        added: string;
      }>
    >();

    for (const key of allKeys) {
      const data = headData.get(key);
      if (!data) continue;

      const lastSlash = key.lastIndexOf("/");
      const dir = lastSlash === -1 ? "" : key.substring(0, lastSlash);
      const file = lastSlash === -1 ? key : key.substring(lastSlash + 1);

      if (!dirMap.has(dir)) dirMap.set(dir, []);
      dirMap.get(dir)!.push({
        file,
        width: data.width,
        height: data.height,
        type: data.contentType,
        size: data.size,
        added: data.lastModified,
      });
    }

    // Read dir configs in parallel for ordering
    const dirNames = Array.from(dirMap.keys());
    const dirConfigs = new Map<string, DirConfig>();
    await Promise.all(
      dirNames.map(async (dir) => {
        const cfgPrefix = dir ? dir + "/" : "";
        const { config: cfg } = await readDirConfig(bucket, cfgPrefix);
        dirConfigs.set(dir, cfg);
      }),
    );

    // Sort dirs and files (applying custom order per directory), merge photoMetas
    const dirs = Array.from(dirMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dir, files]) => {
        const cfg = dirConfigs.get(dir);
        const metaMap = new Map((cfg?.photoMetas ?? []).map((m) => [m.file, m]));
        const ordered = applyOrder(files, (f) => f.file, cfg?.order);
        return {
          dir,
          files: ordered.map((f) => {
            const meta = metaMap.get(f.file);
            return {
              ...f,
              ...(meta && {
                description: meta.description,
                altText: meta.altText,
                tags: meta.tags,
                quality: meta.quality,
                analyzed: meta.generated,
              }),
            };
          }),
        };
      });

    return json(200, {
      bucket,
      urlBase: SITE_URL ?? "",
      transforms: TRANSFORMS.map((t) => ({
        key: t.key,
        ...(t.width && { width: t.width }),
        ...(t.height && { height: t.height }),
        fit: t.fit ?? "inside",
        quality: t.quality ?? 80,
        ...(t.format && { format: t.format }),
      })),
      dirs,
    });
  }

  // GET /api/dir-config?bucket=&prefix=
  if (method === "GET" && path === "/api/dir-config") {
    const bucket = query.bucket;
    if (!validBucket(bucket)) return json(400, { error: "Invalid bucket" });
    const prefix = query.prefix ?? "";
    const { config } = await readDirConfig(bucket, prefix);
    return json(200, config);
  }

  // POST /api/dir-config  body: { bucket, prefix, config }
  if (method === "POST" && path === "/api/dir-config") {
    const body = JSON.parse(event.body ?? "{}");
    const { bucket, prefix, config } = body;
    if (!validBucket(bucket)) return json(400, { error: "Invalid bucket" });
    const pfx = prefix ?? "";
    await mergeDirConfig(bucket, pfx, (existing) => ({ ...existing, ...config }));
    return json(200, { ok: true });
  }

  // POST /api/rotate  body: { bucket, key, direction: "cw" | "ccw" }
  if (method === "POST" && path === "/api/rotate") {
    const body = JSON.parse(event.body ?? "{}");
    const { bucket, key, direction } = body;
    if (!validBucket(bucket) || !key)
      return json(400, { error: "Invalid bucket or key" });
    if (direction !== "cw" && direction !== "ccw")
      return json(400, { error: "Invalid direction, must be 'cw' or 'ccw'" });

    try {
      // Download the original image
      const getRes = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const buf = Buffer.from(await getRes.Body!.transformToByteArray());
      const contentType = getRes.ContentType ?? "image/jpeg";

      // Rotate with sharp (cw = 90°, ccw = -90°)
      const angle = direction === "cw" ? 90 : -90;
      const rotated = await sharp(buf).rotate(angle).toBuffer();

      // Re-upload to same key
      await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: rotated,
        ContentType: contentType,
      }));

      // Delete existing transform outputs so S3 event triggers regeneration
      const cfPaths: string[] = [];
      if (TRANSFORM_PREFIXES.length > 0) {
        const ext = key.split(".").pop()?.toLowerCase() ?? "";
        const baseName = key.lastIndexOf(".") !== -1 ? key.substring(0, key.lastIndexOf(".")) : key;
        const keysToDelete: string[] = [];
        for (const t of TRANSFORMS) {
          const tExt = t.format ?? ext;
          const tKey = `${t.key}/${baseName}.${tExt}`;
          keysToDelete.push(tKey);
          cfPaths.push(`/${tKey}`);
        }
        if (keysToDelete.length > 0) {
          await s3.send(new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: keysToDelete.map((k) => ({ Key: k })) },
          }));
        }
      }

      // Invalidate CloudFront cache for the original + transform paths
      if (DISTRIBUTION_ID) {
        cfPaths.push(`/${key}`);
        try {
          await cf.send(new CreateInvalidationCommand({
            DistributionId: DISTRIBUTION_ID,
            InvalidationBatch: {
              CallerReference: `rotate-${Date.now()}`,
              Paths: { Quantity: cfPaths.length, Items: cfPaths },
            },
          }));
        } catch (cfErr) {
          console.error("CloudFront invalidation failed:", cfErr);
          // Non-fatal — rotation still succeeded
        }
      }

      return json(200, { ok: true });
    } catch (err) {
      console.error("Rotate failed:", err);
      return json(500, { error: "Rotate failed" });
    }
  }

  // POST /api/describe  body: { bucket, key }
  if (method === "POST" && path === "/api/describe") {
    const body = JSON.parse(event.body ?? "{}");
    const { bucket, key: imageKey } = body;
    if (!validBucket(bucket) || !imageKey)
      return json(400, { error: "Invalid bucket or key" });
    if (!isImage(imageKey))
      return json(400, { error: "Not an image" });

    try {
      const getRes = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: imageKey }));
      const buf = Buffer.from(await getRes.Body!.transformToByteArray());

      // Resize large images to fit within Claude's 5MB base64 limit
      let imageBuf = buf;
      if (buf.length > 4.5 * 1024 * 1024) {
        imageBuf = await sharp(buf)
          .rotate()
          .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toBuffer();
      }

      const imageBase64 = imageBuf.toString("base64");
      const ext = imageKey.split(".").pop()?.toLowerCase();
      // If we resized, output is always JPEG
      const mediaType = (imageBuf !== buf) ? "image/jpeg" as const
        : ext === "png" ? "image/png" as const
        : ext === "gif" ? "image/gif" as const
        : ext === "webp" ? "image/webp" as const
        : "image/jpeg" as const;

      const result = await analyzeImage(imageBase64, mediaType);

      const lastSlash = imageKey.lastIndexOf("/");
      const prefix = lastSlash === -1 ? "" : imageKey.substring(0, lastSlash + 1);
      const filename = lastSlash === -1 ? imageKey : imageKey.substring(lastSlash + 1);

      const meta: PhotoMeta = {
        file: filename,
        ...result,
        generated: new Date().toISOString(),
      };

      // Merge with optimistic concurrency
      await mergeDirConfig(bucket, prefix, (cfg) => {
        const metas = cfg.photoMetas ?? [];
        const idx = metas.findIndex((m) => m.file === filename);
        if (idx >= 0) metas[idx] = meta;
        else metas.push(meta);
        return { ...cfg, photoMetas: metas };
      });

      return json(200, { ok: true, meta });
    } catch (err) {
      console.error("Describe failed:", err);
      return json(500, { error: "Describe failed" });
    }
  }

  return json(404, { error: "Not found" });
}
