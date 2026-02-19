import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import { Construct } from "constructs";
import * as path from "path";
import { execSync } from "child_process";

export interface SpaEmbedProps {
  /** S3 bucket to deploy the SPA into. */
  bucket: s3.IBucket;
  /** CloudFront origin for the bucket (used in behaviors). */
  origin: cloudfront.IOrigin;
  /** URL path prefix without slashes (e.g. "s3ui" → /s3ui/). */
  prefix: string;
  /** Path to the s3ui project root. Defaults to two levels up from this file. */
  sourcePath?: string;
}

/**
 * Embeds the s3ui SPA into an existing bucket + CloudFront distribution.
 *
 * Usage:
 *   const spaEmbed = new SpaEmbed(this, 'SpaEmbed', { bucket, origin, prefix: 's3ui' });
 *   // Merge spaEmbed.additionalBehaviors into your distribution's additionalBehaviors
 *   // Then call spaEmbed.deploy(distribution) after the distribution is created.
 */
export class SpaEmbed extends Construct {
  /** Merge these into the CloudFront Distribution's additionalBehaviors. */
  public readonly additionalBehaviors: Record<
    string,
    cloudfront.BehaviorOptions
  >;

  private readonly bucket: s3.IBucket;
  private readonly prefix: string;
  private readonly sourcePath: string;

  constructor(scope: Construct, id: string, props: SpaEmbedProps) {
    super(scope, id);

    this.bucket = props.bucket;
    this.prefix = props.prefix;
    this.sourcePath = props.sourcePath ?? path.join(__dirname, "../..");

    const rewriteFunction = new cloudfront.Function(this, "SpaRewrite", {
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri === '/${this.prefix}' || uri === '/${this.prefix}/') {
    request.uri = '/${this.prefix}/index.html';
    return request;
  }
  if (uri.startsWith('/${this.prefix}/') && !uri.match(/\\.[a-zA-Z0-9]+$/)) {
    request.uri = '/${this.prefix}/index.html';
    return request;
  }
  return request;
}
      `),
    });

    const behavior: cloudfront.BehaviorOptions = {
      origin: props.origin,
      viewerProtocolPolicy:
        cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      functionAssociations: [
        {
          function: rewriteFunction,
          eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
        },
      ],
    };

    this.additionalBehaviors = {
      [`/${this.prefix}`]: behavior,
      [`/${this.prefix}/*`]: behavior,
    };
  }

  /** Call after the distribution is created to build + deploy the SPA. */
  deploy(distribution: cloudfront.Distribution): void {
    const prefix = this.prefix;
    const sourcePath = this.sourcePath;

    new s3deploy.BucketDeployment(this, "Deploy", {
      sources: [
        s3deploy.Source.asset(sourcePath, {
          bundling: {
            local: {
              tryBundle(outputDir: string) {
                execSync(
                  `npm ci && VITE_API_URL='/api' npx vite build --base=/${prefix}/ --outDir=${outputDir}`,
                  { cwd: sourcePath, stdio: "inherit" },
                );
                return true;
              },
            },
            image: cdk.DockerImage.fromRegistry("node:20"),
            command: [
              "bash",
              "-c",
              `npm ci && VITE_API_URL='/api' npx vite build --base=/${prefix}/ --outDir=/asset-output`,
            ],
          },
        }),
      ],
      destinationBucket: this.bucket,
      destinationKeyPrefix: prefix,
      distribution,
      distributionPaths: [`/${prefix}/*`],
    });
  }
}
