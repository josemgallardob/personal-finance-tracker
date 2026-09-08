/**
 * Category repository against a real, migrated SQLite file.
 *
 * The cases cover the scoped reads, the four mutations, the refusals of each
 * one, the isolation between workspaces and the races two writers can lose.
 */

import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CategoryId } from "../../../src/modules/classification/domain/category";
import { sqliteCategoryRepository } from "../../../src/modules/classification/infrastructure/sqlite-category-repository";
import {
  autocommitUnitOfWork,
  runInTransaction,
  type SqliteUnitOfWork,
} from "../../../src/modules/classification/infrastructure/sqlite-unit-of-work";
import type { Timestamp } from "../../../src/shared/domain/timestamp";
import {
  type ClassificationFixture,
  createClassificationFixture,
  errorCode,
  newCategory,
  okValue,
} from "./helpers";

const ARCHIVED_AT = 1_746_268_800_000 as Timestamp;

let fixture: ClassificationFixture;
let unit: SqliteUnitOfWork;
let workspaceId: string;

beforeEach(() => {
  fixture = createClassificationFixture();
  unit = autocommitUnitOfWork(fixture.connection);
  workspaceId = fixture.workspaceId;
});

afterEach(() => {
  fixture.cleanup();
});

function insert(name: string, type: "expense" | "income", sortOrder: number) {
  const stored = newCategory(name, type, sortOrder);

  return okValue(
    sqliteCategoryRepository.insertCategory(unit, {
      workspaceId,
      category: stored,
    }),
  );
}

function activeNames(type?: "expense" | "income"): readonly string[] {
  return okValue(
    sqliteCategoryRepository.listCategories(unit, {
      workspaceId,
      status: "active",
      type,
    }),
  ).map((stored) => stored.name);
}

describe("scoped category reads", () => {
  it("stores an inserted category and reads it back by identifier", () => {
    const stored = insert("Supermercado", "expense", 0);

    const found = okValue(
      sqliteCategoryRepository.findCategoryById(unit, {
        workspaceId,
        categoryId: stored.id,
      }),
    );

    expect(found).toEqual({
      id: stored.id,
      name: "Supermercado",
      normalizedName: "supermercado",
      type: "expense",
      sortOrder: 0,
      archivedAt: null,
    });
  });

  it("lists active categories by order, then name, then identifier", () => {
    insert("Vivienda", "expense", 2);
    insert("Ocio", "expense", 1);
    insert("Casa", "expense", 1);
    insert("Sueldo", "income", 0);

    expect(activeNames("expense")).toEqual(["Casa", "Ocio", "Vivienda"]);
    expect(activeNames("income")).toEqual(["Sueldo"]);
    expect(activeNames()).toEqual(["Sueldo", "Casa", "Ocio", "Vivienda"]);
  });

  it("keeps archived categories after the active ones and orders ties by identifier", () => {
    const first = insert("Gimnasio", "expense", 0);
    okValue(
      sqliteCategoryRepository.archiveCategory(unit, {
        workspaceId,
        categoryId: first.id,
        archivedAt: ARCHIVED_AT,
      }),
    );
    const second = insert("Gimnasio", "expense", 0);
    okValue(
      sqliteCategoryRepository.archiveCategory(unit, {
        workspaceId,
        categoryId: second.id,
        archivedAt: ARCHIVED_AT,
      }),
    );
    const active = insert("Viajes", "expense", 1);

    const archived = okValue(
      sqliteCategoryRepository.listCategories(unit, {
        workspaceId,
        status: "archived",
      }),
    );
    const all = okValue(
      sqliteCategoryRepository.listCategories(unit, {
        workspaceId,
        status: "all",
      }),
    );

    const expectedTie = [first.id, second.id].sort();
    expect(archived.map((stored) => stored.id)).toEqual(expectedTie);
    expect(all.map((stored) => stored.id)).toEqual([active.id, ...expectedTie]);
  });

  it("finds only the active category that holds a normalized name in its type", () => {
    const expense = insert("Café", "expense", 0);
    insert("Café", "income", 0);

    const byName = okValue(
      sqliteCategoryRepository.findActiveCategoryByNormalizedName(unit, {
        workspaceId,
        type: "expense",
        normalizedName: "café",
      }),
    );
    const withoutAccent = okValue(
      sqliteCategoryRepository.findActiveCategoryByNormalizedName(unit, {
        workspaceId,
        type: "expense",
        normalizedName: "cafe",
      }),
    );

    expect(byName?.id).toBe(expense.id);
    expect(withoutAccent).toBeNull();

    okValue(
      sqliteCategoryRepository.archiveCategory(unit, {
        workspaceId,
        categoryId: expense.id,
        archivedAt: ARCHIVED_AT,
      }),
    );

    expect(
      okValue(
        sqliteCategoryRepository.findActiveCategoryByNormalizedName(unit, {
          workspaceId,
          type: "expense",
          normalizedName: "café",
        }),
      ),
    ).toBeNull();
  });

  it("hides every row from another workspace", () => {
    const stored = insert("Transporte", "expense", 0);
    const foreignWorkspaceId = randomUUID();

    expect(
      okValue(
        sqliteCategoryRepository.listCategories(unit, {
          workspaceId: foreignWorkspaceId,
          status: "all",
        }),
      ),
    ).toEqual([]);
    expect(
      okValue(
        sqliteCategoryRepository.findCategoryById(unit, {
          workspaceId: foreignWorkspaceId,
          categoryId: stored.id,
        }),
      ),
    ).toBeNull();
    expect(
      okValue(
        sqliteCategoryRepository.findActiveCategoryByNormalizedName(unit, {
          workspaceId: foreignWorkspaceId,
          type: "expense",
          normalizedName: "transporte",
        }),
      ),
    ).toBeNull();
  });

  it("reports a stored comparison key that no longer matches its name", () => {
    const stored = insert("Salud", "expense", 0);
    fixture.connection.sqlite
      .prepare("UPDATE category SET normalized_name = ? WHERE id = ?")
      .run("otra", stored.id);

    const byId = sqliteCategoryRepository.findCategoryById(unit, {
      workspaceId,
      categoryId: stored.id,
    });
    const listed = sqliteCategoryRepository.listCategories(unit, {
      workspaceId,
      status: "all",
    });

    expect(byId).toEqual({
      ok: false,
      error: { code: "invalidStoredRow", cause: "normalizedName:mismatch" },
    });
    expect(errorCode(listed)).toBe("invalidStoredRow");
  });

  it("reports a stored row the domain contract would reject", () => {
    const stored = insert("Casa", "expense", 0);
    const tooLongName = "a".repeat(81);
    fixture.connection.sqlite
      .prepare("UPDATE category SET name = ?, normalized_name = ? WHERE id = ?")
      .run(tooLongName, tooLongName, stored.id);

    expect(
      sqliteCategoryRepository.findCategoryById(unit, {
        workspaceId,
        categoryId: stored.id,
      }),
    ).toEqual({
      ok: false,
      error: { code: "invalidStoredRow", cause: "name:tooLong" },
    });
  });

  it("refuses to reorder while a stored row is unreadable", () => {
    const casa = insert("Casa", "expense", 0);
    const ocio = insert("Ocio", "expense", 1);
    fixture.connection.sqlite
      .prepare("UPDATE category SET normalized_name = ? WHERE id = ?")
      .run("otra", ocio.id);

    const result = runInTransaction(fixture.connection, (transactional) =>
      sqliteCategoryRepository.reorderCategories(transactional, {
        workspaceId,
        type: "expense",
        orderedCategoryIds: [ocio.id, casa.id],
      }),
    );

    expect(errorCode(result)).toBe("invalidStoredRow");
  });

  it("reports a controlled failure when the connection is closed", () => {
    fixture.connection.close();

    expect(
      errorCode(
        sqliteCategoryRepository.listCategories(unit, {
          workspaceId,
          status: "active",
        }),
      ),
    ).toBe("storageFailure");
    expect(
      errorCode(
        sqliteCategoryRepository.findCategoryById(unit, {
          workspaceId,
          categoryId: randomUUID() as CategoryId,
        }),
      ),
    ).toBe("storageFailure");
    expect(
      errorCode(
        sqliteCategoryRepository.insertCategory(unit, {
          workspaceId,
          category: newCategory("Casa", "expense", 0),
        }),
      ),
    ).toBe("storageFailure");
  });
});

describe("category insertion", () => {
  it("refuses a name already used by an active category of the same type", () => {
    insert("Ocio", "expense", 0);

    const duplicate = sqliteCategoryRepository.insertCategory(unit, {
      workspaceId,
      category: newCategory("  OCIO  ", "expense", 1),
    });

    expect(errorCode(duplicate)).toBe("duplicateName");
    expect(activeNames("expense")).toEqual(["Ocio"]);
  });

  it("accepts the same name in the other type and after the active row is archived", () => {
    const expense = insert("Regalos", "expense", 0);

    expect(
      errorCode(
        sqliteCategoryRepository.insertCategory(unit, {
          workspaceId,
          category: newCategory("Regalos", "income", 0),
        }),
      ),
    ).toBe("ok");

    okValue(
      sqliteCategoryRepository.archiveCategory(unit, {
        workspaceId,
        categoryId: expense.id,
        archivedAt: ARCHIVED_AT,
      }),
    );

    expect(
      errorCode(
        sqliteCategoryRepository.insertCategory(unit, {
          workspaceId,
          category: newCategory("Regalos", "expense", 1),
        }),
      ),
    ).toBe("ok");
  });

  it("refuses an identifier that already exists", () => {
    const stored = insert("Moda", "expense", 0);

    const repeated = sqliteCategoryRepository.insertCategory(unit, {
      workspaceId,
      category: { ...newCategory("Libros", "expense", 1), id: stored.id },
    });

    expect(errorCode(repeated)).toBe("duplicateId");
  });

  it("refuses a workspace that does not exist", () => {
    const result = sqliteCategoryRepository.insertCategory(unit, {
      workspaceId: randomUUID(),
      category: newCategory("Tabaco", "expense", 0),
    });

    expect(errorCode(result)).toBe("unknownWorkspace");
  });

  it("lets the database decide a race between two writers", () => {
    const writer = fixture.openWriter();
    const writerUnit = autocommitUnitOfWork(writer);

    const free = okValue(
      sqliteCategoryRepository.findActiveCategoryByNormalizedName(writerUnit, {
        workspaceId,
        type: "expense",
        normalizedName: "viajes",
      }),
    );
    insert("Viajes", "expense", 0);

    const late = sqliteCategoryRepository.insertCategory(writerUnit, {
      workspaceId,
      category: newCategory("Viajes", "expense", 1),
    });

    expect(free).toBeNull();
    expect(errorCode(late)).toBe("duplicateName");
    expect(activeNames("expense")).toEqual(["Viajes"]);
  });
});

describe("category rename", () => {
  it("stores the normalized written form and its comparison key", () => {
    const stored = insert("Ocio", "expense", 3);

    const renamed = okValue(
      sqliteCategoryRepository.renameCategory(unit, {
        workspaceId,
        categoryId: stored.id,
        name: "  Ocio   y   Cultura  ",
      }),
    );

    expect(renamed).toEqual({
      id: stored.id,
      name: "Ocio y Cultura",
      normalizedName: "ocio y cultura",
      type: "expense",
      sortOrder: 3,
      archivedAt: null,
    });
  });

  it("refuses a name held by another active category of the same type", () => {
    const stored = insert("Ocio", "expense", 0);
    insert("Casa", "expense", 1);

    const conflict = sqliteCategoryRepository.renameCategory(unit, {
      workspaceId,
      categoryId: stored.id,
      name: "casa",
    });

    expect(errorCode(conflict)).toBe("duplicateName");
    expect(activeNames("expense")).toEqual(["Ocio", "Casa"]);
  });

  it("refuses an unknown category and a category of another workspace", () => {
    const stored = insert("Deportes", "expense", 0);

    expect(
      errorCode(
        sqliteCategoryRepository.renameCategory(unit, {
          workspaceId,
          categoryId: randomUUID() as CategoryId,
          name: "Otro",
        }),
      ),
    ).toBe("categoryNotFound");
    expect(
      errorCode(
        sqliteCategoryRepository.renameCategory(unit, {
          workspaceId: randomUUID(),
          categoryId: stored.id,
          name: "Otro",
        }),
      ),
    ).toBe("categoryNotFound");
    expect(activeNames("expense")).toEqual(["Deportes"]);
  });
});

describe("category reordering", () => {
  it("applies the requested order and returns the active categories in it", () => {
    const casa = insert("Casa", "expense", 0);
    const ocio = insert("Ocio", "expense", 1);
    const viajes = insert("Viajes", "expense", 2);
    insert("Sueldo", "income", 0);

    const reordered = okValue(
      runInTransaction(fixture.connection, (transactional) =>
        sqliteCategoryRepository.reorderCategories(transactional, {
          workspaceId,
          type: "expense",
          orderedCategoryIds: [viajes.id, casa.id, ocio.id],
        }),
      ),
    );

    expect(reordered.map((stored) => stored.name)).toEqual([
      "Viajes",
      "Casa",
      "Ocio",
    ]);
    expect(reordered.map((stored) => stored.sortOrder)).toEqual([0, 1, 2]);
    expect(activeNames("expense")).toEqual(["Viajes", "Casa", "Ocio"]);
    expect(activeNames("income")).toEqual(["Sueldo"]);
  });

  it("requires a transactional unit so a partial order is impossible", () => {
    const casa = insert("Casa", "expense", 0);
    const ocio = insert("Ocio", "expense", 1);

    const result = sqliteCategoryRepository.reorderCategories(unit, {
      workspaceId,
      type: "expense",
      orderedCategoryIds: [ocio.id, casa.id],
    });

    expect(errorCode(result)).toBe("transactionRequired");
    expect(activeNames("expense")).toEqual(["Casa", "Ocio"]);
  });

  it("refuses an order that is not the complete list of active categories", () => {
    const casa = insert("Casa", "expense", 0);
    const ocio = insert("Ocio", "expense", 1);
    const income = insert("Sueldo", "income", 0);
    const archived = insert("Gimnasio", "expense", 2);
    okValue(
      sqliteCategoryRepository.archiveCategory(unit, {
        workspaceId,
        categoryId: archived.id,
        archivedAt: ARCHIVED_AT,
      }),
    );

    const orders: readonly (readonly CategoryId[])[] = [
      [casa.id],
      [casa.id, ocio.id, archived.id],
      [casa.id, casa.id],
      [casa.id, income.id],
      [casa.id, randomUUID() as CategoryId],
    ];

    for (const orderedCategoryIds of orders) {
      const result = runInTransaction(fixture.connection, (transactional) =>
        sqliteCategoryRepository.reorderCategories(transactional, {
          workspaceId,
          type: "expense",
          orderedCategoryIds,
        }),
      );

      expect(errorCode(result)).toBe("invalidCategoryOrder");
    }

    expect(activeNames("expense")).toEqual(["Casa", "Ocio"]);
  });

  it("changes nothing when another writer holds the write lock", () => {
    const casa = insert("Casa", "expense", 0);
    const ocio = insert("Ocio", "expense", 1);
    const writer = fixture.openWriter();
    fixture.connection.sqlite.pragma("busy_timeout = 50");
    writer.sqlite.exec("BEGIN IMMEDIATE");

    const result = runInTransaction(fixture.connection, (transactional) =>
      sqliteCategoryRepository.reorderCategories(transactional, {
        workspaceId,
        type: "expense",
        orderedCategoryIds: [ocio.id, casa.id],
      }),
    );

    writer.sqlite.exec("ROLLBACK");

    expect(errorCode(result)).toBe("storageFailure");
    expect(activeNames("expense")).toEqual(["Casa", "Ocio"]);
  });
});

describe("category archival", () => {
  it("archives an active category and keeps it readable in the history", () => {
    const stored = insert("Gimnasio", "expense", 0);

    const archived = okValue(
      sqliteCategoryRepository.archiveCategory(unit, {
        workspaceId,
        categoryId: stored.id,
        archivedAt: ARCHIVED_AT,
      }),
    );

    expect(archived.archivedAt).toBe(ARCHIVED_AT);
    expect(activeNames("expense")).toEqual([]);
    expect(
      okValue(
        sqliteCategoryRepository.findCategoryById(unit, {
          workspaceId,
          categoryId: stored.id,
        }),
      )?.archivedAt,
    ).toBe(ARCHIVED_AT);
  });

  it("refuses to archive twice, an unknown category and another workspace", () => {
    const stored = insert("Formación", "expense", 0);
    okValue(
      sqliteCategoryRepository.archiveCategory(unit, {
        workspaceId,
        categoryId: stored.id,
        archivedAt: ARCHIVED_AT,
      }),
    );

    expect(
      errorCode(
        sqliteCategoryRepository.archiveCategory(unit, {
          workspaceId,
          categoryId: stored.id,
          archivedAt: (ARCHIVED_AT + 1) as Timestamp,
        }),
      ),
    ).toBe("alreadyArchived");
    expect(
      errorCode(
        sqliteCategoryRepository.archiveCategory(unit, {
          workspaceId,
          categoryId: randomUUID() as CategoryId,
          archivedAt: ARCHIVED_AT,
        }),
      ),
    ).toBe("categoryNotFound");
    expect(
      errorCode(
        sqliteCategoryRepository.archiveCategory(unit, {
          workspaceId: randomUUID(),
          categoryId: stored.id,
          archivedAt: ARCHIVED_AT,
        }),
      ),
    ).toBe("categoryNotFound");
    expect(
      okValue(
        sqliteCategoryRepository.findCategoryById(unit, {
          workspaceId,
          categoryId: stored.id,
        }),
      )?.archivedAt,
    ).toBe(ARCHIVED_AT);
  });

  it("changes nothing when another writer holds the write lock", () => {
    const stored = insert("Coche", "expense", 0);
    const writer = fixture.openWriter();
    fixture.connection.sqlite.pragma("busy_timeout = 50");
    writer.sqlite.exec("BEGIN IMMEDIATE");

    const result = sqliteCategoryRepository.archiveCategory(unit, {
      workspaceId,
      categoryId: stored.id,
      archivedAt: ARCHIVED_AT,
    });

    writer.sqlite.exec("ROLLBACK");

    expect(errorCode(result)).toBe("storageFailure");
    expect(activeNames("expense")).toEqual(["Coche"]);
  });

  it("reports an archived row that no longer satisfies the domain contract", () => {
    const stored = insert("Tecnología", "expense", 0);
    fixture.connection.sqlite
      .prepare(
        "UPDATE category SET archived_at = ?, normalized_name = ? WHERE id = ?",
      )
      .run(ARCHIVED_AT, "otra", stored.id);

    const result = sqliteCategoryRepository.archiveCategory(unit, {
      workspaceId,
      categoryId: stored.id,
      archivedAt: ARCHIVED_AT,
    });

    expect(errorCode(result)).toBe("invalidStoredRow");
  });
});
