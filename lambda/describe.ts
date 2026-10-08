import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import Anthropic from "@anthropic-ai/sdk";

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

interface S3EventRecord {
  s3: {
    bucket: { name: string };
    object: { key: string };
  };
}

const s3 = new S3Client({});
const DIR_CONFIG_FILE = process.env.DIR_CONFIG_FILE ?? ".s3ui.json";

const TRANSFORMS: { key: string }[] = JSON.parse(
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

function extToMediaType(
  key: string,
): "image/jpeg" | "image/png" | "image/gif" | "image/webp" {
  const ext = key.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    default:
      return "image/jpeg";
  }
}

async function readDirConfig(
  bucket: string,
  prefix: string,
): Promise<{ config: DirConfig; etag?: string }> {
  const key = prefix + DIR_CONFIG_FILE;
  try {
    const res = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    const body = await res.Body?.transformToString();
    return { config: body ? JSON.parse(body) : {}, etag: res.ETag };
  } catch {
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

const describeImageTool: Anthropic.Tool = {
  name: "describe_image",
  description: "Provide structured metadata for the image",
  input_schema: {
    type: "object" as const,
    properties: {
      description: {
        type: "string",
        description: "1-2 sentence description of the image content",
      },
      altText: {
        type: "string",
        description: "Concise alt text for an <img> tag",
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description:
          "3-8 descriptive tags, e.g. ['bedroom', 'tropical', 'interior']",
      },
      quality: {
        type: "number",
        description:
          "Image quality rating 1-5 (1=poor/blurry, 5=professional/stunning)",
      },
    },
    required: ["description", "altText", "tags", "quality"],
  },
};

export async function analyzeImage(
  imageBase64: string,
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp",
): Promise<Omit<PhotoMeta, "file" | "generated">> {
  const anthropic = new Anthropic();
  const model = process.env.AI_MODEL ?? "claude-haiku-5-5";
  const systemPrompt =
    process.env.AI_SYSTEM_PROMPT ??
    "Describe images accurately and concisely.";

  const response = await anthropic.messages.create({
    model,
    max_tokens: 1024,
    system: systemPrompt,
    tools: [describeImageTool],
    tool_choice: { type: "tool", name: "describe_image" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: imageBase64 },
          },
          {
            type: "text",
            text: "Analyze this image. Use the describe_image tool to provide a description, alt text, tags, and quality rating.",
          },
        ],
      },
    ],
  });

  const toolBlock = response.content.find((b) => b.type === "tool_use");
  if (!toolBlock || toolBlock.type !== "tool_use") {
    throw new Error("No tool_use response from Claude");
  }

  const input = toolBlock.input as {
    description: string;
    altText: string;
    tags: string[];
    quality: number;
  };

  return {
    description: input.description,
    altText: input.altText,
    tags: input.tags,
    quality: Math.max(1, Math.min(5, Math.round(input.quality))),
  };
}

/** Extract S3 event records from either direct S3 events or SNS-wrapped S3 events. */
function extractS3Records(event: { Records: Array<S3EventRecord | { Sns?: { Message: string } }> }): S3EventRecord[] {
  const records: S3EventRecord[] = [];
  for (const record of event.Records) {
    if ("Sns" in record && record.Sns) {
      const s3Event = JSON.parse(record.Sns.Message) as { Records?: S3EventRecord[] };
      if (s3Event.Records) records.push(...s3Event.Records);
    } else {
      records.push(record as S3EventRecord);
    }
  }
  return records;
}

export async function handler(event: { Records: Array<S3EventRecord | { Sns?: { Message: string } }> }) {
  for (const record of extractS3Records(event)) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(
      record.s3.object.key.replace(/\+/g, " "),
    );

    // Loop prevention
    if (isTransformOutput(key)) continue;
    if (!isImage(key)) continue;
    if (key.endsWith(DIR_CONFIG_FILE)) continue;

    const lastSlash = key.lastIndexOf("/");
    const prefix = lastSlash === -1 ? "" : key.substring(0, lastSlash + 1);
    const filename = lastSlash === -1 ? key : key.substring(lastSlash + 1);

    try {
      // Check if already described
      const { config: existing } = await readDirConfig(bucket, prefix);
      if (existing.photoMetas?.some((m) => m.file === filename)) {
        console.log(`Already described: ${bucket}/${key}`);
        continue;
      }

      // Download image
      const getResult = await s3.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      );
      const body = await getResult.Body!.transformToByteArray();

      // Skip images exceeding Claude's 5MB base64 limit
      // (large images can be analyzed on-demand via the API which resizes with sharp)
      if (body.length > 4.5 * 1024 * 1024) {
        console.log(`Skipping large image (${body.length} bytes, exceeds 5MB API limit): ${key}`);
        continue;
      }

      const imageBase64 = Buffer.from(body).toString("base64");
      const mediaType = extToMediaType(key);

      console.log(`Analyzing: ${bucket}/${key}`);
      const result = await analyzeImage(imageBase64, mediaType);

      // Merge into .s3ui.json with optimistic concurrency
      await mergeDirConfig(bucket, prefix, (cfg) => {
        const metas = cfg.photoMetas ?? [];
        const idx = metas.findIndex((m) => m.file === filename);
        const meta: PhotoMeta = {
          file: filename,
          ...result,
          generated: new Date().toISOString(),
        };
        if (idx >= 0) {
          metas[idx] = meta;
        } else {
          metas.push(meta);
        }
        return { ...cfg, photoMetas: metas };
      });

      console.log(`Described: ${bucket}/${key} → ${result.description}`);
    } catch (err) {
      console.error(`Describe failed for ${bucket}/${key}:`, err);
    }
  }
}
