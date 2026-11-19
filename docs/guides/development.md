---
icon: lucide/code
---

# Development

The project uses Next.js 16 with the App Router, TypeScript, Prisma, and the built-in Node test runner. There's no Vitest or Vite setup.

## Local environment

You need Node.js 24 or newer. The test scripts use `--experimental-test-module-mocks`, which requires it.

```bash
npm ci
cp .env.example .env
npm run prisma:generate
```

For most changes, running the whole stack in Docker is easier than starting PostgreSQL and `monero-wallet-rpc` by hand:

```bash
COMPOSE_PROFILES=dev docker compose up -d --build
```

The dev app listens on `3001`, the dev database on `5433`, and the wallet RPC on `18083`. The source directory is mounted into the container for hot reload.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Next.js development server. |
| `npm run build` | `prisma generate` followed by `next build` (standalone output). |
| `npm start` | Serve the built app. |
| `npm run lint` | `tsc --noEmit`. |
| `npm test` | All `src/**/*.test.ts` files with the Node test runner. |
| `npm run test:watch` | Same tests in watch mode. |
| `npm run test:integration` | Smoke test against a running stack (`APP_URL` must point at it). |
| `npm run seed` | Seed the database via `prisma/seed.ts`. |
| `npm run prisma:migrate` | Create a development migration. |
| `npm run prisma:deploy` | Apply migrations in production. |

## Tests

```bash
npm test
```

The suite covers amount conversion, digest authentication, wallet logic, payment proofs, auth tokens, encryption, rate limiting, and production environment validation. RPC calls and Prisma are mocked, so no external services are needed.

Run the integration smoke test against a live stack:

```bash
COMPOSE_PROFILES=dev docker compose up -d --build
npm run seed
APP_URL=http://localhost:3001 npm run test:integration
```

## Database changes

Edit `prisma/schema.prisma`, then:

```bash
npm run prisma:migrate -- --name describe_the_change
```

This writes a migration under `prisma/migrations/`. The production container runs `prisma migrate deploy` before starting the server, so committed migrations are applied automatically on deployment.

## Code layout

```text
src/
├── app/
│   └── api/                 # Route handlers, one folder per endpoint
├── instrumentation.ts       # HTTP metrics and process gauges
└── lib/
    ├── monero/              # RPC client, digest auth, money, network, wallet
    ├── payments/            # Links, settlement, API keys, webhooks, audit
    ├── pricing/             # Oracle and fixed-point conversion
    ├── auth.ts, crypto.ts, env.ts, rate-limit.ts, metrics.ts
    └── api-response.ts      # Centralized error mapping
```

A useful convention: route handlers stay thin and delegate to a function in `lib`. Error mapping lives in `apiError`, which turns known error classes into HTTP status codes.

## CI

Every push and pull request runs three jobs:

- **unit**: `npm ci`, tests, type-check, build, and `npm audit --omit=dev --audit-level=high`.
- **artifacts**: builds both images, generates SPDX SBOMs with Syft, signs them with cosign, and verifies the signatures.
- **integration**: generates throwaway secrets, starts the production stack on stagenet, waits for health, and runs the smoke test.

Tool downloads are pinned to versions and checked against SHA-256 digests before use.

## Working on these docs

The documentation isn't part of the Next.js app. It's a Zensical project at the repository root:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install zensical==0.1.2
zensical serve          # http://localhost:8000
zensical build --strict # validate links and config
```

Pages live in `docs/`, navigation and theme settings in `zensical.toml`, and the publish workflow in `.github/workflows/docs.yml`.
