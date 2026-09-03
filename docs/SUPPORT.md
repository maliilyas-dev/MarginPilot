# MarginPilot Support

**Draft — replace bracketed values before publishing.**

## Get help
- Email: [SUPPORT EMAIL] — response target: 1 business day.
- Status / incidents: [STATUS PAGE URL]
- Documentation: [DOCS URL]

## Before contacting support
Have ready:
- Your `.myshopify.com` store domain.
- The supplier name and the feed run ID (visible on the Runs page).
- What you expected vs. what happened.
- A screenshot of any error banner (never send access tokens or passwords).

## Common questions

**Does MarginPilot change my prices automatically?**
No. In Release 1 every change requires you to review a preview and approve it.

**Why is a row "blocked"?**
A safety policy caught something: zero or negative cost, a price move larger than
your limit, margin below your floor, an abnormal inventory jump, or an unmatched
SKU. Fix the supplier data, adjust the policy in Settings, or override that
specific row (logged in the audit trail).

**Why didn't a row match?**
SKUs are matched exactly (case-insensitive, trimmed). Multiple Shopify variants
with the same SKU are "ambiguous" and need a manual pick on the Mappings page.

**A Shopify update failed.**
Open the run. Failed items show the Shopify error. Fix the cause and re-approve;
successful items are never re-applied.

**Uninstall / data deletion.**
Uninstalling cancels all schedules. Shopify sends a redaction request about 48
hours later, after which your suppliers, feeds, mappings, and catalog mirror are
deleted and the shop record is anonymized.
