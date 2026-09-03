# MarginPilot — Shopify Supplier Sync & Margin Guard

Import supplier inventory and costs, map supplier SKUs to Shopify variants,
calculate margin-safe prices, detect anomalies, preview every change, and apply
only merchant-approved inventory/price updates through the Shopify GraphQL Admin
API — with an immutable audit trail.

Built on the official Shopify **React Router** app template. TypeScript
throughout. PostgreSQL + Prisma. Redis + BullMQ worker. `decimal.js` money math.

> Full product/architecture spec: `MarginPilot-Shopify-App-Claude-Code-Build-Spec.md`
> Status of the build and remaining manual steps: `BUILD_REPORT.md`

## Architecture

| Process | Command | Responsibility |
|---|---|---|
| web | `npm run dev` (local) / `npm start` (prod) | Embedded admin UI, auth, CRUD, uploads, webhooks, job enqueue, `/healthz` |
| worker | `npm run worker` | catalog sync, URL feed fetch, feed parse/normalize/map/calculate, Shopify mutations, scheduled runs, cleanup |

Feed pipeline state machine:
`QUEUED → FETCHING/UPLOADED → PARSING → VALIDATING → MAPPING → CALCULATING → READY_FOR_REVIEW → APPLYING → COMPLETED | PARTIALLY_COMPLETED | FAILED`

No Shopify write happens before a merchant approves a preview.

## Local development

```bash
# 1. datastores
docker compose up -d           # PostgreSQL + Redis

# 2. env
cp .env.example .env
# set DATA_ENCRYPTION_KEY  (openssl rand -base64 32)
# set SESSION_SECRET       (openssl rand -hex 32)
# SHOPIFY_* are filled by `shopify app config link`

# 3. install + migrate
npm install
npm run db:migrate:dev

# 4. run (two terminals)
npm run dev        # Shopify CLI tunnel + web
npm run worker     # background worker
```

Install on a development store from the CLI output URL.

Sample feed for testing: `fixtures/sample-supplier-feed.csv` (the last three rows
intentionally trigger zero-cost, negative-quantity, and abnormal-value blocks).

## Quality gates

```bash
npm run lint
npm run typecheck
npm test           # vitest, unit + integration
npm run build
```

End-to-end (`tests/e2e`, Playwright) requires a running app + seeded store; see
`BUILD_REPORT.md`.

## Access scopes (minimum)

`read_products,write_products,read_inventory,write_inventory,read_locations`

No customer or order scopes. No storefront code.

## Deployment

See `BUILD_REPORT.md` §"Deployment runbook". Summary:

1. Provision PostgreSQL + Redis (Railway recommended).
2. Deploy the same image twice: **web** (`npm run docker-start`) and **worker**
   (`npm run worker`).
3. Set all env vars from `.env.example` as host secrets.
4. `prisma migrate deploy` runs as a release step (`npm run setup`).
5. Point `application_url` + OAuth callbacks at the web URL; `shopify app deploy`.
6. Verify `/healthz`, install on a dev store, run the sample-feed flow.

## Repository layout

```
app/
  config/apiVersion.ts        pinned Shopify API version (string, SDK-free)
  domain/
    money/                    decimal helpers
    mapping/                  SKU normalization, locale numbers, matcher
    pricing/                  landed cost, recommended price, rounding, rule select
    safety/                   per-row + run-level classification, reason codes
    feeds/                    canonical fields, CSV stream parse, normalize, pipeline, checksum
    shopify-sync/             GraphQL docs, catalog sync
    changes/                  change-set apply
    dashboard.server.ts
  services/                   encryption, safeFetch (SSRF), logger, queue,
                              shopifyGraphql, audit, alerts, entitlements,
                              shopContext, offlineSession, webhookDedupe
  routes/                     embedded UI + resource/action routes + webhooks
prisma/schema.prisma          + prisma/migrations/*
worker/index.ts               BullMQ workers + schedules + heartbeat
tests/unit/                   71 tests
docs/                         PRIVACY, TERMS, SUPPORT, APP_STORE_LISTING
fixtures/sample-supplier-feed.csv
```
