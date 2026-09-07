import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const serverOnlyEmpty = fileURLToPath(
  new URL("./node_modules/server-only/empty.js", import.meta.url),
);

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      reporter: ["text", "html", "lcov"],
      thresholds: {
        lines: 90,
        statements: 90,
        functions: 90,
        branches: 85,
      },
    },
    projects: [
      {
        test: {
          name: "jsdom",
          environment: "jsdom",
          setupFiles: ["./vitest.setup.ts"],
          include: ["src/**/*.{test,spec}.{ts,tsx}"],
        },
      },
      {
        resolve: {
          alias: {
            "server-only": serverOnlyEmpty,
          },
        },
        test: {
          name: "node",
          environment: "node",
          include: ["tests/integration/**/*.{test,spec}.ts"],
        },
      },
    ],
  },
});
