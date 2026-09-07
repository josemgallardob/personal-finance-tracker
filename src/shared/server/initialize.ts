/**
 * Explicit database initialization.
 *
 * A process calls this from a migration command or a test, never from a
 * request adapter and never during `next build`. Migrations run first; the
 * personal workspace is created only after every file has been applied.
 */

import "server-only";

import { bootstrapPersonalWorkspace } from "../../modules/preferences/server/bootstrap";
import type { SqliteConnection } from "./database";
import {
  applyMigrations,
  DEFAULT_MIGRATIONS_FOLDER,
  type MigrationError,
} from "./migrate";

/** Outcome of migrating and bootstrapping a database file. */
export type InitializeResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly applied: readonly string[];
        readonly skipped: readonly string[];
        readonly workspaceId: string;
        readonly createdWorkspace: boolean;
      };
    }
  | {
      readonly ok: false;
      readonly error:
        | MigrationError
        | { readonly code: "bootstrapFailed"; readonly cause: string };
    };

/**
 * Applies pending migrations and ensures the implicit personal workspace.
 */
export function initializeDatabase(
  connection: SqliteConnection,
  options: {
    readonly migrationsFolder?: string;
    readonly now?: () => number;
  } = {},
): InitializeResult {
  const migrated = applyMigrations(
    connection,
    options.migrationsFolder ?? DEFAULT_MIGRATIONS_FOLDER,
  );

  if (!migrated.ok) {
    return migrated;
  }

  const bootstrapped = bootstrapPersonalWorkspace(connection, options.now);

  if (!bootstrapped.ok) {
    return bootstrapped;
  }

  return {
    ok: true,
    value: {
      applied: migrated.value.applied,
      skipped: migrated.value.skipped,
      workspaceId: bootstrapped.value.workspaceId,
      createdWorkspace: bootstrapped.value.created,
    },
  };
}
