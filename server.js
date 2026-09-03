/**
 * Custom production server.
 *
 * Exists for one reason: to force `allowedActionOrigins` onto the server build
 * at runtime. React Router 7's single-fetch CSRF guard otherwise rejects every
 * action POST that App Bridge forwards from the admin.shopify.com iframe with a
 * 400 "Bad Request". `react-router.config.ts` bakes the value into the build,
 * but setting it here too guarantees it regardless of build/deploy timing.
 */
import { createRequestHandler } from "@react-router/express";
import compression from "compression";
import express from "express";

const BUILD_PATH = "./build/server/index.js";
const PORT = Number(process.env.PORT || 3000);

const ALLOWED_ACTION_ORIGINS = [
  "admin.shopify.com",
  "*.shopify.com",
  "**.shopify.com",
  "*.myshopify.com",
  "**.myshopify.com",
  "*.spin.dev",
];

async function loadBuild() {
  const mod = await import(BUILD_PATH);
  return { ...mod, allowedActionOrigins: ALLOWED_ACTION_ORIGINS };
}

const initialBuild = await loadBuild();

const app = express();
app.disable("x-powered-by");
app.use(compression());

// Static assets (immutable, long cache) then the rest of build/client.
app.use(
  "/assets",
  express.static("build/client/assets", { immutable: true, maxAge: "1y" }),
);
app.use(express.static("build/client", { maxAge: "1h" }));

// Mounted as middleware (not app.all("*")) so it works on both Express 4 and 5.
app.use(
  createRequestHandler({
    build: initialBuild,
    mode: process.env.NODE_ENV,
  }),
);

app.listen(PORT, () => {
  console.log(`[server] listening on ${PORT} (allowedActionOrigins forced)`);
});
