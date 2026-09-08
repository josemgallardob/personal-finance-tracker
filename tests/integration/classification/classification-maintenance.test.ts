/**
 * Classification maintenance against a real, migrated SQLite file.
 *
 * The cases cover create, rename, complete reorder and archive for categories
 * and tags, including conflicts, type boundaries, assignability after archive,
 * history preserved on linked movements, and rollback of an invalid order.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DomainResult } from "../../../src/shared/domain/errors";
import { createClassificationMaintenance } from "../../../src/modules/classification/application/services/classification-maintenance";
import type {
  Category,
  CategoryId,
} from "../../../src/modules/classification/domain/category";
import { sqliteCategoryRepository } from "../../../src/modules/classification/infrastructure/sqlite-category-repository";
import { sqliteTagRepository } from "../../../src/modules/classification/infrastructure/sqlite-tag-repository";
import {
  autocommitUnitOfWork,
  runInTransaction,
} from "../../../src/modules/classification/infrastructure/sqlite-unit-of-work";
import {
  failed,
  succeeded,
  type ClassificationResult,
} from "../../../src/modules/classification/application/ports/classification-repository";
import type { SqliteConnection } from "../../../src/shared/server/database";
import {
  type ClassificationFixture,
  createClassificationFixture,
  errorCode,
} from "./helpers";

const NOW = 1_746_268_800_000;
const MOVEMENT_ID = "movement-history";
const MOVEMENT_AMOUNT = 1250;

let fixture: ClassificationFixture;
let workspaceId: string;
let ids: number;
let maintenance: ReturnType<
  typeof createClassificationMaintenance<
    ReturnType<typeof autocommitUnitOfWork>
  >
>;

beforeEach(() => {
  fixture = createClassificationFixture();
  workspaceId = fixture.workspaceId;
  ids = 0;
  maintenance = createClassificationMaintenance({
    categories: sqliteCategoryRepository,
    tags: sqliteTagRepository,
    createId,
    now: () => NOW,
  });
});

afterEach(() => {
  fixture.cleanup();
});

function createId(): string {
  ids += 1;
  return `id-${ids}`;
}

function unit() {
  return autocommitUnitOfWork(fixture.connection);
}

function okDomain<TValue>(result: DomainResult<TValue>): TValue {
  if (!result.ok) {
    throw new Error(`Expected success: ${JSON.stringify(result.errors)}`);
  }

  return result.value;
}

function errorsOf<TValue>(result: DomainResult<TValue>) {
  return result.ok ? [] : result.errors;
}

function insertMovement(
  connection: SqliteConnection,
  categoryId: string,
  type: string = "expense",
) {
  connection.sqlite
    .prepare(
      `INSERT INTO "transaction" (
         id, workspace_id, type, amount_minor, date, category_id,
         concept, note, created_at, updated_at
       ) VALUES (?, ?, ?, ?, '2026-04-15', ?, NULL, NULL, ?, ?)`,
    )
    .run(MOVEMENT_ID, workspaceId, type, MOVEMENT_AMOUNT, categoryId, NOW, NOW);
}

function storedMovement() {
  return fixture.connection.sqlite
    .prepare(
      `SELECT id, type, amount_minor AS amountMinor, category_id AS categoryId
       FROM "transaction" WHERE id = ?`,
    )
    .get(MOVEMENT_ID) as {
    id: string;
    type: string;
    amountMinor: number;
    categoryId: string;
  };
}

describe("category maintenance", () => {
  it("creates an expense category and appends it after the current order", () => {
    const first = okDomain(
      maintenance.createCategory(unit(), {
        workspaceId,
        name: "  Casa  ",
        type: "expense",
      }),
    );
    const second = okDomain(
      maintenance.createCategory(unit(), {
        workspaceId,
        name: "Ocio",
        type: "expense",
      }),
    );
    const income = okDomain(
      maintenance.createCategory(unit(), {
        workspaceId,
        name: "Sueldo",
        type: "income",
      }),
    );

    expect(first).toMatchObject({
      id: "id-1",
      name: "Casa",
      normalizedName: "casa",
      type: "expense",
      sortOrder: 0,
      archivedAt: null,
    });
    expect(second.sortOrder).toBe(1);
    expect(income).toMatchObject({ type: "income", sortOrder: 0 });
  });

  it("refuses an invalid type and a duplicate active name as field errors", () => {
    okDomain(
      maintenance.createCategory(unit(), {
        workspaceId,
        name: "Casa",
        type: "expense",
      }),
    );

    expect(
      errorsOf(
        maintenance.createCategory(unit(), {
          workspaceId,
          name: "Viajes",
          type: "gasto",
        }),
      ),
    ).toEqual([{ field: "type", code: "invalidTransactionType" }]);
    expect(
      errorsOf(
        maintenance.createCategory(unit(), {
          workspaceId,
          name: "  CASA ",
          type: "expense",
        }),
      ),
    ).toEqual([{ field: "name", code: "duplicateName" }]);
    expect(
      errorsOf(
        maintenance.createCategory(unit(), {
          workspaceId: "missing-workspace",
          name: "Viajes",
          type: "expense",
        }),
      ),
    ).toEqual([{ field: "workspaceId", code: "notFound" }]);
  });

  it("renames a category without changing its type or linked movement history", () => {
    const category = okDomain(
      maintenance.createCategory(unit(), {
        workspaceId,
        name: "Casa",
        type: "expense",
      }),
    );
    insertMovement(fixture.connection, category.id);

    const renamed = okDomain(
      maintenance.renameCategory(unit(), {
        workspaceId,
        categoryId: category.id,
        name: "  Hogar  ",
      }),
    );

    expect(renamed).toMatchObject({
      id: category.id,
      name: "Hogar",
      type: "expense",
      sortOrder: 0,
    });
    expect(storedMovement()).toEqual({
      id: MOVEMENT_ID,
      type: "expense",
      amountMinor: MOVEMENT_AMOUNT,
      categoryId: category.id,
    });
    expect(
      errorsOf(
        maintenance.renameCategory(unit(), {
          workspaceId,
          categoryId: "not valid",
          name: "Otro",
        }),
      ),
    ).toEqual([{ field: "categoryId", code: "invalidIdentifier" }]);
    expect(
      errorsOf(
        maintenance.renameCategory(unit(), {
          workspaceId,
          categoryId: "missing-category",
          name: "Otro",
        }),
      ),
    ).toEqual([{ field: "categoryId", code: "notFound" }]);
  });

  it("refuses a colliding rename and never exposes it as a storage failure", () => {
    okDomain(
      maintenance.createCategory(unit(), {
        workspaceId,
        name: "Casa",
        type: "expense",
      }),
    );
    const ocio = okDomain(
      maintenance.createCategory(unit(), {
        workspaceId,
        name: "Ocio",
        type: "expense",
      }),
    );

    expect(
      errorsOf(
        maintenance.renameCategory(unit(), {
          workspaceId,
          categoryId: ocio.id,
          name: "casa",
        }),
      ),
    ).toEqual([{ field: "name", code: "duplicateName" }]);
    expect(
      sqliteCategoryRepository.findCategoryById(unit(), {
        workspaceId,
        categoryId: ocio.id as CategoryId,
      }),
    ).toMatchObject({ ok: true, value: { name: "Ocio" } });
  });

  it("reorders only the complete active set of one type", () => {
    const casa = okDomain(
      maintenance.createCategory(unit(), {
        workspaceId,
        name: "Casa",
        type: "expense",
      }),
    );
    const ocio = okDomain(
      maintenance.createCategory(unit(), {
        workspaceId,
        name: "Ocio",
        type: "expense",
      }),
    );
    okDomain(
      maintenance.createCategory(unit(), {
        workspaceId,
        name: "Sueldo",
        type: "income",
      }),
    );

    const reordered: ClassificationResult<readonly Category[]> =
      runInTransaction(fixture.connection, (transaction) => {
        const result = maintenance.reorderCategories(transaction, {
          workspaceId,
          type: "expense",
          orderedCategoryIds: [ocio.id, casa.id],
        });

        return result.ok
          ? succeeded(result.value)
          : failed<readonly Category[]>("invalidCategoryOrder");
      });

    expect(reordered.ok).toBe(true);
    if (!reordered.ok) {
      return;
    }

    expect(reordered.value.map((row: Category) => row.id)).toEqual([
      ocio.id,
      casa.id,
    ]);
    expect(reordered.value.map((row: Category) => row.sortOrder)).toEqual([
      0, 1,
    ]);
  });

  it("rolls back an invalid complete order together with earlier writes", () => {
    const casa = okDomain(
      maintenance.createCategory(unit(), {
        workspaceId,
        name: "Casa",
        type: "expense",
      }),
    );
    okDomain(
      maintenance.createCategory(unit(), {
        workspaceId,
        name: "Ocio",
        type: "expense",
      }),
    );

    const result = runInTransaction(fixture.connection, (transaction) => {
      const tag = maintenance.createTag(transaction, {
        workspaceId,
        name: "Navidad",
      });

      if (!tag.ok) {
        return failed("storageFailure", JSON.stringify(tag.errors));
      }

      const reordered = maintenance.reorderCategories(transaction, {
        workspaceId,
        type: "expense",
        orderedCategoryIds: [casa.id],
      });

      return reordered.ok
        ? succeeded(reordered.value)
        : failed("invalidCategoryOrder");
    });

    expect(errorCode(result)).toBe("invalidCategoryOrder");
    expect(
      sqliteTagRepository.listTags(unit(), { workspaceId, status: "all" }),
    ).toMatchObject({ ok: true, value: [] });
    expect(
      sqliteCategoryRepository.findCategoryById(unit(), {
        workspaceId,
        categoryId: casa.id as CategoryId,
      }),
    ).toMatchObject({ ok: true, value: { sortOrder: 0, name: "Casa" } });
  });

  it("refuses reorder of an unknown type or of identifiers that are not ids", () => {
    expect(
      errorsOf(
        maintenance.reorderCategories(unit(), {
          workspaceId,
          type: "gasto",
          orderedCategoryIds: ["id-1"],
        }),
      ),
    ).toEqual([{ field: "type", code: "invalidTransactionType" }]);
    expect(
      errorsOf(
        maintenance.reorderCategories(unit(), {
          workspaceId,
          type: "expense",
          orderedCategoryIds: ["not valid"],
        }),
      ),
    ).toEqual([{ field: "orderedCategoryIds", code: "invalidSortOrder" }]);
    expect(
      errorsOf(
        maintenance.reorderCategories(unit(), {
          workspaceId,
          type: "expense",
          orderedCategoryIds: ["id-1"],
        }),
      ),
    ).toEqual([{ field: "orderedCategoryIds", code: "invalidSortOrder" }]);
  });

  it("archives a used category, keeps its history and forbids a new assignment", () => {
    const category = okDomain(
      maintenance.createCategory(unit(), {
        workspaceId,
        name: "Casa",
        type: "expense",
      }),
    );
    insertMovement(fixture.connection, category.id);

    const archived = okDomain(
      maintenance.archiveCategory(unit(), {
        workspaceId,
        categoryId: category.id,
      }),
    );

    expect(archived.archivedAt).toBe(NOW);
    expect(storedMovement()).toEqual({
      id: MOVEMENT_ID,
      type: "expense",
      amountMinor: MOVEMENT_AMOUNT,
      categoryId: category.id,
    });
    expect(
      errorsOf(
        maintenance.requireAssignableCategory(unit(), {
          workspaceId,
          categoryId: category.id,
          type: "expense",
        }),
      ),
    ).toEqual([{ field: "categoryId", code: "archived" }]);
    expect(
      errorsOf(
        maintenance.archiveCategory(unit(), {
          workspaceId,
          categoryId: category.id,
        }),
      ),
    ).toEqual([{ field: "categoryId", code: "alreadyArchived" }]);
  });

  it("does not allow assigning a missing or wrong-type category", () => {
    const expense = okDomain(
      maintenance.createCategory(unit(), {
        workspaceId,
        name: "Casa",
        type: "expense",
      }),
    );

    expect(
      maintenance.requireAssignableCategory(unit(), {
        workspaceId,
        categoryId: expense.id,
        type: "expense",
      }),
    ).toMatchObject({ ok: true, value: { id: expense.id, type: "expense" } });
    expect(
      errorsOf(
        maintenance.requireAssignableCategory(unit(), {
          workspaceId,
          categoryId: expense.id,
          type: "income",
        }),
      ),
    ).toEqual([{ field: "type", code: "incompatibleCategoryType" }]);
    expect(
      errorsOf(
        maintenance.requireAssignableCategory(unit(), {
          workspaceId,
          categoryId: "missing-category",
          type: "expense",
        }),
      ),
    ).toEqual([{ field: "categoryId", code: "notFound" }]);
    expect(
      errorsOf(
        maintenance.requireAssignableCategory(unit(), {
          workspaceId,
          categoryId: "bad id",
          type: "expense",
        }),
      ),
    ).toEqual([{ field: "categoryId", code: "invalidIdentifier" }]);
    expect(
      errorsOf(
        maintenance.requireAssignableCategory(unit(), {
          workspaceId,
          categoryId: expense.id,
          type: "gasto",
        }),
      ),
    ).toEqual([{ field: "type", code: "invalidTransactionType" }]);
  });
});

describe("tag maintenance", () => {
  it("creates, renames and archives a tag without changing linked history", () => {
    const category = okDomain(
      maintenance.createCategory(unit(), {
        workspaceId,
        name: "Casa",
        type: "expense",
      }),
    );
    const tag = okDomain(
      maintenance.createTag(unit(), {
        workspaceId,
        name: "  Navidad  ",
      }),
    );
    insertMovement(fixture.connection, category.id);
    fixture.connection.sqlite
      .prepare(
        `INSERT INTO transaction_tag (transaction_id, tag_id, workspace_id)
         VALUES (?, ?, ?)`,
      )
      .run(MOVEMENT_ID, tag.id, workspaceId);

    const renamed = okDomain(
      maintenance.renameTag(unit(), {
        workspaceId,
        tagId: tag.id,
        name: "Fiestas",
      }),
    );
    const archived = okDomain(
      maintenance.archiveTag(unit(), {
        workspaceId,
        tagId: tag.id,
      }),
    );

    expect(renamed).toMatchObject({
      id: tag.id,
      name: "Fiestas",
      normalizedName: "fiestas",
    });
    expect(archived.archivedAt).toBe(NOW);
    expect(storedMovement().amountMinor).toBe(MOVEMENT_AMOUNT);
    expect(
      fixture.connection.sqlite
        .prepare(
          "SELECT tag_id AS tagId FROM transaction_tag WHERE transaction_id = ?",
        )
        .get(MOVEMENT_ID),
    ).toEqual({ tagId: tag.id });
    expect(
      errorsOf(
        maintenance.requireAssignableTag(unit(), {
          workspaceId,
          tagId: tag.id,
        }),
      ),
    ).toEqual([{ field: "tagId", code: "archived" }]);
  });

  it("refuses duplicate tag names and missing identifiers as field errors", () => {
    const tag = okDomain(
      maintenance.createTag(unit(), {
        workspaceId,
        name: "Navidad",
      }),
    );
    okDomain(
      maintenance.createTag(unit(), {
        workspaceId,
        name: "Trabajo",
      }),
    );

    expect(
      errorsOf(
        maintenance.createTag(unit(), {
          workspaceId,
          name: "navidad",
        }),
      ),
    ).toEqual([{ field: "name", code: "duplicateName" }]);
    expect(
      errorsOf(
        maintenance.renameTag(unit(), {
          workspaceId,
          tagId: tag.id,
          name: "trabajo",
        }),
      ),
    ).toEqual([{ field: "name", code: "duplicateName" }]);
    expect(
      errorsOf(
        maintenance.renameTag(unit(), {
          workspaceId,
          tagId: "missing-tag",
          name: "Otro",
        }),
      ),
    ).toEqual([{ field: "tagId", code: "notFound" }]);
    expect(
      errorsOf(
        maintenance.renameTag(unit(), {
          workspaceId,
          tagId: "bad id",
          name: "Otro",
        }),
      ),
    ).toEqual([{ field: "tagId", code: "invalidIdentifier" }]);
    expect(
      errorsOf(
        maintenance.archiveTag(unit(), {
          workspaceId,
          tagId: "bad id",
        }),
      ),
    ).toEqual([{ field: "tagId", code: "invalidIdentifier" }]);
    expect(
      errorsOf(
        maintenance.archiveCategory(unit(), {
          workspaceId,
          categoryId: "bad id",
        }),
      ),
    ).toEqual([{ field: "categoryId", code: "invalidIdentifier" }]);
    okDomain(
      maintenance.archiveTag(unit(), {
        workspaceId,
        tagId: tag.id,
      }),
    );
    expect(
      errorsOf(
        maintenance.archiveTag(unit(), {
          workspaceId,
          tagId: tag.id,
        }),
      ),
    ).toEqual([{ field: "tagId", code: "alreadyArchived" }]);
    expect(
      errorsOf(
        maintenance.requireAssignableTag(unit(), {
          workspaceId,
          tagId: "missing-tag",
        }),
      ),
    ).toEqual([{ field: "tagId", code: "notFound" }]);
    expect(
      errorsOf(
        maintenance.requireAssignableTag(unit(), {
          workspaceId,
          tagId: "bad id",
        }),
      ),
    ).toEqual([{ field: "tagId", code: "invalidIdentifier" }]);
  });

  it("accepts an active tag for a new assignment", () => {
    const tag = okDomain(
      maintenance.createTag(unit(), {
        workspaceId,
        name: "Trabajo",
      }),
    );

    expect(
      maintenance.requireAssignableTag(unit(), {
        workspaceId,
        tagId: tag.id,
      }),
    ).toMatchObject({ ok: true, value: { name: "Trabajo" } });
  });

  it("refuses an empty tag name before touching storage", () => {
    expect(
      errorsOf(
        maintenance.createTag(unit(), {
          workspaceId,
          name: "   ",
        }),
      ),
    ).toEqual([{ field: "name", code: "required" }]);
    expect(
      sqliteTagRepository.listTags(unit(), { workspaceId, status: "all" }),
    ).toMatchObject({ ok: true, value: [] });
  });
});

describe("invalid technical timestamps", () => {
  it("refuses to archive when the clock is not a timestamp", () => {
    const broken = createClassificationMaintenance({
      categories: sqliteCategoryRepository,
      tags: sqliteTagRepository,
      createId,
      now: () => -1,
    });
    const category = okDomain(
      maintenance.createCategory(unit(), {
        workspaceId,
        name: "Casa",
        type: "expense",
      }),
    );
    const tag = okDomain(
      maintenance.createTag(unit(), {
        workspaceId,
        name: "Navidad",
      }),
    );

    expect(
      errorsOf(
        broken.archiveCategory(unit(), {
          workspaceId,
          categoryId: category.id,
        }),
      ),
    ).toEqual([{ field: "archivedAt", code: "invalidTimestamp" }]);
    expect(
      errorsOf(
        broken.archiveTag(unit(), {
          workspaceId,
          tagId: tag.id,
        }),
      ),
    ).toEqual([{ field: "archivedAt", code: "invalidTimestamp" }]);
  });
});
