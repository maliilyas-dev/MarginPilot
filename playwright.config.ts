import { defineConfig } from "@playwright/test";

/**
 * E2E config for the spec §16 critical path. Requires a running app + a seeded
 * development store with an authenticated session fixture (see tests/e2e/README.md).
 * Not run in CI yet — the critical-path spec is the top Release 1.1 task.
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3000",
    trace: "on-first-retry",
  },
});
