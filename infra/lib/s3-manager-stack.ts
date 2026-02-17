import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
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
import * as path from "path";

interface BucketConfig {
  name: string;
  create?: boolean;
  import?: boolean;
  versioned?: boolean;
}

export class S3ManagerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // --- Context ---
    const bucketConfigs = this.node.tryGetContext("buckets") as BucketConfig[];
    if (!bucketConfigs || bucketConfigs.length === 0) {
      throw new Error("Context 'buckets' is required");
    }

    const setupUsername = this.node.tryGetContext("setupUsername") as
      | string
      | undefined;
    const setupPassword = this.node.tryGetContext("setupPassword") as
      | string
      | undefined;
    const auth0Domain = this.node.tryGetContext("auth0Domain") as
      | string
      | undefined;
    const auth0Audience = this.node.tryGetContext("auth0Audience") as
      | string
      | undefined;
    const domainName = this.node.tryGetContext("domainName") as
      | string
      | undefined;
    const hostedZoneId = this.node.tryGetContext("hostedZoneId") as
      | string
      | undefined;
    const zoneName = this.node.tryGetContext("zoneName") as
      | string
      | undefined;

    // Determine auth mode
    const hasSetup = setupUsername && setupPassword;
    const hasAuth0 = auth0Domain && auth0Audience;
    let authMode: string;
    if (hasSetup && hasAuth0) authMode = "both";
    else if (hasAuth0) authMode = "auth0";
    else if (hasSetup) authMode = "setup";
    else throw new Error("Provide setupUsername/setupPassword or auth0Domain/auth0Audience");

    // --- Asset Buckets ---
    const assetBuckets: s3.IBucket[] = [];
    const bucketNames: string[] = [];

    for (const cfg of bucketConfigs) {
      let bucket: s3.IBucket;

      if (cfg.create) {
        bucket = new s3.Bucket(this, `Bucket-${cfg.name}`, {
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
      } else {
        bucket = s3.Bucket.fromBucketName(this, `Bucket-${cfg.name}`, cfg.name);
      }

      assetBuckets.push(bucket);
      bucketNames.push(cfg.name);
    }

    // --- SPA Bucket ---
    const spaBucket = new s3.Bucket(this, "SpaBucket", {
      bucketName: `s3-manager-spa-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // --- Lambda ---
    const lambdaEnv: Record<string, string> = {
      BUCKETS: JSON.stringify(bucketNames),
      AUTH_MODE: authMode,
    };
    if (setupUsername) lambdaEnv.SETUP_USERNAME = setupUsername;
    if (setupPassword) lambdaEnv.SETUP_PASSWORD = setupPassword;
    if (auth0Domain) lambdaEnv.AUTH0_DOMAIN = auth0Domain;
    if (auth0Audience) lambdaEnv.AUTH0_AUDIENCE = auth0Audience;

    const handler = new lambdaNodejs.NodejsFunction(this, "ApiHandler", {
      entry: path.join(__dirname, "../../lambda/handler.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 128,
      timeout: cdk.Duration.seconds(10),
      environment: lambdaEnv,
      bundling: {
        minify: true,
        sourceMap: false,
        target: "es2022",
        format: lambdaNodejs.OutputFormat.ESM,
        externalModules: [],
      },
    });

    for (const bucket of assetBuckets) {
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
    const s3Origin = origins.S3BucketOrigin.withOriginAccessControl(spaBucket);

    const apiOrigin = new origins.HttpOrigin(
      `${httpApi.httpApiId}.execute-api.${this.region}.amazonaws.com`,
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

    if (domainName && hostedZoneId && zoneName) {
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

    const distribution = new cloudfront.Distribution(this, "Distribution", {
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

    // Route53 records
    if (domainName && hostedZoneId && zoneName) {
      const zone = route53.HostedZone.fromHostedZoneAttributes(
        this,
        "DnsZone",
        { hostedZoneId, zoneName },
      );
      const target = route53.RecordTarget.fromAlias(
        new route53Targets.CloudFrontTarget(distribution),
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

    // --- Outputs ---
    new cdk.CfnOutput(this, "SpaBucketName", {
      value: spaBucket.bucketName,
    });
    new cdk.CfnOutput(this, "DistributionId", {
      value: distribution.distributionId,
    });
    new cdk.CfnOutput(this, "SiteUrl", {
      value: domainName
        ? `https://${domainName}`
        : `https://${distribution.distributionDomainName}`,
    });
    new cdk.CfnOutput(this, "ApiUrl", {
      value: httpApi.apiEndpoint,
    });
  }
}
