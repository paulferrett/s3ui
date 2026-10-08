# S3 Asset Manager

| | |
|---|---|
| **Repo** | [paulferrett/s3ui](https://github.com/paulferrett/s3ui) (public) |
| **Stack** | React 18 / Vite 6 / TypeScript / Tailwind 4 / Lambda / CDK |
| **Ports** | Dev server `8180` |
| **Deploy** | AWS CDK (CloudFront + S3 + Lambda) |
| **Co-commit** | No — public repo |

Standalone serverless S3 file browser/manager. 100% self-contained — no shared infra imports.

## Stack

- **Frontend**: Vite 6 + React 18 + TypeScript + Tailwind 4 + TanStack Router + TanStack Query
- **Backend**: Single Lambda (Node 22) behind API Gateway HTTP API + Transform Lambda (sharp, Node 22)
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

Requires `AWS_PROFILE` env var to be set.

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
- **Upload**: Presigned PUT URLs — browser uploads directly to S3. Supports folder drag-drop (creates subfolders + uploads contents).
- **Folders**: Created by placing a `.s3ui.json` config file inside (used for custom sort order).
- **Transforms**: Optional image transforms (resize/format) via a dedicated Lambda using sharp. Triggered by S3 event notifications on upload. EXIF auto-rotation applied.
- **Reusable construct**: `s3-manager-infra` package exports `S3Manager` and `SpaEmbed` constructs. Kanosari's `MediaManager` construct imports the lambda code from this package.

## S3 Event Loop Prevention

When a Lambda writes back to the same S3 bucket that triggers it, it can create an infinite recursive loop. AWS will auto-detect and kill these loops, but they waste money and break functionality.

**Transform Lambda** (`lambda/transform.ts`) does a `CopyObject` to the same key to store image dimensions as metadata. This fires another `OBJECT_CREATED` event. Loop is prevented by checking for existing `width`/`height` metadata before processing — if present, the image was already processed.

**Describe Lambda** (`lambda/describe.ts`) writes `.s3ui.json` which is skipped by `!isImage()` and `endsWith(DIR_CONFIG_FILE)` checks.

**Key rule:** Any Lambda that writes to the trigger bucket MUST have loop prevention. Always check for this when modifying S3 event handlers.

## AI Describe Feature

Optional Claude Vision integration for auto-describing images. Requires `ANTHROPIC_API_KEY` env var **at CDK deploy time** (baked into Lambda env). If not provided, AI feature is disabled but the `/api/describe` route still exists (returns 501).

- Model: `claude-haiku-5-5` (default — version alias, not a dated snapshot)
- The API handler resizes images >4.5MB with sharp before sending to Claude
- The background Describe Lambda skips images >4.5MB

## Consumer: kanosari

The kanosari project (`~/bs/kanosari/infra`) uses s3ui's lambda code and SPA via the `s3-manager-infra` npm dependency (`file:` link to local `s3ui/infra`). Its `MediaManager` construct resolves lambda paths via `require.resolve('s3-manager-infra/package.json')`.

**Deploy kanosari media CDN:**

Credentials are in `~/bs/kanosari/infra/.env` (gitignored). Source it before deploying:

```bash
cd ~/bs/kanosari/infra
env $(cat .env | xargs) npx cdk deploy --all --profile kanosari
```

- AWS profile: `kanosari`
- AWS region: `us-east-1` (CDK stack region, NOT the profile default `ap-southeast-2`)
- Media URL: `https://media.kanosari.com`
- Bucket: `kanosari-media`
- Auth: Basic auth (setup mode) — credentials passed via env vars
- All Lambda runtimes: Node 22
- **ANTHROPIC_API_KEY must be set** for AI describe to work — omitting it disables the feature entirely (no Describe Lambda, no API key on API handler)
