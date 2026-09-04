/**
 * Production server.
 *
 * Custom (rather than `react-router-serve`) so `allowedActionOrigins` is forced
 * onto the server build at runtime: React Router 7's single-fetch CSRF guard
 * otherwise rejects action POSTs forwarded by App Bridge from the Shopify admin
 * iframe with a 400. `react-router.config.ts` also bakes the value in — this is
 * belt and braces.
 */
import { createRequestHandler } from "@react-router/express";
import compression from "compression";
import express from "express";

const BUILD_PATH = "./build/server/index.js";
const PORT = Number(process.env.PORT || 3000);

const ALLOWED_ACTION_ORIGINS = [
  "null",
  "admin.shopify.com",
  "*.shopify.com",
  "**.shopify.com",
  "*.myshopify.com",
  "**.myshopify.com",
  "*.up.railway.app",
  "*.spin.dev",
];

const mod = await import(BUILD_PATH);
const build = { ...mod, allowedActionOrigins: ALLOWED_ACTION_ORIGINS };

const app = express();
app.disable("x-powered-by");
app.use(compression());
app.use("/assets", express.static("build/client/assets", { immutable: true, maxAge: "1y" }));
app.use(express.static("build/client", { maxAge: "1h" }));
app.use(createRequestHandler({ build, mode: process.env.NODE_ENV }));

app.listen(PORT, () => console.log(`[server] listening on :${PORT}`));
