/**
 * Single source of truth for the pinned Shopify Admin API version, importable
 * without pulling in the Shopify SDK (the worker uses it directly).
 *
 * Keep this in sync with `shopify.app.toml` [webhooks].api_version and with
 * ApiVersion.October25 in app/shopify.server.ts.
 */
export const SHOPIFY_API_VERSION = "2026-07";
