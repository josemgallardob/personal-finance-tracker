/**
 * SQLite adapter of the category port.
 *
 * Reads and writes go through Drizzle on the handle the caller owns, so a use
 * case can put a lookup and the write that depends on it inside one
 * transaction. Uniqueness is decided by the partial unique index of the schema
 * and not by a previous read, so two writers that race for the same name cannot
 * both succeed. Every statement carries the workspace, so a row of another
 * workspace is invisible even when its identifier is known.
 *
 * Stored rows are rebuilt through the domain contract before they leave the
 * adapter. A row that no longer satisfies that contract is reported instead of
 * being handed over as if it were valid.
 */

import "server-only";

import { and, asc, eq, isNotNull, isNull, sql, type SQL } from "drizzle-orm";

import { category } from "../../../../db/schema";
import { nameKey, normalizeName } from "../../../shared/domain/text";
import {
  type ClassificationResult,
  failed,
  succeeded,
} from "../application/ports/classification-repository";
import type {
  ArchiveCategoryCommand,
  CategoryByIdQuery,
  CategoryByNameQuery,
  CategoryListQuery,
  CategoryRepository,
  InsertCategoryCommand,
  RenameCategoryCommand,
  ReorderCategoriesCommand,
} from "../application/ports/category-repository";
import {
  type Category,
  type CategoryId,
  createCategory,
} from "../domain/category";
import { describeCause, writeErrorCode } from "./sqlite-errors";
import type { SqliteUnitOfWork } from "./sqlite-unit-of-work";

/** Row of the `category` table as Drizzle returns it. */
interface CategoryRow {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly normalizedName: string;
  readonly type: string;
  readonly sortOrder: number;
  readonly archivedAt: number | null;
}

/** Keeps active categories before archived ones in every scoped list. */
const ACTIVE_FIRST = sql`case when ${category.archivedAt} is null then 0 else 1 end`;

function listCategories(
  unit: SqliteUnitOfWork,
  query: CategoryListQuery,
): ClassificationResult<readonly Category[]> {
  const rows = selectCategories(unit, listCondition(query));

  if (!rows.ok) {
    return rows;
  }

  return toCategories(rows.value);
}

function findCategoryById(
  unit: SqliteUnitOfWork,
  query: CategoryByIdQuery,
): ClassificationResult<Category | null> {
  return selectSingleCategory(
    unit,
    and(
      eq(category.workspaceId, query.workspaceId),
      eq(category.id, query.categoryId),
    ),
  );
}

function findActiveCategoryByNormalizedName(
  unit: SqliteUnitOfWork,
  query: CategoryByNameQuery,
): ClassificationResult<Category | null> {
  return selectSingleCategory(
    unit,
    and(
      eq(category.workspaceId, query.workspaceId),
      eq(category.type, query.type),
      eq(category.normalizedName, query.normalizedName),
      isNull(category.archivedAt),
    ),
  );
}

function insertCategory(
  unit: SqliteUnitOfWork,
  command: InsertCategoryCommand,
): ClassificationResult<Category> {
  const stored = command.category;

  try {
    unit.db
      .insert(category)
      .values({
        id: stored.id,
        workspaceId: command.workspaceId,
        name: stored.name,
        normalizedName: stored.normalizedName,
        type: stored.type,
        sortOrder: stored.sortOrder,
        archivedAt: stored.archivedAt,
      })
      .run();
  } catch (cause) {
    return failed(writeErrorCode(cause), describeCause(cause));
  }

  return succeeded(stored);
}

function renameCategory(
  unit: SqliteUnitOfWork,
  command: RenameCategoryCommand,
): ClassificationResult<Category> {
  let rows: CategoryRow[];

  try {
    rows = unit.db
      .update(category)
      .set({
        name: normalizeName(command.name),
        normalizedName: nameKey(command.name),
      })
      .where(
        and(
          eq(category.workspaceId, command.workspaceId),
          eq(category.id, command.categoryId),
        ),
      )
      .returning()
      .all();
  } catch (cause) {
    return failed(writeErrorCode(cause), describeCause(cause));
  }

  const [row] = rows;

  if (row === undefined) {
    return failed("categoryNotFound");
  }

  return toCategory(row);
}

function reorderCategories(
  unit: SqliteUnitOfWork,
  command: ReorderCategoriesCommand,
): ClassificationResult<readonly Category[]> {
  if (!unit.isTransactional) {
    return failed("transactionRequired");
  }

  const activeQuery: CategoryListQuery = {
    workspaceId: command.workspaceId,
    type: command.type,
    status: "active",
  };
  const active = listCategories(unit, activeQuery);

  if (!active.ok) {
    return active;
  }

  if (!isCompleteOrder(active.value, command.orderedCategoryIds)) {
    return failed("invalidCategoryOrder");
  }

  try {
    command.orderedCategoryIds.forEach((categoryId, position) => {
      unit.db
        .update(category)
        .set({ sortOrder: position })
        .where(
          and(
            eq(category.workspaceId, command.workspaceId),
            eq(category.id, categoryId),
          ),
        )
        .run();
    });
  } catch (cause) {
    return failed(writeErrorCode(cause), describeCause(cause));
  }

  return listCategories(unit, activeQuery);
}

function archiveCategory(
  unit: SqliteUnitOfWork,
  command: ArchiveCategoryCommand,
): ClassificationResult<Category> {
  let rows: CategoryRow[];

  try {
    rows = unit.db
      .update(category)
      .set({ archivedAt: command.archivedAt })
      .where(
        and(
          eq(category.workspaceId, command.workspaceId),
          eq(category.id, command.categoryId),
          isNull(category.archivedAt),
        ),
      )
      .returning()
      .all();
  } catch (cause) {
    return failed(writeErrorCode(cause), describeCause(cause));
  }

  const [row] = rows;

  if (row === undefined) {
    return refuseUnarchivableCategory(unit, command);
  }

  return toCategory(row);
}

/**
 * Explains why an archival wrote no row: the workspace has no such category, or
 * the category was already archived, here or by a writer that got there first.
 */
function refuseUnarchivableCategory(
  unit: SqliteUnitOfWork,
  command: ArchiveCategoryCommand,
): ClassificationResult<Category> {
  const existing = findCategoryById(unit, {
    workspaceId: command.workspaceId,
    categoryId: command.categoryId,
  });

  if (!existing.ok) {
    return existing;
  }

  return failed(
    existing.value === null ? "categoryNotFound" : "alreadyArchived",
  );
}

function listCondition(query: CategoryListQuery): SQL | undefined {
  const conditions: SQL[] = [eq(category.workspaceId, query.workspaceId)];

  if (query.type !== undefined) {
    conditions.push(eq(category.type, query.type));
  }

  if (query.status === "active") {
    conditions.push(isNull(category.archivedAt));
  }

  if (query.status === "archived") {
    conditions.push(isNotNull(category.archivedAt));
  }

  return and(...conditions);
}

function selectCategories(
  unit: SqliteUnitOfWork,
  where: SQL | undefined,
): ClassificationResult<readonly CategoryRow[]> {
  try {
    return succeeded(
      unit.db
        .select()
        .from(category)
        .where(where)
        .orderBy(
          ACTIVE_FIRST,
          asc(category.sortOrder),
          asc(category.normalizedName),
          asc(category.id),
        )
        .all(),
    );
  } catch (cause) {
    return failed("storageFailure", describeCause(cause));
  }
}

function selectSingleCategory(
  unit: SqliteUnitOfWork,
  where: SQL | undefined,
): ClassificationResult<Category | null> {
  const rows = selectCategories(unit, where);

  if (!rows.ok) {
    return rows;
  }

  const [row] = rows.value;

  if (row === undefined) {
    return succeeded(null);
  }

  return toCategory(row);
}

function toCategories(
  rows: readonly CategoryRow[],
): ClassificationResult<readonly Category[]> {
  const categories: Category[] = [];

  for (const row of rows) {
    const built = toCategory(row);

    if (!built.ok) {
      return built;
    }

    categories.push(built.value);
  }

  return succeeded(categories);
}

/**
 * Rebuilds a stored row through the domain contract and checks that the stored
 * comparison key still matches the name beside it.
 */
function toCategory(row: CategoryRow): ClassificationResult<Category> {
  const built = createCategory({
    id: row.id,
    name: row.name,
    type: row.type,
    sortOrder: row.sortOrder,
    archivedAt: row.archivedAt,
  });

  if (!built.ok) {
    return failed(
      "invalidStoredRow",
      built.errors.map((error) => `${error.field}:${error.code}`).join(","),
    );
  }

  if (built.value.normalizedName !== row.normalizedName) {
    return failed("invalidStoredRow", "normalizedName:mismatch");
  }

  return succeeded(built.value);
}

/** Tells whether an order is the complete, duplicate-free list of active rows. */
function isCompleteOrder(
  active: readonly Category[],
  ordered: readonly CategoryId[],
): boolean {
  if (ordered.length !== active.length) {
    return false;
  }

  const requested = new Set<string>(ordered);

  if (requested.size !== ordered.length) {
    return false;
  }

  return active.every((stored) => requested.has(stored.id));
}

/** Category port backed by a real SQLite file. */
export const sqliteCategoryRepository: CategoryRepository<SqliteUnitOfWork> = {
  listCategories,
  findCategoryById,
  findActiveCategoryByNormalizedName,
  insertCategory,
  renameCategory,
  reorderCategories,
  archiveCategory,
};
