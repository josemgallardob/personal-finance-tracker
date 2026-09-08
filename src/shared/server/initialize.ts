/**
 * Explicit database initialization.
 *
 * A process calls this from a migration command or a test, never from a
 * request adapter and never during `next build`. Migrations run first; the
 * personal workspace and its accepted category catalog are created only after
 * every file has been applied.
 */

import "server-only";

import { ensureInitialCategories } from "../../modules/classification/infrastructure/ensure-initial-categories";
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
        | { readonly code: "bootstrapFailed"; readonly cause: string }
        | { readonly code: "seedFailed"; readonly cause: string };
    };

/**
 * Applies pending migrations, ensures the implicit personal workspace and
 * seeds the accepted category catalog. The catalog seed is idempotent: a
 * second call after restart does not duplicate rows or undo user edits.
 */
export function initializeDatabase(
  connection: SqliteConnection,
  options: {
    readonly migrationsFolder?: string;
    readonly now?: () => number;
    /**
     * When false, skips the accepted category catalog. Repository and schema
     * fixtures use this so they can insert their own rows without colliding
     * with the seed identifiers. Production initialization always seeds.
     */
    readonly seedCategories?: boolean;
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

  if (options.seedCategories !== false) {
    const seeded = ensureInitialCategories(
      connection,
      bootstrapped.value.workspaceId,
    );

    if (!seeded.ok) {
      return {
        ok: false,
        error: {
          code: "seedFailed",
          cause: [seeded.error.code, seeded.error.cause].join(":"),
        },
      };
    }
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
