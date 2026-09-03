import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    exclude: ["tests/e2e/**", "node_modules/**"],
    setupFiles: [],
    coverage: {
      provider: "v8",
      include: ["app/domain/**/*.ts", "app/services/**/*.ts"],
      reporter: ["text", "html"],
    },
  },
});
