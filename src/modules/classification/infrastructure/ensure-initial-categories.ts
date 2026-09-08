/**
 * SQLite composition of the initial category seed.
 *
 * Initialization owns the transaction. The use case never opens one, and the
 * adapters never seed on their own: this function is the only place that pairs
 * the accepted catalog with the real category port.
 */

import "server-only";

import type { SqliteConnection } from "../../../shared/server/database";
import type { ClassificationResult } from "../application/ports/classification-repository";
import {
  seedCategories,
  type SeedCategoriesResult,
} from "../application/seed-categories";
import { sqliteCategoryRepository } from "./sqlite-category-repository";
import { runInTransaction } from "./sqlite-unit-of-work";

/** Seeds the accepted catalog for a workspace in one SQL transaction. */
export function ensureInitialCategories(
  connection: SqliteConnection,
  workspaceId: string,
): ClassificationResult<SeedCategoriesResult> {
  return runInTransaction(connection, (unit) =>
    seedCategories(unit, sqliteCategoryRepository, { workspaceId }),
  );
}
