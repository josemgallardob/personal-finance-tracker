/**
 * Real-file helpers for SQLite integration tests.
 *
 * Every helper creates or points at an isolated temporary file. Nothing here
 * stubs the driver, the PRAGMAs or the connection module under test.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { APPLICATION_TIME_ZONE } from "../../../src/shared/domain/clock";
import {
  APP_URL_ENV,
  DATABASE_PATH_ENV,
  type EnvSource,
  TIME_ZONE_ENV,
} from "../../../src/shared/server/config";

/** Isolated temporary SQLite file that the caller must clean up. */
export interface TemporarySqliteFile {
  readonly directory: string;
  readonly filePath: string;
  cleanup(): void;
}

/** Creates a unique directory and the path of a SQLite file inside it. */
export function createTemporarySqliteFile(): TemporarySqliteFile {
  const directory = mkdtempSync(join(tmpdir(), "pft-sqlite-"));
  const filePath = join(directory, "personal-finance.sqlite");

  return {
    directory,
    filePath,
    cleanup(): void {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

/** Environment map that satisfies the accepted server configuration. */
export function createValidAppEnv(
  filePath: string,
  overrides: EnvSource = {},
): EnvSource {
  return {
    [DATABASE_PATH_ENV]: filePath,
    [APP_URL_ENV]: "http://localhost:3000",
    [TIME_ZONE_ENV]: APPLICATION_TIME_ZONE,
    ...overrides,
  };
}
