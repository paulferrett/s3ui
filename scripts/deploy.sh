#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "==> Building SPA..."
cd "$PROJECT_DIR"
npm run build

echo "==> Getting stack outputs..."
cd "$PROJECT_DIR/infra"
SPA_BUCKET=$(aws cloudformation describe-stacks --stack-name S3Manager \
  --query "Stacks[0].Outputs[?OutputKey=='SpaBucketName'].OutputValue" \
  --output text --profile "${AWS_PROFILE:?Set AWS_PROFILE}")

DIST_ID=$(aws cloudformation describe-stacks --stack-name S3Manager \
  --query "Stacks[0].Outputs[?OutputKey=='DistributionId'].OutputValue" \
  --output text --profile "${AWS_PROFILE:?Set AWS_PROFILE}")

echo "==> Syncing to S3 ($SPA_BUCKET)..."
aws s3 sync "$PROJECT_DIR/dist" "s3://$SPA_BUCKET" \
  --delete \
  --cache-control "public, max-age=31536000, immutable" \
  --exclude "index.html" \
  --profile "${AWS_PROFILE:?Set AWS_PROFILE}"

aws s3 cp "$PROJECT_DIR/dist/index.html" "s3://$SPA_BUCKET/index.html" \
  --cache-control "no-cache" \
  --profile "${AWS_PROFILE:?Set AWS_PROFILE}"

echo "==> Invalidating CloudFront ($DIST_ID)..."
aws cloudfront create-invalidation \
  --distribution-id "$DIST_ID" \
  --paths "/*" \
  --profile "${AWS_PROFILE:?Set AWS_PROFILE}"

echo "==> Done!"
