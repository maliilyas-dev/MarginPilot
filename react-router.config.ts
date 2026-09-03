import type { Config } from "@react-router/dev/config";

export default {
  ssr: true,
  // MarginPilot runs embedded inside Shopify Admin, so App Bridge submits
  // actions from the admin.shopify.com iframe. React Router 7's single-fetch
  // CSRF guard would otherwise reject every cross-origin action POST with a
  // 400. Allow the Shopify admin + shop origins.
  allowedActionOrigins: [
    "admin.shopify.com",
    "*.shopify.com",
    "**.shopify.com",
    "*.myshopify.com",
    "**.myshopify.com",
    "*.spin.dev",
  ],
} satisfies Config;
