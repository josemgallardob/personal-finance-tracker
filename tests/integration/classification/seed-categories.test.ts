/**
 * Idempotent catalog seed against a real, migrated SQLite file.
 *
 * The cases cover a fresh bootstrap, a repeated one, user edits, archives,
 * name collisions with a different identifier, an invalid catalog definition
 * and a seed that needs a transactional unit. Nothing here stubs the catalog
 * rules, the constraints or the repository.
 */

import { afterEach, describe, expect, it } from "vitest";

import { seedCategories } from "../../../src/modules/classification/application/seed-categories";
import {
  INITIAL_CATEGORY_CATALOG,
  INITIAL_EXPENSE_CATEGORIES,
  INITIAL_INCOME_CATEGORIES,
  type InitialCategorySeed,
} from "../../../src/modules/classification/domain/initial-category-catalog";
import { sqliteCategoryRepository } from "../../../src/modules/classification/infrastructure/sqlite-category-repository";
import {
  autocommitUnitOfWork,
  runInTransaction,
} from "../../../src/modules/classification/infrastructure/sqlite-unit-of-work";
import { loadAppConfig } from "../../../src/shared/server/config";
import { openSqliteConnection } from "../../../src/shared/server/database";
import { initializeDatabase } from "../../../src/shared/server/initialize";
import type { Timestamp } from "../../../src/shared/domain/timestamp";
import {
  createTemporarySqliteFile,
  createValidAppEnv,
} from "../helpers/sqlite";
import {
  type ClassificationFixture,
  createClassificationFixture,
  errorCode,
  newCategory,
  okValue,
} from "./helpers";

const ARCHIVED_AT = 1_746_268_800_000 as Timestamp;

const cleanups: Array<{ cleanup(): void }> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.cleanup();
  }
});

function seededDatabase() {
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
    now: () => ARCHIVED_AT,
  });

  if (!initialized.ok) {
    opened.value.close();
    file.cleanup();
    throw new Error(
      `Expected a migrated database: ${JSON.stringify(initialized)}`,
    );
  }

  const fixture = {
    connection: opened.value,
    workspaceId: initialized.value.workspaceId,
    cleanup(): void {
      opened.value.close();
      file.cleanup();
    },
  };

  cleanups.push(fixture);
  return fixture;
}

function seed(
  fixture: Pick<ClassificationFixture, "connection" | "workspaceId">,
  catalog?: readonly InitialCategorySeed[],
) {
  return runInTransaction(fixture.connection, (unit) =>
    seedCategories(unit, sqliteCategoryRepository, {
      workspaceId: fixture.workspaceId,
      catalog,
    }),
  );
}

function listed(
  fixture: Pick<ClassificationFixture, "connection" | "workspaceId">,
  type?: "expense" | "income",
) {
  return okValue(
    sqliteCategoryRepository.listCategories(
      autocommitUnitOfWork(fixture.connection),
      {
        workspaceId: fixture.workspaceId,
        status: "all",
        type,
      },
    ),
  );
}

describe("fresh and repeated bootstrap", () => {
  it("inserts the accepted catalog exactly once on a fresh database", () => {
    const fixture = seededDatabase();
    const expenses = listed(fixture, "expense");
    const income = listed(fixture, "income");

    expect(expenses).toHaveLength(24);
    expect(income).toHaveLength(4);
    expect(expenses.map((row) => row.name)).toEqual(
      INITIAL_EXPENSE_CATEGORIES.map((seed) => seed.name),
    );
    expect(income.map((row) => row.name)).toEqual(
      INITIAL_INCOME_CATEGORIES.map((seed) => seed.name),
    );
    expect(expenses.map((row) => row.id)).toEqual(
      INITIAL_EXPENSE_CATEGORIES.map((seed) => seed.id),
    );
    expect(income.map((row) => row.id)).toEqual(
      INITIAL_INCOME_CATEGORIES.map((seed) => seed.id),
    );
    expect(expenses.map((row) => row.sortOrder)).toEqual(
      INITIAL_EXPENSE_CATEGORIES.map((_, index) => index),
    );
    expect(expenses.find((row) => row.name === "Regalos")?.id).not.toBe(
      income.find((row) => row.name === "Regalos")?.id,
    );
  });

  it("does not duplicate the catalog when initialization runs twice", () => {
    const file = createTemporarySqliteFile();
    cleanups.push(file);
    const config = loadAppConfig(createValidAppEnv(file.filePath));

    if (!config.ok) {
      throw new Error(
        `Expected valid configuration: ${JSON.stringify(config)}`,
      );
    }

    const first = openSqliteConnection(config.value);

    if (!first.ok) {
      throw new Error(`Expected an open connection: ${JSON.stringify(first)}`);
    }

    const created = initializeDatabase(first.value, { now: () => 100 });
    expect(created.ok).toBe(true);
    first.value.close();

    const second = openSqliteConnection(config.value);

    if (!second.ok) {
      throw new Error(
        `Expected a second connection: ${JSON.stringify(second)}`,
      );
    }

    cleanups.push({ cleanup: () => second.value.close() });

    const restarted = initializeDatabase(second.value, { now: () => 200 });
    expect(restarted.ok).toBe(true);
    if (!created.ok || !restarted.ok) {
      return;
    }

    expect(restarted.value.workspaceId).toBe(created.value.workspaceId);
    expect(restarted.value.createdWorkspace).toBe(false);

    const rows = listed(
      { connection: second.value, workspaceId: created.value.workspaceId },
      undefined,
    );

    expect(rows).toHaveLength(28);
    expect(new Set(rows.map((row) => row.id)).size).toBe(28);
  });

  it("reports every seed as unchanged on a second run of the use case", () => {
    const fixture = seededDatabase();
    const repeated = okValue(seed(fixture));

    expect(repeated.insertedIds).toEqual([]);
    expect(repeated.collidedIds).toEqual([]);
    expect(repeated.unchangedIds).toEqual(
      INITIAL_CATEGORY_CATALOG.map((item) => item.id),
    );
    expect(listed(fixture)).toHaveLength(28);
  });
});

describe("user edits and archives", () => {
  it("keeps a renamed and reordered seed and does not unarchive it", () => {
    const fixture = seededDatabase();
    const unit = autocommitUnitOfWork(fixture.connection);
    const expenses = listed(fixture, "expense");
    const alquiler = expenses[0];
    const supermercado = expenses[2];

    if (alquiler === undefined || supermercado === undefined) {
      throw new Error("Expected the accepted expense catalog");
    }

    okValue(
      sqliteCategoryRepository.renameCategory(unit, {
        workspaceId: fixture.workspaceId,
        categoryId: alquiler.id,
        name: "Piso",
      }),
    );
    okValue(
      runInTransaction(fixture.connection, (transaction) =>
        sqliteCategoryRepository.reorderCategories(transaction, {
          workspaceId: fixture.workspaceId,
          type: "expense",
          orderedCategoryIds: [
            supermercado.id,
            ...expenses
              .filter((row) => row.id !== supermercado.id)
              .map((row) => row.id),
          ],
        }),
      ),
    );
    okValue(
      sqliteCategoryRepository.archiveCategory(unit, {
        workspaceId: fixture.workspaceId,
        categoryId: alquiler.id,
        archivedAt: ARCHIVED_AT,
      }),
    );

    const repeated = okValue(seed(fixture));
    const after = listed(fixture, "expense");
    const storedAlquiler = after.find((row) => row.id === alquiler.id);
    const storedSupermercado = after.find((row) => row.id === supermercado.id);

    expect(repeated.insertedIds).toEqual([]);
    expect(storedAlquiler).toMatchObject({
      name: "Piso",
      archivedAt: ARCHIVED_AT,
    });
    expect(storedSupermercado?.sortOrder).toBe(0);
    expect(after).toHaveLength(24);
  });
});

describe("collisions and refusals", () => {
  it("skips a seed whose active name is already taken by another identifier", () => {
    const fixture = createClassificationFixture();
    cleanups.push(fixture);

    okValue(
      sqliteCategoryRepository.insertCategory(
        autocommitUnitOfWork(fixture.connection),
        {
          workspaceId: fixture.workspaceId,
          category: newCategory("Alquiler", "expense", 9),
        },
      ),
    );

    const result = okValue(seed(fixture));
    const expenses = listed(fixture, "expense");
    const custom = expenses.find((row) => row.name === "Alquiler");

    expect(result.collidedIds).toEqual(["seed-exp-alquiler"]);
    expect(result.insertedIds).toHaveLength(27);
    expect(result.insertedIds).not.toContain("seed-exp-alquiler");
    expect(custom?.id).not.toBe("seed-exp-alquiler");
    expect(custom?.sortOrder).toBe(9);
    expect(expenses.filter((row) => row.name === "Alquiler")).toHaveLength(1);
    expect(listed(fixture, "income")).toHaveLength(4);
  });

  it("still inserts a seed when the colliding name belongs to an archived row", () => {
    const fixture = createClassificationFixture();
    cleanups.push(fixture);
    const unit = autocommitUnitOfWork(fixture.connection);
    const custom = newCategory("Alquiler", "expense", 0);

    okValue(
      sqliteCategoryRepository.insertCategory(unit, {
        workspaceId: fixture.workspaceId,
        category: custom,
      }),
    );
    okValue(
      sqliteCategoryRepository.archiveCategory(unit, {
        workspaceId: fixture.workspaceId,
        categoryId: custom.id,
        archivedAt: ARCHIVED_AT,
      }),
    );

    const result = okValue(seed(fixture));
    const expenses = listed(fixture, "expense");

    expect(result.collidedIds).toEqual([]);
    expect(result.insertedIds).toContain("seed-exp-alquiler");
    expect(
      expenses.filter((row) => row.normalizedName === "alquiler"),
    ).toHaveLength(2);
    expect(
      expenses.find((row) => row.id === "seed-exp-alquiler")?.archivedAt,
    ).toBeNull();
    expect(expenses.find((row) => row.id === custom.id)?.archivedAt).toBe(
      ARCHIVED_AT,
    );
  });

  it("refuses an autocommit unit because the catalog writes several rows", () => {
    const fixture = createClassificationFixture();
    cleanups.push(fixture);

    expect(
      errorCode(
        seedCategories(
          autocommitUnitOfWork(fixture.connection),
          sqliteCategoryRepository,
          { workspaceId: fixture.workspaceId },
        ),
      ),
    ).toBe("transactionRequired");
    expect(listed(fixture)).toEqual([]);
  });

  it("refuses a catalog definition that cannot become a category", () => {
    const fixture = createClassificationFixture();
    cleanups.push(fixture);
    const invalid: InitialCategorySeed = {
      id: "not a valid id",
      name: "Alquiler",
      type: "expense",
      iconKey: "rent",
      color: "#5B8CFF",
    };

    const result = seed(fixture, [invalid]);

    expect(errorCode(result)).toBe("invalidStoredRow");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.cause).toBe("id:invalidIdentifier");
    }

    expect(listed(fixture)).toEqual([]);
  });

  it("rolls back a catalog that fails after inserting an earlier row", () => {
    const fixture = createClassificationFixture();
    cleanups.push(fixture);
    const valid = INITIAL_EXPENSE_CATEGORIES[0];

    if (valid === undefined) {
      throw new Error("Expected the first expense seed");
    }

    const result = seed(fixture, [
      valid,
      {
        id: "",
        name: "Suministros",
        type: "expense",
        iconKey: "utilities",
        color: "#F0B429",
      },
    ]);

    expect(errorCode(result)).toBe("invalidStoredRow");
    expect(listed(fixture)).toEqual([]);
  });

  it("propagates a missing workspace as an insert refusal", () => {
    const fixture = createClassificationFixture();
    cleanups.push(fixture);

    const result = runInTransaction(fixture.connection, (unit) =>
      seedCategories(unit, sqliteCategoryRepository, {
        workspaceId: "missing-workspace",
        catalog: INITIAL_EXPENSE_CATEGORIES.slice(0, 1),
      }),
    );

    expect(errorCode(result)).toBe("unknownWorkspace");
  });

  it("returns seedFailed when initialization cannot write the catalog", () => {
    const fixture = createClassificationFixture();
    cleanups.push(fixture);

    fixture.connection.sqlite.exec("DROP TABLE category");

    const result = initializeDatabase(fixture.connection, {
      now: () => ARCHIVED_AT,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error.code).toBe("seedFailed");
  });

  it("inserts nothing when the catalog is empty", () => {
    const fixture = createClassificationFixture();
    cleanups.push(fixture);

    expect(okValue(seed(fixture, []))).toEqual({
      insertedIds: [],
      unchangedIds: [],
      collidedIds: [],
    });
    expect(listed(fixture)).toEqual([]);
  });
});
