import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { authenticate } from "./auth.js";

const s3 = new S3Client({});
const BUCKETS: string[] = JSON.parse(process.env.BUCKETS ?? "[]");
const AUTH_MODE = process.env.AUTH_MODE ?? "setup";
const SITE_URL = process.env.SITE_URL;
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

    return json(200, {
      folders: (result.CommonPrefixes ?? []).map((p) => p.Prefix),
      objects: (result.Contents ?? [])
        .filter((o) => o.Key !== prefix && !o.Key?.endsWith("/" + DIR_CONFIG_FILE))
        .map((o) => ({
          key: o.Key,
          size: o.Size,
          lastModified: o.LastModified?.toISOString(),
        })),
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

    // Sort dirs and files
    const dirs = Array.from(dirMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dir, files]) => ({
        dir,
        files: files.sort((a, b) => a.file.localeCompare(b.file)),
      }));

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

  return json(404, { error: "Not found" });
}
