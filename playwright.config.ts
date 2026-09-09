import { defineConfig, devices } from "@playwright/test";

import { e2eOrigin } from "./tests/e2e/origin";

const origin = e2eOrigin();
const requestedBrowsers = (process.env.PLAYWRIGHT_BROWSERS ?? "chromium").split(
  ",",
);

const browserProjects = {
  chromium: {
    name: "chromium",
    use: { ...devices["Desktop Chrome"] },
  },
  firefox: {
    name: "firefox",
    use: { ...devices["Desktop Firefox"] },
  },
  webkit: {
    name: "webkit",
    use: { ...devices["Desktop Safari"] },
  },
} as const;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: origin,
    locale: "es-ES",
    timezoneId: "Europe/Madrid",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "tsx --conditions react-server scripts/start-e2e-server.ts",
    url: origin,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
  projects: requestedBrowsers.map((browser) => {
    const project = browserProjects[browser as keyof typeof browserProjects];
    if (project === undefined) {
      throw new Error(`Unknown Playwright browser project: ${browser}`);
    }
    return project;
  }),
});
