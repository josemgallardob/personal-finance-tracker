/**
 * Idempotent seed of the accepted initial category catalog.
 *
 * The use case inserts only missing seed identifiers. A row that already
 * exists is left untouched, so a rename, a new order or an archive survives
 * the next bootstrap. An active category that already owns a seed name with a
 * different identifier is also left alone: the seed is skipped instead of
 * duplicating or overwriting that user row.
 */

import { createCategory } from "../domain/category";
import {
  INITIAL_CATEGORY_CATALOG,
  type InitialCategorySeed,
} from "../domain/initial-category-catalog";
import type { CategoryRepository } from "./ports/category-repository";
import {
  type ClassificationResult,
  failed,
  succeeded,
} from "./ports/classification-repository";
import type { UnitOfWork } from "./ports/unit-of-work";

/** Outcome of one idempotent seed run. */
export interface SeedCategoriesResult {
  readonly insertedIds: readonly string[];
  readonly unchangedIds: readonly string[];
  readonly collidedIds: readonly string[];
}

/** Workspace to seed and an optional catalog override for failure tests. */
export interface SeedCategoriesCommand {
  readonly workspaceId: string;
  readonly catalog?: readonly InitialCategorySeed[];
}

/**
 * Inserts the missing catalog rows inside the caller's transaction.
 *
 * The catalog writes several rows, so an autocommit unit is refused. A
 * definition that cannot become a category is reported instead of writing a
 * partial list.
 */
export function seedCategories<TUnit extends UnitOfWork>(
  unit: TUnit,
  repository: CategoryRepository<TUnit>,
  command: SeedCategoriesCommand,
): ClassificationResult<SeedCategoriesResult> {
  if (!unit.isTransactional) {
    return failed("transactionRequired");
  }

  const catalog = command.catalog ?? INITIAL_CATEGORY_CATALOG;
  const insertedIds: string[] = [];
  const unchangedIds: string[] = [];
  const collidedIds: string[] = [];

  for (const seed of catalog) {
    const sortOrder = sortOrderFor(seed, catalog);
    const built = createCategory({
      id: seed.id,
      name: seed.name,
      type: seed.type,
      sortOrder,
      archivedAt: null,
    });

    if (!built.ok) {
      return failed(
        "invalidStoredRow",
        built.errors.map((error) => `${error.field}:${error.code}`).join(","),
      );
    }

    const existing = repository.findCategoryById(unit, {
      workspaceId: command.workspaceId,
      categoryId: built.value.id,
    });

    if (!existing.ok) {
      return existing;
    }

    if (existing.value !== null) {
      unchangedIds.push(seed.id);
      continue;
    }

    const collision = repository.findActiveCategoryByNormalizedName(unit, {
      workspaceId: command.workspaceId,
      type: built.value.type,
      normalizedName: built.value.normalizedName,
    });

    if (!collision.ok) {
      return collision;
    }

    if (collision.value !== null) {
      collidedIds.push(seed.id);
      continue;
    }

    const inserted = repository.insertCategory(unit, {
      workspaceId: command.workspaceId,
      category: built.value,
    });

    if (!inserted.ok) {
      return inserted;
    }

    insertedIds.push(seed.id);
  }

  return succeeded({ insertedIds, unchangedIds, collidedIds });
}

/**
 * Position of a seed inside its type in the catalog actually being written.
 *
 * The production catalog uses the accepted US-03 order. A test catalog can
 * supply a subset, and each row still gets a non-negative order from that
 * subset instead of from the full production list.
 */
function sortOrderFor(
  seed: InitialCategorySeed,
  catalog: readonly InitialCategorySeed[],
): number {
  return catalog
    .filter((item) => item.type === seed.type)
    .findIndex((item) => item.id === seed.id);
}
