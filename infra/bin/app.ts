#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { S3ManagerStack } from "../lib/s3-manager-stack";

const app = new cdk.App();
new S3ManagerStack(app, "S3Manager", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
