/**
 * Starts a production Next.js server against an isolated SQLite file.
 *
 * The file lives in a unique temporary directory, is migrated and seeded here,
 * and is never the developer `data/` database. The process listens only on
 * loopback at the dedicated E2E port.
 */

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { APPLICATION_TIME_ZONE } from "../src/shared/domain/clock";
import {
  E2E_HARNESS_ENABLED_VALUE,
  E2E_HARNESS_ENV,
} from "../src/shared/server/e2e-harness";
import { E2E_HOST, E2E_PORT, e2eOrigin } from "../tests/e2e/origin";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function fail(message: string): never {
  console.error(`E2E server failed: ${message}`);
  process.exit(1);
}

function main(): void {
  const directory = mkdtempSync(join(tmpdir(), "pft-e2e-"));
  const databasePath = join(directory, "personal-finance.sqlite");
  const demoDatabasePath = join(directory, "personal-finance-demo.sqlite");
  const origin = e2eOrigin();
  const env = {
    ...process.env,
    DATABASE_PATH: databasePath,
    DEMO_DATABASE_PATH: demoDatabasePath,
    APP_URL: origin,
    TZ: APPLICATION_TIME_ZONE,
    [E2E_HARNESS_ENV]: E2E_HARNESS_ENABLED_VALUE,
    PORT: String(E2E_PORT),
  };

  for (const command of ["db:migrate", "db:migrate:demo", "db:seed:demo"]) {
    const migrated = spawnSync("npm", ["run", command], {
      cwd: repositoryRoot,
      env,
      stdio: "inherit",
    });

    if (migrated.error) {
      rmSync(directory, { recursive: true, force: true });
      fail(`${command} could not start: ${migrated.error.message}`);
    }

    if (migrated.status !== 0) {
      rmSync(directory, { recursive: true, force: true });
      fail(`${command} exited with ${String(migrated.status)}`);
    }
  }

  const server = spawn(
    join(repositoryRoot, "node_modules/.bin/next"),
    ["start", "-H", E2E_HOST, "-p", String(E2E_PORT)],
    {
      cwd: repositoryRoot,
      env,
      stdio: "inherit",
    },
  );

  function cleanup(): void {
    rmSync(directory, { recursive: true, force: true });
  }

  server.on("exit", (code, signal) => {
    cleanup();
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      server.kill(signal);
    });
  }
}

main();
