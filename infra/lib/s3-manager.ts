import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigwv2Integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as route53Targets from "aws-cdk-lib/aws-route53-targets";
import { Construct } from "constructs";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as path from "path";
import { execSync } from "child_process";

// --- Public interfaces ---

export interface BucketConfig {
  name: string;
  create?: boolean;
  versioned?: boolean;
}

export type S3ManagerAuth =
  | { mode: "setup"; username: string; password: string }
  | { mode: "auth0"; domain: string; audience: string }
  | {
      mode: "both";
      username: string;
      password: string;
      domain: string;
      audience: string;
    };

export interface S3ManagerDomain {
  domainName: string;
  hostedZoneId: string;
  zoneName: string;
}

export interface TransformSpec {
  key: string;
  width?: number;
  height?: number;
  fit?: "cover" | "contain" | "fill" | "inside" | "outside";
  quality?: number;
  format?: "jpeg" | "webp" | "avif" | "png";
}

export interface S3ManagerProps {
  buckets: BucketConfig[];
  auth: S3ManagerAuth;
  domain?: S3ManagerDomain;
  transforms?: TransformSpec[];
  /** Filename used as directory marker, default: ".s3ui.json" */
  dirConfigFile?: string;
  /** Max concurrent browser uploads, default: 10 */
  uploadConcurrency?: number;
  /**
   * Build and deploy the SPA to the SPA bucket during `cdk deploy`.
   * Pass the absolute path to the s3ui project root, or true to auto-detect
   * (assumes the standard project layout: infra/ is one level below the project root).
   */
  deploySpa?: boolean | string;
}

// --- Construct ---

export class S3Manager extends Construct {
  public readonly spaBucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;
  public readonly assetBuckets: s3.IBucket[];

  constructor(scope: Construct, id: string, props: S3ManagerProps) {
    super(scope, id);

    const stack = cdk.Stack.of(this);

    // --- Asset Buckets ---
    this.assetBuckets = [];
    const bucketNames: string[] = [];
    const createdBuckets: s3.Bucket[] = [];

    for (const cfg of props.buckets) {
      let bucket: s3.IBucket;

      if (cfg.create) {
        const created = new s3.Bucket(this, `Bucket-${cfg.name}`, {
          bucketName: cfg.name,
          blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
          removalPolicy: cdk.RemovalPolicy.RETAIN,
          versioned: cfg.versioned ?? false,
          cors: [
            {
              allowedMethods: [s3.HttpMethods.PUT],
              allowedOrigins: ["*"],
              allowedHeaders: ["*"],
              maxAge: 3600,
            },
          ],
        });
        bucket = created;
        createdBuckets.push(created);
      } else {
        bucket = s3.Bucket.fromBucketName(
          this,
          `Bucket-${cfg.name}`,
          cfg.name,
        );
      }

      this.assetBuckets.push(bucket);
      bucketNames.push(cfg.name);
    }

    // --- SPA Bucket ---
    this.spaBucket = new s3.Bucket(this, "SpaBucket", {
      bucketName: `s3-manager-spa-${stack.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // --- Auth env vars ---
    const authMode = props.auth.mode;
    const lambdaEnv: Record<string, string> = {
      BUCKETS: JSON.stringify(bucketNames),
      AUTH_MODE: authMode,
    };

    if (props.auth.mode === "setup" || props.auth.mode === "both") {
      lambdaEnv.SETUP_USERNAME = props.auth.username;
      lambdaEnv.SETUP_PASSWORD = props.auth.password;
    }
    if (props.auth.mode === "auth0" || props.auth.mode === "both") {
      lambdaEnv.AUTH0_DOMAIN = props.auth.domain;
      lambdaEnv.AUTH0_AUDIENCE = props.auth.audience;
    }

    // --- Config env ---
    const dirConfigFile = props.dirConfigFile ?? ".s3ui.json";
    const uploadConcurrency = props.uploadConcurrency ?? 10;
    lambdaEnv.DIR_CONFIG_FILE = dirConfigFile;
    lambdaEnv.UPLOAD_CONCURRENCY = String(uploadConcurrency);

    // --- Transforms env ---
    const transforms = props.transforms ?? [];
    const transformsJson = JSON.stringify(transforms);
    if (transforms.length > 0) {
      lambdaEnv.TRANSFORMS = transformsJson;
    }

    // --- API Lambda ---
    const handler = new lambdaNodejs.NodejsFunction(this, "ApiHandler", {
      entry: path.join(__dirname, "../../lambda/handler.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 128,
      timeout: cdk.Duration.seconds(transforms.length > 0 ? 30 : 10),
      environment: lambdaEnv,
      bundling: {
        minify: true,
        sourceMap: false,
        target: "es2022",
        format: lambdaNodejs.OutputFormat.ESM,
        externalModules: [],
      },
    });

    for (const bucket of this.assetBuckets) {
      bucket.grantReadWrite(handler);
    }

    // --- HTTP API ---
    const httpApi = new apigwv2.HttpApi(this, "HttpApi", {
      description: "S3 Asset Manager API",
    });

    const integration = new apigwv2Integrations.HttpLambdaIntegration(
      "LambdaIntegration",
      handler,
    );

    httpApi.addRoutes({
      path: "/api/{proxy+}",
      methods: [
        apigwv2.HttpMethod.GET,
        apigwv2.HttpMethod.POST,
        apigwv2.HttpMethod.DELETE,
      ],
      integration,
    });

    // --- CloudFront ---
    const s3Origin = origins.S3BucketOrigin.withOriginAccessControl(
      this.spaBucket,
    );

    const apiOrigin = new origins.HttpOrigin(
      `${httpApi.httpApiId}.execute-api.${stack.region}.amazonaws.com`,
    );

    const spaRewriteFunction = new cloudfront.Function(this, "SpaRewrite", {
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri.startsWith('/api/')) return request;
  if (uri.match(/\\.[a-zA-Z0-9]+$/)) return request;
  request.uri = '/index.html';
  return request;
}
      `),
      functionName: `s3-manager-spa-rewrite`,
    });

    // Optional custom domain
    let certificate: acm.ICertificate | undefined;
    let distributionDomainNames: string[] | undefined;

    if (props.domain) {
      const { domainName, hostedZoneId, zoneName } = props.domain;
      certificate = new acm.DnsValidatedCertificate(this, "Certificate", {
        domainName,
        hostedZone: route53.HostedZone.fromHostedZoneAttributes(
          this,
          "HostedZone",
          { hostedZoneId, zoneName },
        ),
        region: "us-east-1",
      });
      distributionDomainNames = [domainName];
    }

    this.distribution = new cloudfront.Distribution(this, "Distribution", {
      defaultBehavior: {
        origin: s3Origin,
        viewerProtocolPolicy:
          cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        functionAssociations: [
          {
            function: spaRewriteFunction,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          },
        ],
      },
      additionalBehaviors: {
        "/api/*": {
          origin: apiOrigin,
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy:
            cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        },
      },
      defaultRootObject: "index.html",
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: cdk.Duration.minutes(5),
        },
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: cdk.Duration.minutes(5),
        },
      ],
      ...(certificate && {
        certificate,
        domainNames: distributionDomainNames,
      }),
    });

    // Set SITE_URL on API Lambda now that distribution exists
    if (transforms.length > 0) {
      const siteUrl = props.domain
        ? `https://${props.domain.domainName}`
        : `https://${this.distribution.distributionDomainName}`;
      handler.addEnvironment("SITE_URL", siteUrl);
    }

    // Route53 records
    if (props.domain) {
      const { domainName, hostedZoneId, zoneName } = props.domain;
      const zone = route53.HostedZone.fromHostedZoneAttributes(
        this,
        "DnsZone",
        { hostedZoneId, zoneName },
      );
      const target = route53.RecordTarget.fromAlias(
        new route53Targets.CloudFrontTarget(this.distribution),
      );
      new route53.ARecord(this, "AliasA", {
        zone,
        recordName: domainName,
        target,
      });
      new route53.AaaaRecord(this, "AliasAAAA", {
        zone,
        recordName: domainName,
        target,
      });
    }

    // --- Transform Lambda (only when transforms configured) ---
    if (transforms.length > 0) {
      const lambdaDir = path.join(__dirname, "../../lambda");
      const transformHandler = new lambdaNodejs.NodejsFunction(
        this,
        "TransformHandler",
        {
          entry: path.join(lambdaDir, "transform.ts"),
          handler: "handler",
          runtime: lambda.Runtime.NODEJS_20_X,
          memorySize: 1024,
          timeout: cdk.Duration.minutes(2),
          projectRoot: path.join(__dirname, "../.."),
          depsLockFilePath: path.join(lambdaDir, "package-lock.json"),
          environment: {
            TRANSFORMS: transformsJson,
          },
          bundling: {
            minify: true,
            sourceMap: false,
            target: "es2022",
            format: lambdaNodejs.OutputFormat.ESM,
            nodeModules: ["sharp"],
            forceDockerBundling: true,
          },
        },
      );

      for (const bucket of this.assetBuckets) {
        bucket.grantReadWrite(transformHandler);
      }

      // S3 event notifications — only on created buckets (imported buckets can't add notifications via CDK)
      for (const bucket of createdBuckets) {
        bucket.addEventNotification(
          s3.EventType.OBJECT_CREATED,
          new s3n.LambdaDestination(transformHandler),
        );
      }
    }

    // --- SPA deployment ---
    if (props.deploySpa) {
      const spaRoot =
        typeof props.deploySpa === "string"
          ? props.deploySpa
          : path.join(__dirname, "../..");

      new s3deploy.BucketDeployment(this, "SpaDeploy", {
        sources: [
          s3deploy.Source.asset(spaRoot, {
            bundling: {
              local: {
                tryBundle(outputDir: string) {
                  execSync("npm ci && npx vite build --outDir " + outputDir, {
                    cwd: spaRoot,
                    stdio: "inherit",
                  });
                  return true;
                },
              },
              // Fallback Docker bundling
              image: cdk.DockerImage.fromRegistry("node:20"),
              command: [
                "bash",
                "-c",
                "npm ci && npx vite build --outDir /asset-output",
              ],
            },
          }),
        ],
        destinationBucket: this.spaBucket,
        distribution: this.distribution,
        distributionPaths: ["/*"],
        cacheControl: [
          s3deploy.CacheControl.fromString(
            "public, max-age=31536000, immutable",
          ),
        ],
      });
    }

    // --- Outputs ---
    new cdk.CfnOutput(this, "SpaBucketName", {
      value: this.spaBucket.bucketName,
    });
    new cdk.CfnOutput(this, "DistributionId", {
      value: this.distribution.distributionId,
    });
    new cdk.CfnOutput(this, "SiteUrl", {
      value: props.domain
        ? `https://${props.domain.domainName}`
        : `https://${this.distribution.distributionDomainName}`,
    });
    new cdk.CfnOutput(this, "ApiUrl", {
      value: httpApi.apiEndpoint,
    });
  }
}
