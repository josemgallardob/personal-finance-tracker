/**
 * Runs the production build with no SQLite file available.
 *
 * `DATABASE_PATH` points at a file inside a directory that does not exist, so
 * any attempt to open or create the database during `next build` fails loudly
 * instead of silently producing a file. The build must succeed and leave that
 * path untouched, which is the deployment contract: the image is built without
 * data and the database is migrated later by an operator.
 *
 * This replaces the plain build step in the quality check; the build itself is
 * still executed exactly once.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function fail(message: string): never {
  console.error(`Build verification failed: ${message}`);
  process.exit(1);
}

function main(): void {
  const directory = mkdtempSync(join(tmpdir(), "pft-build-no-database-"));
  const absentDirectory = join(directory, "absent");
  const databasePath = join(absentDirectory, "personal-finance.db");
  const demoDatabasePath = join(absentDirectory, "personal-finance-demo.db");

  try {
    const result = spawnSync("npm", ["run", "build"], {
      cwd: repositoryRoot,
      stdio: "inherit",
      env: {
        ...process.env,
        DATABASE_PATH: databasePath,
        DEMO_DATABASE_PATH: demoDatabasePath,
        APP_URL: "http://localhost:3000",
        TZ: "Europe/Madrid",
      },
    });

    if (result.error) {
      fail(`the build command could not start: ${result.error.message}`);
    }

    if (result.status !== 0) {
      fail(`the build exited with ${String(result.status)}`);
    }

    if (existsSync(absentDirectory)) {
      fail(`the build created the database directory ${absentDirectory}`);
    }

    for (const filePath of [databasePath, demoDatabasePath]) {
      for (const suffix of ["", "-wal", "-shm"]) {
        const artifact = `${filePath}${suffix}`;

        if (existsSync(artifact)) {
          fail(`the build created ${artifact}`);
        }
      }
    }

    console.log(
      "Built the production application without any SQLite file available.",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

main();
