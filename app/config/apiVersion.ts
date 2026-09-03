/**
 * Single source of truth for the pinned Shopify Admin API version, importable
 * without pulling in the Shopify SDK (the worker uses it directly).
 *
 * Keep this in sync with the `[webhooks].api_version` in
 * shopify.app.margin-pilot.toml and ApiVersion.July26 in app/shopify.server.ts.
 */
export const SHOPIFY_API_VERSION = "2026-07";
