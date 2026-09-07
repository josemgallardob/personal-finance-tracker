/**
 * Real-file setup for classification and transaction schema tests.
 *
 * These helpers migrate and bootstrap an isolated SQLite file. They never stub
 * constraints, foreign keys or the driver.
 */

import { loadAppConfig } from "../../../src/shared/server/config";
import {
  closeSqliteConnection,
  openSqliteConnection,
  type SqliteConnection,
} from "../../../src/shared/server/database";
import { initializeDatabase } from "../../../src/shared/server/initialize";
import {
  createTemporarySqliteFile,
  createValidAppEnv,
} from "../helpers/sqlite";

/** Isolated database that already has the personal workspace. */
export interface InitializedSchemaFixture {
  readonly connection: SqliteConnection;
  readonly workspaceId: string;
  cleanup(): void;
}

/**
 * Opens a temporary SQLite file, applies committed migrations and creates the
 * implicit personal workspace.
 */
export function createInitializedSchemaFixture(): InitializedSchemaFixture {
  const file = createTemporarySqliteFile();
  const config = loadAppConfig(createValidAppEnv(file.filePath));

  if (!config.ok) {
    file.cleanup();
    throw new Error(`Expected valid configuration: ${JSON.stringify(config)}`);
  }

  const opened = openSqliteConnection(config.value);

  if (!opened.ok) {
    file.cleanup();
    throw new Error(`Expected an open connection: ${JSON.stringify(opened)}`);
  }

  const initialized = initializeDatabase(opened.value, {
    now: () => 1_746_268_800_000,
  });

  if (!initialized.ok) {
    opened.value.close();
    file.cleanup();
    throw new Error(
      `Expected a migrated database: ${JSON.stringify(initialized)}`,
    );
  }

  return {
    connection: opened.value,
    workspaceId: initialized.value.workspaceId,
    cleanup(): void {
      closeSqliteConnection();
      opened.value.close();
      file.cleanup();
    },
  };
}
