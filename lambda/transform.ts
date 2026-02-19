import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  CopyObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import sharp from "sharp";

interface TransformSpec {
  key: string;
  width?: number;
  height?: number;
  fit?: "cover" | "contain" | "fill" | "inside" | "outside";
  quality?: number;
  format?: "jpeg" | "webp" | "avif" | "png";
}

interface S3EventRecord {
  s3: {
    bucket: { name: string };
    object: { key: string };
  };
}

const s3 = new S3Client({});
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

const FORMAT_CONTENT_TYPES: Record<string, string> = {
  jpeg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
  png: "image/png",
};

function contentTypeForFormat(format: string): string {
  return FORMAT_CONTENT_TYPES[format] ?? "application/octet-stream";
}

function outputKey(transformKey: string, originalKey: string, format?: string): string {
  let out = `${transformKey}/${originalKey}`;
  if (format) {
    const lastDot = out.lastIndexOf(".");
    if (lastDot !== -1) {
      out = `${out.substring(0, lastDot)}.${format}`;
    }
  }
  return out;
}

export async function handler(event: { Records: S3EventRecord[] }) {
  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(
      record.s3.object.key.replace(/\+/g, " "),
    );

    // Loop prevention — skip transform outputs
    if (isTransformOutput(key)) continue;

    // Only process images
    if (!isImage(key)) continue;

    try {
      // Download original
      const getResult = await s3.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      );
      const body = await getResult.Body!.transformToByteArray();
      const buffer = Buffer.from(body);

      // Get dimensions (after auto-orientation from EXIF)
      const metadata = await sharp(buffer).metadata();
      const orientation = metadata.orientation ?? 1;
      // EXIF orientations 5-8 swap width/height
      const rotated = orientation >= 5;
      const width = rotated ? metadata.height : metadata.width;
      const height = rotated ? metadata.width : metadata.height;

      // Store dimensions on original via copy-to-self
      if (width && height) {
        // First get existing metadata to preserve it
        const headResult = await s3.send(
          new HeadObjectCommand({ Bucket: bucket, Key: key }),
        );
        await s3.send(
          new CopyObjectCommand({
            Bucket: bucket,
            CopySource: `${bucket}/${encodeURIComponent(key)}`,
            Key: key,
            MetadataDirective: "REPLACE",
            ContentType: headResult.ContentType,
            Metadata: {
              ...headResult.Metadata,
              width: String(width),
              height: String(height),
            },
          }),
        );
      }

      // Generate transforms
      for (const spec of TRANSFORMS) {
        try {
          let pipeline = sharp(buffer).rotate().resize({
            width: spec.width,
            height: spec.height,
            fit: spec.fit ?? "inside",
            withoutEnlargement: true,
          });

          const fmt = spec.format ?? metadata.format ?? "jpeg";
          const quality = spec.quality ?? 80;
          pipeline = pipeline.toFormat(fmt as keyof sharp.FormatEnum, {
            quality,
          });

          const transformed = await pipeline.toBuffer();
          const destKey = outputKey(spec.key, key, spec.format);

          await s3.send(
            new PutObjectCommand({
              Bucket: bucket,
              Key: destKey,
              Body: transformed,
              ContentType: contentTypeForFormat(fmt),
              Metadata: {
                "source-key": key,
                "transform": spec.key,
              },
            }),
          );
        } catch (err) {
          console.error(
            `Transform ${spec.key} failed for ${bucket}/${key}:`,
            err,
          );
        }
      }
    } catch (err) {
      console.error(`Processing failed for ${bucket}/${key}:`, err);
    }
  }
}
