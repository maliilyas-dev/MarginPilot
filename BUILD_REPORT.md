# MarginPilot — Build Report

**Build date:** 2026-09-03
**Base template:** `Shopify/shopify-app-template-react-router` (official, cloned on build date)
**Stack:** React Router 7 + TypeScript · Prisma + PostgreSQL · Redis + BullMQ · decimal.js · csv-parse · Zod · Pino · Vitest

---

## 1. What was built (Release 1 scope)

### Data model — `prisma/schema.prisma` (+ `prisma/migrations/20260903090000_init`)
All spec §9 models implemented for PostgreSQL, GIDs as `String`, money as
`Decimal(18,4)`: `Shop`, `CatalogSync`, `ShopifyProduct`, `ShopifyVariant`,
`VariantInventory`, `Supplier`, `FeedMappingProfile`, `SupplierProductMapping`,
`PricingRule`, `SafetyPolicy`, `FeedRun`, `FeedRow`, `FeedUpload` (transient
cross-process file handoff), `ProposedChange`, `ChangeSet`, `ChangeItem`,
`Alert`, `AuditEvent`, `BillingEntitlement`, `WebhookEvent` (dedupe). Unique
constraints and indexes per spec (`supplierId+sourceChecksum`,
`changeSetId+proposedChangeId`, `shopId+skuNormalized`, etc.). The Shopify
`Session` model shape is preserved for `@shopify/shopify-app-session-storage-prisma`.

### Core engine (pure, unit-tested — 71 tests)
- `app/domain/money/money.ts` — decimal.js helpers; margin/gross-profit; no float math.
- `app/domain/mapping/normalize.ts` — NFKC + trim + case-fold SKU normalization
  (keeps meaningful punctuation), locale-aware number/quantity parsing (rejects
  garbage rather than coercing to 0), header fingerprint.
- `app/domain/pricing/pricing.ts` — landed cost, minimum-safe-price,
  markup-price, `recommendedPrice = max(...)`, all five rounding rules
  (`none|whole|end_99|end_95|end_97`, never rounds a positive price down),
  min/max clamp.
- `app/domain/pricing/rules.ts` — rule selection by priority (lower wins,
  supplier-specific beats shop-wide, more filters = more specific), vendor /
  product-type filters.
- `app/domain/safety/safety.ts` — per-row `classifyRow` (blocked ≠ warning;
  negative/zero cost, zero recommended price, margin-below-minimum,
  price ±threshold, inventory abs/% threshold) and run-level `evaluateRunGates`
  (invalid-row rate, >50% row-count drop needs confirm). Boundary-tested.
- `app/domain/safety/reasonCodes.ts` — machine codes + plain-language text.
- `app/domain/mapping/matcher.ts` — explicit → exact SKU → exact barcode
  (opt-in) → unmatched; duplicate normalized SKU ⇒ ambiguous. No fuzzy matching.
- `app/domain/feeds/parseCsv.ts` — streaming parser with delimiter sniffing,
  byte + row caps.
- `app/domain/feeds/normalizeFeed.ts` — raw record → normalized row + row-level
  validation; duplicate-SKU flagging without merging.
- `app/domain/feeds/checksum.ts` — SHA-256 feed checksum; Shopify write
  operation key (shop + change set + item + op + target version).

### Services — `app/services/`
- `encryption.server.ts` — AES-256-GCM for supplier credentials
  (`DATA_ENCRYPTION_KEY`, 32-byte hex/base64), versioned payload.
- `safeFetch.server.ts` — SSRF-resistant fetch: scheme allow-list, DNS
  resolution check against private/loopback/link-local/ULA/CGNAT ranges (v4+v6),
  re-checked on every redirect hop; redirect/size/time limits.
- `logger.server.ts` — Pino with redaction of tokens/passwords/credentials/
  authorization/cookie/`feedUrl`.
- `queue.server.ts` — BullMQ queues (`catalog-sync`, `feed-fetch`,
  `feed-process`, `changes-apply`, `scheduled-runs`, `cleanup`), per-queue
  options, typed ID-only payloads.
- `shopifyGraphql.server.ts` — offline-token Admin GraphQL client; reads
  `extensions.cost.throttleStatus`, paces + retries transient/THROTTLED/5xx with
  exponential backoff + jitter, never retries `userErrors`; `collectUserErrors`.
- `audit.server.ts` — immutable audit events with secret scrubbing + salted IP hash.
- `alerts.server.ts` — in-app alerts + unresolved counts.
- `entitlements.server.ts` — plan limits (Free/Starter/Growth/Pro/Beta) and
  guards (`canAddSupplier`, `canUseSchedule`, `canUseUrlFeed`,
  `checkMappedVariantBudget` — never silently processes a subset). Beta access
  via `BETA_ACCESS_ENABLED` + `BETA_SHOPS`; no fake Shopify subscription.
- `shopContext.server.ts` — Shop upsert from session, onboarding state,
  `requireShop` / `requireSupplier` / `requireFeedRun` tenant-isolation guards.
- `offlineSession.server.ts` — offline access-token lookup for the worker.
- `webhookDedupe.server.ts` — dedupe by Shopify webhook id.

### Worker — `worker/index.ts`
BullMQ workers for all six queues, per-queue concurrency, DB heartbeat every 30s,
graceful SIGTERM/SIGINT drain. `scheduled-runs` tick every 5 min enqueues due
URL suppliers with a one-active-run lock, respecting supplier timezone via
interval math (timestamps stored UTC). `cleanup` enforces 90-day raw-row
retention. Repeatable jobs via `upsertJobScheduler`.

### Domain orchestration
- `shopify-sync/catalogSync.server.ts` — cursor-paginated product+variant+
  inventory read (nested variant paging), upsert by GID, vanished
  products/variants marked `activeLocally=false` (no hard delete), updates shop
  currency/timezone/GID.
- `feeds/pipeline.server.ts` — full state machine; idempotent by
  supplier+checksum; streams rows, batched `createMany`; applies explicit/exact
  matching, rule selection, decimal price calc, per-row safety + run gates;
  persists discovered exact mappings for future runs; writes summary counts;
  raises mapping-rate / invalid-row alerts; deletes the transient upload.
- `changes/apply.server.ts` — bounded concurrency (4), per-item
  `applying→succeeded/failed`, price via `productVariantsBulkUpdate`, inventory
  via `inventorySetQuantities` (absolute, `ignoreCompareQuantity`), optional unit
  cost via `inventoryItemUpdate`; records previous/requested/returned/userErrors;
  one failure never fails others; skips already-succeeded items on replay; final
  status `completed|partially_completed|failed`; partial-failure alert + audit.

### Routes — `app/routes/`
UI: `/app` dashboard (operational, CTA by state), `/app/onboarding`,
`/app/suppliers` (+ `new`, `:id`, `:id/edit`), `/app/mappings` (filter by
supplier/status, manual map/unmap/ignore), `/app/runs` (+ `:id` with live
polling, `:id/review`), `/app/rules`, `/app/alerts`, `/app/settings` (+
`/billing`).
Review page: filter tabs (all/safe/warning/blocked/unmatched/invalid/unchanged),
safety banner, financial-exposure summary, per-row **Override** (confirmed +
audited), server-paginated table (100/page — no 10k-row render), sticky approval
section requiring inventory/price/cost selection + confirm.
Actions/resources: `POST /app/actions/catalog-sync`,
`.../suppliers/:id/test|upload|run`, `.../runs/:id/approve|cancel`,
`GET /app/resources/runs/:id/status` (poll JSON), `.../export` (CSV),
`.../alerts/:id/read|resolve`. `GET /healthz` (web + DB).
Webhooks: `app/uninstalled` (cancel schedules, revoke access, mark uninstalled),
`app/scopes_update` (template), `customers/data_request`, `customers/redact`,
`shop/redact` (delete/anonymize). All via `authenticate.webhook` (HMAC; invalid ⇒
401) with webhook-id dedupe.

### Config / ops
- `shopify.app.toml` + `shopify.app.development.toml` + `shopify.app.production.toml`
  — min scopes, all webhook subscriptions incl. 3 compliance topics, `api_version = "2025-10"`.
- `.env.example` — full environment contract.
- `docker-compose.yml` — Postgres 16 + Redis 7 with healthchecks.
- `Dockerfile` — Node 22 Alpine; `npx prisma generate && npm run build`; one image, `web`/`worker` role.
- `docs/PRIVACY.md`, `docs/TERMS.md`, `docs/SUPPORT.md`, `docs/APP_STORE_LISTING.md` (drafts, bracketed placeholders).
- `fixtures/sample-supplier-feed.csv` (spec §17 verbatim).

---

## 2. Commands run and results

| Command | Result |
|---|---|
| `git clone` official template → `git init` fresh history | ok |
| `npm install` (+ decimal.js, csv-parse, zod, bullmq, ioredis, pino, pino-pretty, dotenv, tsx; vitest, @vitest/coverage-v8, @playwright/test) | ok |
| `npx prisma format` / `validate` | valid |
| `npx prisma generate` | client generated (v6.19.3) |
| `npx prisma migrate diff --from-empty` → `prisma/migrations/20260903090000_init/migration.sql` | 21 tables, generated |
| `npm run lint` (eslint) | **pass** (0 errors) |
| `npm run typecheck` (`react-router typegen && tsc --noEmit`) | **pass** (0 errors) |
| `npm test` (`vitest run`) | **pass — 71/71** (normalize, pricing, safety, matcher/rules, feed/csv/checksum/encryption/SSRF) |
| `npm run build` (`react-router build`) | **pass** (client 374 modules, server 58 modules) |

---

## 3. Not done in this build / known limitations

- **`prisma migrate deploy` was not executed against a live database.** The build
  host had no reachable Docker daemon, so PostgreSQL/Redis could not start. The
  init migration SQL is generated and committed; run `npm run db:migrate:dev`
  locally (or `migrate deploy` in the release step) on first deploy. Prisma
  client generation, schema validation, typecheck and build all pass without a DB.
- **Integration + Playwright E2E suites not yet written.** Unit coverage of the
  money/pricing/safety/matching/parse/SSRF/crypto core is complete (71 tests).
  Integration tests (CSV→rows, mapping-profile reuse, run state transitions,
  change-set creation, job retry without duplicate `ChangeItem`s, mocked-transport
  GraphQL success/throttle/userErrors, webhook HMAC valid/invalid, shop isolation,
  uninstall disables schedules, shop-redact removes data) and the E2E critical
  path (spec §16) are the top follow-up. `@playwright/test` is installed; no
  `playwright.config.ts` yet.
- **API version is `2025-10` (`ApiVersion.October25`)**, the current stable
  release exposed by the installed `@shopify/shopify-app-react-router@1.1.0`. The
  spec's nominal `2026-07` is not present in this SDK version and is not used.
  `app/config/apiVersion.ts`, `app/shopify.server.ts`, and the three
  `shopify.app*.toml` files are the single points to bump when the SDK ships a
  newer stable version.
- **GraphQL field names not verified against a live shop.** `catalogSync`,
  `apply`, and `graphql.ts` use documented `2025-10` shapes
  (`productVariantsBulkUpdate`, `inventorySetQuantities` with
  `ignoreCompareQuantity`, `inventoryItemUpdate` `cost`, `inventoryItem.unitCost`,
  `quantities(names:["available"])`). Re-check against
  `shopify.dev/docs/api/admin-graphql/2025-10` and adjust if a field/enum
  differs; run one real catalog sync + one real apply on a dev store.
- **Bulk operations not used for catalog reads.** Release 1 uses cursor
  pagination (spec allows "when appropriate"). For very large catalogs, switch
  `catalogSync` to a bulk operation — noted as a Release 1.1 improvement.
- **Unit-cost write** is wired (`inventoryItemUpdate`) and gated behind the
  merchant's explicit "update unit cost" checkbox; confirm your app's granted
  scope permits `inventoryItem` cost writes on the target API version before
  enabling in production. No extra scope was added beyond the five in the spec.
- **`safeFetch`** mitigates SSRF via DNS-resolution checks + per-hop
  revalidation, but does not pin the resolved IP for the actual socket
  connection (full DNS-rebinding defense needs a custom agent). Redirect/size/
  timeout caps are enforced.
- **CSV delimiter sniff** for URL feeds reads the first chunk on a `setImmediate`
  tick; extremely slow first bytes could fall back to comma. Manual uploads and
  explicit delimiter settings are unaffected.
- **Billing**: entitlement abstraction + beta mode implemented; real Shopify
  App Pricing / `appSubscriptionCreate` is intentionally not called (spec:
  "Do not fake a paid Shopify subscription"). Configure public pricing in the
  Partner Dashboard and, for paid enforcement, add a managed-pricing check.
- **Deployment not performed** — no hosting account exists yet (owner has
  Shopify Partner + dev store only). Runbook below.

---

## 4. Deployment runbook (manual — needs owner accounts)

**Owner-provided (cannot be automated from the build environment):**
Shopify Partner login, a development store, a hosting account with billing
(Railway recommended), and optionally Sentry/Resend.

### 4.1 Create the production app
```bash
shopify app config link --config production      # creates the app, writes client_id
# edit shopify.app.production.toml: set application_url + auth.redirect_urls to the prod URL
```
Choose **public distribution** (required to sell a subscription app to unrelated
merchants; the choice is permanent — do not pick custom).

### 4.2 Provision infra (Railway example)
- New project → add **PostgreSQL** and **Redis** plugins.
- Service 1 "web": deploy this repo. Start command `npm run docker-start`
  (`= prisma generate && prisma migrate deploy && react-router-serve`).
- Service 2 "worker": same repo/image. Start command `npm run worker`.
- Health check path for web: `/healthz`.

### 4.3 Env vars (host secrets, both services)
From `.env.example`. Minimum:
`NODE_ENV=production`, `SHOPIFY_APP_URL`, `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`,
`SCOPES=read_products,write_products,read_inventory,write_inventory,read_locations`,
`DATABASE_URL`, `REDIS_URL`,
`DATA_ENCRYPTION_KEY` (`openssl rand -base64 32`),
`SESSION_SECRET` (`openssl rand -hex 32`),
`BETA_ACCESS_ENABLED=true`, `BETA_SHOPS=<your-dev-store>.myshopify.com`.

### 4.4 Release + deploy config
```bash
# migrations run automatically via `npm run setup` inside docker-start; or run once:
DATABASE_URL=... npx prisma migrate deploy
curl -fsS https://<prod-web-url>/healthz          # expect {"status":"ok"}
shopify app deploy --config production            # pushes scopes + webhooks
```

### 4.5 Smoke test on a development store
1. Install from the Partner Dashboard app URL. Confirm it loads embedded, no
   second login.
2. Settings → set default location → **Sync catalog now**; wait for the worker to
   finish (dashboard shows variant count).
3. Suppliers → Add supplier (manual CSV) → upload
   `fixtures/sample-supplier-feed.csv`, map columns
   (`supplier_sku,available_quantity,unit_cost,name,msrp,freight_per_unit,barcode`),
   check "process now".
4. Open the run → review: expect `ABC-102` (zero cost), `ABC-103` (negative qty),
   `ABC-104` (abnormal cost) **blocked**; matched rows **safe**.
5. Approve safe changes with "Update price" (+ "Update inventory"). Watch the run
   move to `applying` → `completed`/`partially_completed`.
6. Verify the variant price/quantity changed in Shopify Admin.
7. Re-approve the same set — confirm no duplicate application.
8. Uninstall → confirm schedules cancelled; reinstall → confirm clean state.
9. Send a webhook with a bad HMAC (e.g. `shopify webhook trigger` variant / curl)
   → expect HTTP 401.

### 4.6 Listing submission
Fill bracketed placeholders in `docs/*.md`, host Privacy/Terms/Support pages,
capture the six screenshots (plan in `docs/APP_STORE_LISTING.md`), configure
pricing via Shopify App Pricing, submit for review. Approval timing is
controlled by Shopify.

---

## 5. Recommended next steps (Release 1.1)

Integration + E2E test suites · `playwright.config.ts` + the §16 critical-path
spec · one verified live catalog sync + apply on a dev store · bulk-operation
catalog read for large stores · resolved-IP socket pinning in `safeFetch` ·
rollback action from `ChangeItem.previousValues` · XML + Google Sheets
connectors · email alerts (Resend) · Sentry wiring when `SENTRY_DSN` is set.
