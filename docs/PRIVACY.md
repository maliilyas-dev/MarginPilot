# MarginPilot Privacy Policy

**Draft — review with legal counsel before publishing. Replace bracketed values.**

_Last updated: [DATE] · Effective: [DATE]_

MarginPilot ("the App", "we", "us") is a Shopify embedded application operated by
[LEGAL ENTITY NAME], [ADDRESS]. This policy explains what data the App processes
when a merchant installs it on a Shopify store.

## 1. Data we process

### From Shopify (Admin API), with merchant authorization
- Shop profile: shop domain, plan-level metadata, primary location, currency, time zone.
- Locations.
- Products and product variants: title, vendor, product type, status.
- Variant fields: SKU, barcode, price, compare-at price.
- Inventory item: ID, tracked state, unit cost (when authorized).
- Inventory quantities at selected locations.

We request only these scopes: `read_products`, `write_products`,
`read_inventory`, `write_inventory`, `read_locations`.

### From the merchant
- Supplier configuration (name, code, feed URL, schedule, locale settings).
- Supplier feed files that the merchant uploads or that we retrieve from a
  merchant-provided URL, and the normalized rows parsed from them.
- Optional HTTP Basic credentials for a feed URL, stored encrypted (AES-256-GCM).
- Pricing rules, safety policy settings, and approval decisions.

### We do NOT process
- Customer personal data.
- Order data.
- Payment or card data.
- Storefront visitor data. The App adds no storefront code.

## 2. How we use data
- To mirror the Shopify catalog locally so supplier rows can be matched to variants.
- To calculate landed cost, recommended price, and margin.
- To detect anomalies and present a change preview.
- To apply merchant-approved inventory and price updates back to Shopify.
- To maintain an audit trail of applied changes.
- To operate, secure, debug, and improve the App.

We do not sell personal data. We do not use merchant data for advertising.

## 3. Sub-processors
- [HOSTING PROVIDER] — application, PostgreSQL database, Redis queue hosting.
- [ERROR MONITORING, e.g. Sentry] — error diagnostics (no feed contents, no secrets).
- [EMAIL PROVIDER, e.g. Resend] — transactional alert email (Release 1.1+).

A current list is available on request at [SUPPORT EMAIL].

## 4. Retention
- Raw normalized feed rows: 90 days by default, then deleted.
- Uploaded source files: deleted once a run is ready for review.
- Audit summaries and run metadata: retained up to [N] months for accountability.
- On app uninstall: schedules are cancelled and operational access is revoked.
- On Shopify `shop/redact` (≈48 hours after uninstall): the shop's suppliers,
  feeds, mappings, change sets, catalog mirror, and alerts are deleted and the
  shop record is anonymized.

## 5. Security
- TLS in transit; encryption at rest for supplier credentials.
- Strict per-shop tenant isolation on every query.
- Webhook HMAC verification; invalid signatures rejected with HTTP 401.
- SSRF protections on URL feed retrieval (private ranges blocked, redirect and
  size limits, timeouts).
- Access tokens, credentials, and full feed contents are never written to logs.

## 6. GDPR / CCPA
We act as a data processor for merchant data. Shopify's mandatory compliance
webhooks are implemented:
- `customers/data_request` — acknowledged; no customer data is stored.
- `customers/redact` — acknowledged; no customer data is stored.
- `shop/redact` — shop data deleted / anonymized.

To exercise data rights, contact [SUPPORT EMAIL].

## 7. Changes
Material changes will be posted here with a new "Last updated" date and, where
required, notified in-app.

## 8. Contact
[LEGAL ENTITY NAME] · [SUPPORT EMAIL] · [ADDRESS]
