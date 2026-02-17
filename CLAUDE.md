# S3 Asset Manager

Standalone serverless S3 file browser/manager. 100% self-contained — no shared infra imports.

## Stack

- **Frontend**: Vite 6 + React 18 + TypeScript + Tailwind 4 + TanStack Router + TanStack Query
- **Backend**: Single Lambda (Node 20) behind API Gateway HTTP API
- **Infra**: AWS CDK (CloudFront + S3 SPA + Lambda + API Gateway)
- **Auth**: Pluggable — Auth0 JWT or Basic auth (or both)

## Local Development

```bash
npm run dev          # Vite dev server on :8180
```

Port: **8180** (818x block)

## CDK

```bash
cd infra
npm run build && npx cdk synth     # Verify stack
npx cdk deploy -c setupUsername=admin -c setupPassword=secret  # Deploy with basic auth
```

All config via CDK context (`cdk.json` or `-c` flags). See `infra/cdk.json` for bucket config.

## Deploy SPA

```bash
./scripts/deploy.sh                 # Build + S3 sync + CF invalidation
```

Uses `AWS_PROFILE` env var (defaults to `lunsbok`).

## Project Structure

```
src/           Frontend SPA (React)
lambda/        Lambda handler (5 endpoints)
infra/         CDK stack
scripts/       Deploy script
```

## Key Patterns

- **Auth**: `AUTH_MODE` env var (`setup` | `auth0` | `both`). Lambda validates JWT via jose or Basic auth against env vars.
- **Buckets**: Configured in CDK context as JSON array. Lambda validates bucket access. Frontend gets bucket list from `/api/auth-info`.
- **Upload**: Presigned PUT URLs — browser uploads directly to S3.
- **Folders**: Created as zero-byte objects with trailing `/` and `application/x-directory` content type.
