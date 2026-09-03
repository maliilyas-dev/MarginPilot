# MarginPilot — App Store Listing Draft

**Refine after UI screenshots exist. Run a Shopify App Store + trademark name
check before final selection.**

## App name
**Preferred:** MarginPilot
**Fallbacks:** SupplierGuard, MarginSync, VendorMargin, ProfitFeed

## Subtitle
Sync supplier stock and costs without risking your margins.

## Short description
Import supplier inventory and costs, match supplier SKUs to Shopify variants,
calculate margin-safe prices, detect dangerous feed changes, and approve updates
before they reach your store.

## Key benefits
- Import supplier CSV feeds without spreadsheet cleanup.
- Match supplier SKUs to Shopify variants and save the mappings.
- Include freight, duty, and handling in landed cost.
- Protect minimum margins with flexible pricing rules.
- Preview every inventory and price change before it touches Shopify.
- Block suspicious costs, quantities, and large price movements.
- Review every applied update in a clear audit history.

## How it works
1. Sync your Shopify catalog into MarginPilot.
2. Add a supplier and upload a CSV (or point it at a scheduled URL feed).
3. Map the CSV columns; the mapping is saved for next time.
4. MarginPilot matches SKUs, calculates landed cost and a recommended price, and
   runs safety checks.
5. Review the change preview — safe, warning, blocked, unmatched, invalid.
6. Approve the safe changes. MarginPilot applies them to Shopify in the
   background and records an audit trail.

## Screenshot plan
1. Dashboard with setup state and margin risks.
2. CSV column-mapping preview.
3. Supplier-to-Shopify SKU matching.
4. Change preview with safe / warning / blocked classifications.
5. Margin rule editor.
6. Completed update run and audit results.

## Demo video outline
1. The supplier cost/inventory problem.
2. Add supplier → upload CSV → map columns.
3. Resolve an unmatched SKU.
4. Show landed-cost / margin rules.
5. Show a blocked abnormal row.
6. Approve safe rows.
7. Confirm Shopify values and the audit trail.

## Pricing (configure via Shopify App Pricing)
| Plan | Price | Limits |
|---|---:|---|
| Free | $0/mo | 1 supplier, 50 mapped variants, manual CSV, preview-focused |
| Starter | $29/mo | 1 supplier, 1,000 mapped variants, daily schedule |
| Growth | $79/mo | 5 suppliers, 10,000 mapped variants, hourly schedule |
| Pro | $149/mo | 20 suppliers, 50,000 mapped variants, priority processing |

## Required public URLs (fill before submission)
- Product landing page: [URL]
- Privacy policy: [URL] (source: docs/PRIVACY.md)
- Terms of service: [URL] (source: docs/TERMS.md)
- Support / contact: [URL] (source: docs/SUPPORT.md)
- Documentation / help center: [URL]

## Data & permissions rationale (for review)
- `read_products` / `write_products`: read catalog for matching; write approved
  variant prices.
- `read_inventory` / `write_inventory`: read inventory levels and unit cost;
  write approved inventory quantities (and unit cost when the merchant opts in).
- `read_locations`: let the merchant choose the location to update.
- No customer or order scopes are requested. No storefront code is injected.
