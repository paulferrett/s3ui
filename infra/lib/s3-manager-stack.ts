import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import {
  S3Manager,
  S3ManagerAuth,
  S3ManagerDomain,
  BucketConfig,
  TransformSpec,
} from "./s3-manager";

export class S3ManagerStack extends cdk.Stack {
  public readonly manager: S3Manager;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // --- Read CDK context ---
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

    const hasSetup = setupUsername && setupPassword;
    const hasAuth0 = auth0Domain && auth0Audience;

    let auth: S3ManagerAuth;
    if (hasSetup && hasAuth0) {
      auth = {
        mode: "both",
        username: setupUsername,
        password: setupPassword,
        domain: auth0Domain,
        audience: auth0Audience,
      };
    } else if (hasAuth0) {
      auth = { mode: "auth0", domain: auth0Domain, audience: auth0Audience };
    } else if (hasSetup) {
      auth = { mode: "setup", username: setupUsername, password: setupPassword };
    } else {
      throw new Error(
        "Provide setupUsername/setupPassword or auth0Domain/auth0Audience",
      );
    }

    // Optional domain
    const domainName = this.node.tryGetContext("domainName") as
      | string
      | undefined;
    const hostedZoneId = this.node.tryGetContext("hostedZoneId") as
      | string
      | undefined;
    const zoneName = this.node.tryGetContext("zoneName") as
      | string
      | undefined;

    let domain: S3ManagerDomain | undefined;
    if (domainName && hostedZoneId && zoneName) {
      domain = { domainName, hostedZoneId, zoneName };
    }

    // Optional transforms (string from -c flag, array from cdk.json)
    const transformsRaw = this.node.tryGetContext("transforms") as
      | TransformSpec[]
      | string
      | undefined;
    const transforms =
      typeof transformsRaw === "string"
        ? (JSON.parse(transformsRaw) as TransformSpec[])
        : transformsRaw;

    // Optional config
    const dirConfigFile = this.node.tryGetContext("dirConfigFile") as
      | string
      | undefined;
    const uploadConcurrencyRaw = this.node.tryGetContext("uploadConcurrency") as
      | string
      | number
      | undefined;
    const uploadConcurrency = uploadConcurrencyRaw
      ? Number(uploadConcurrencyRaw)
      : undefined;

    this.manager = new S3Manager(this, "S3Manager", {
      buckets: bucketConfigs,
      auth,
      domain,
      transforms,
      dirConfigFile,
      uploadConcurrency,
    });
  }
}
