import "dotenv/config";
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const src = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  resolve: { alias: { "@": src } },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          env: { DATABASE_URL: process.env.TEST_DATABASE_URL ?? "", APP_MODE: "DEMO", DEMO_CLOCK_MODE: "offset" },
          fileParallelism: false,
          testTimeout: 90_000,
          hookTimeout: 300_000,
          setupFiles: ["tests/integration/setup.ts"],
        },
      },
    ],
  },
});
