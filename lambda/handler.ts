import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { authenticate } from "./auth.js";

const s3 = new S3Client({});
const BUCKETS: string[] = JSON.parse(process.env.BUCKETS ?? "[]");
const AUTH_MODE = process.env.AUTH_MODE ?? "setup";

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
    return json(200, { mode: AUTH_MODE, buckets: BUCKETS });
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
        .filter((o) => o.Key !== prefix) // exclude the prefix itself
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
    const { bucket, key, contentType } = body;
    if (!validBucket(bucket) || !key)
      return json(400, { error: "Invalid bucket or key" });

    const url = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentType,
      }),
      { expiresIn: 600 },
    );
    return json(200, { url });
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

  return json(404, { error: "Not found" });
}
