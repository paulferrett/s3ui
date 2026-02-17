# S3 Asset Manager

A standalone serverless S3 file browser and asset manager. Deploy to your own AWS account with a single `cdk deploy` — no shared infrastructure required.

## Features

- **Browse & navigate** S3 buckets with folder structure and breadcrumb navigation
- **Upload files** via drag-and-drop or file picker, with progress tracking (presigned PUT directly to S3)
- **Preview images** inline, download any file type
- **Create folders** and **delete files** with confirmation
- **Multi-bucket support** — manage multiple S3 buckets from one UI
- **Pluggable auth** — Auth0 JWT, Basic auth, or both (start with a password, migrate to Auth0 later)

## Architecture

```
CloudFront
├── /* → S3 (SPA)
└── /api/* → API Gateway → Lambda (5 endpoints)
```

Everything runs serverless — no servers to manage. The SPA is served from S3 via CloudFront with OAC. The API is a single Lambda behind API Gateway HTTP API. File uploads go directly from the browser to S3 using presigned URLs.

## Quick Start

### Prerequisites

- Node.js 20+
- AWS CLI configured
- AWS CDK CLI (`npm install -g aws-cdk`)

### Deploy

```bash
# Install dependencies
npm install
cd infra && npm install && cd ..

# Deploy with basic auth
cd infra
npx cdk deploy -c setupUsername=admin -c setupPassword=changeme

# Upload the SPA
cd ..
./scripts/deploy.sh
```

Open the CloudFront URL from the stack output, log in, and start managing files.

### Add Auth0 later

```bash
cd infra
npx cdk deploy \
  -c auth0Domain=auth.example.com \
  -c auth0Audience=https://api.example.com \
  -c setupUsername=admin \
  -c setupPassword=changeme   # keep both during transition
```

Set `VITE_AUTH0_DOMAIN`, `VITE_AUTH0_CLIENT_ID`, and `VITE_AUTH0_AUDIENCE` in `.env`, rebuild, and redeploy the SPA.

### Custom domain

```bash
cd infra
npx cdk deploy \
  -c domainName=assets.example.com \
  -c hostedZoneId=Z1234567890 \
  -c zoneName=example.com \
  -c setupUsername=admin \
  -c setupPassword=changeme
```

## Bucket Configuration

Configure buckets in `infra/cdk.json` under `context.buckets`:

```jsonc
"buckets": [
  { "name": "my-media-assets", "create": true },
  { "name": "existing-bucket", "import": true },
  { "name": "versioned-bucket", "create": true, "versioned": true }
]
```

- `create: true` — CDK creates the bucket with public access blocked and CORS configured
- `import: true` — references an existing bucket (Lambda gets read/write access)

## Local Development

```bash
npm run dev   # Vite on http://localhost:8180
```

Set `VITE_API_URL` in `.env` to point at a deployed API Gateway endpoint for local frontend development against a real backend.

## Stack

| Layer | Tech |
|-------|------|
| Frontend | Vite, React 18, TypeScript, Tailwind CSS 4, TanStack Router + Query |
| Backend | Lambda (Node 20), API Gateway HTTP API |
| Infra | AWS CDK (CloudFront, S3, Lambda, API Gateway, optional ACM + Route53) |
| Auth | Auth0 JWT via jose / Basic auth |
