/**
 * UpdateTransaction against a real, migrated SQLite file.
 *
 * The cases cover atomic field and association replacement, D-03 archival
 * retention and refusal, type-change validation, workspace isolation and a
 * forced association failure that rolls the previous version back. Nothing
 * here stubs the driver or the constraints.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createCreateTransaction } from "../../../src/modules/transactions/application/create-transaction";
import { createUpdateTransaction } from "../../../src/modules/transactions/application/update-transaction";
import {
  failed,
  type TransactionRepository,
} from "../../../src/modules/transactions/application/ports/transaction-repository";
import { sqliteCategoryRepository } from "../../../src/modules/classification/infrastructure/sqlite-category-repository";
import { sqliteTagRepository } from "../../../src/modules/classification/infrastructure/sqlite-tag-repository";
import { sqliteTransactionRepository } from "../../../src/modules/transactions/infrastructure/sqlite-transaction-repository";
import type { SqliteUnitOfWork } from "../../../src/modules/transactions/infrastructure/sqlite-unit-of-work";
import { FixedClock } from "../../../src/shared/domain/clock";
import type { LocalDate } from "../../../src/shared/domain/dates";
import type { DomainResult } from "../../../src/shared/domain/errors";
import type { Timestamp } from "../../../src/shared/domain/timestamp";
import type { Transaction } from "../../../src/modules/transactions/domain/transaction";
import {
  createTransactionFixture,
  storeCategory,
  storeTag,
  type TransactionFixture,
} from "./helpers";

const TODAY = "2026-09-06" as LocalDate;
const CREATED_AT = 1_746_268_700_000;
const NOW = 1_746_268_800_000;
const ROLLBACK_SIGNAL = new Error("Transaction work was rolled back");

let fixture: TransactionFixture;
let workspaceId: string;
let ids: number;

beforeEach(() => {
  fixture = createTransactionFixture();
  workspaceId = fixture.workspaceId;
  ids = 0;
});

afterEach(() => {
  fixture.cleanup();
});

function createId(): string {
  ids += 1;
  return `00000000-0000-4000-8000-00000000000${ids}`;
}

function createUseCase() {
  return createCreateTransaction({
    transactions: sqliteTransactionRepository,
    categories: sqliteCategoryRepository,
    tags: sqliteTagRepository,
    clock: new FixedClock(TODAY),
    createId,
    now: () => CREATED_AT,
  });
}

function updateUseCase(
  transactions: TransactionRepository<SqliteUnitOfWork> = sqliteTransactionRepository,
) {
  return createUpdateTransaction({
    transactions,
    categories: sqliteCategoryRepository,
    tags: sqliteTagRepository,
    clock: new FixedClock(TODAY),
    createId,
    now: () => NOW,
  });
}

function run<TValue>(work: (unit: SqliteUnitOfWork) => DomainResult<TValue>) {
  let refusal: DomainResult<TValue> | undefined;

  try {
    return fixture.connection.db.transaction((tx) => {
      const result = work({ isTransactional: true, db: tx });

      if (!result.ok) {
        refusal = result;
        throw ROLLBACK_SIGNAL;
      }

      return result;
    });
  } catch (cause) {
    if (refusal) {
      return refusal;
    }

    throw cause;
  }
}

function create(
  command: Parameters<ReturnType<typeof createUseCase>["execute"]>[1],
) {
  return run((unit) => createUseCase().execute(unit, command));
}

function update(
  command: Parameters<ReturnType<typeof updateUseCase>["execute"]>[1],
  transactions?: TransactionRepository<SqliteUnitOfWork>,
) {
  return run((unit) => updateUseCase(transactions).execute(unit, command));
}

function errorsOf(result: DomainResult<unknown>) {
  return result.ok ? [] : result.errors;
}

function stored(result: DomainResult<Transaction>): Transaction {
  if (!result.ok) {
    throw new Error(`Expected success: ${JSON.stringify(result.errors)}`);
  }

  return result.value;
}

function listTags() {
  const listed = sqliteTagRepository.listTags(
    { isTransactional: false, db: fixture.connection.db },
    { workspaceId, status: "all" },
  );

  if (!listed.ok) {
    throw new Error(`Expected tags: ${JSON.stringify(listed)}`);
  }

  return listed.value;
}

function read(transactionId: Transaction["id"]) {
  return sqliteTransactionRepository.findTransactionById(
    { isTransactional: false, db: fixture.connection.db },
    { workspaceId, transactionId },
  );
}

describe("UpdateTransaction against SQLite", () => {
  it("replaces type, date, category and tags atomically", () => {
    const expense = storeCategory(fixture, "Comida", "expense");
    const income = storeCategory(fixture, "Nómina", "income");
    const oldTag = storeTag(fixture, "Con Amigos");
    const created = stored(
      create({
        workspaceId,
        type: "expense",
        amountMinor: 1_250,
        date: "2026-09-01",
        categoryId: expense.id,
        concept: "Café",
        note: "Original",
        tags: [{ tagId: oldTag.id }],
      }),
    );
    const kept = storeTag(fixture, "Viaje");
    const updated = stored(
      update({
        workspaceId,
        transactionId: created.id,
        type: "income",
        amountMinor: 250_000,
        date: TODAY,
        categoryId: income.id,
        concept: "Nómina septiembre",
        note: "Corregido",
        tags: [{ tagId: kept.id }, { name: "Extra" }],
      }),
    );

    expect(updated).toEqual({
      id: created.id,
      type: "income",
      amountMinor: 250_000,
      date: TODAY,
      categoryId: income.id,
      concept: "Nómina septiembre",
      note: "Corregido",
      tagIds: expect.arrayContaining([
        kept.id,
        "00000000-0000-4000-8000-000000000002",
      ]),
      createdAt: CREATED_AT,
      updatedAt: NOW,
    });
    expect([...updated.tagIds].sort()).toEqual(
      [kept.id, "00000000-0000-4000-8000-000000000002"].sort(),
    );
    expect(read(created.id)).toEqual({
      ok: true,
      value: { ...updated, tagIds: [...updated.tagIds].sort() },
    });
    expect(
      listTags()
        .map((tag) => tag.name)
        .sort(),
    ).toEqual(["Con Amigos", "Extra", "Viaje"]);
  });

  it("keeps the archived category and tags already linked and refuses new archived ones", () => {
    const category = storeCategory(fixture, "Comida", "expense");
    const other = storeCategory(fixture, "Ocio", "expense");
    const linked = storeTag(fixture, "Viaje");
    const extra = storeTag(fixture, "Ocio");
    const created = stored(
      create({
        workspaceId,
        type: "expense",
        amountMinor: 1,
        date: TODAY,
        categoryId: category.id,
        concept: null,
        note: null,
        tags: [{ tagId: linked.id }],
      }),
    );

    const archivedCategory = sqliteCategoryRepository.archiveCategory(
      { isTransactional: false, db: fixture.connection.db },
      {
        workspaceId,
        categoryId: category.id,
        archivedAt: NOW as Timestamp,
      },
    );
    const archivedOther = sqliteCategoryRepository.archiveCategory(
      { isTransactional: false, db: fixture.connection.db },
      {
        workspaceId,
        categoryId: other.id,
        archivedAt: NOW as Timestamp,
      },
    );
    const archivedLinked = sqliteTagRepository.archiveTag(
      { isTransactional: false, db: fixture.connection.db },
      { workspaceId, tagId: linked.id, archivedAt: NOW as Timestamp },
    );
    const archivedExtra = sqliteTagRepository.archiveTag(
      { isTransactional: false, db: fixture.connection.db },
      { workspaceId, tagId: extra.id, archivedAt: NOW as Timestamp },
    );

    if (
      !archivedCategory.ok ||
      !archivedOther.ok ||
      !archivedLinked.ok ||
      !archivedExtra.ok
    ) {
      throw new Error("Expected archived classification");
    }

    const kept = stored(
      update({
        workspaceId,
        transactionId: created.id,
        type: "expense",
        amountMinor: 2,
        date: "2026-09-05",
        categoryId: category.id,
        concept: null,
        note: null,
        tags: [{ tagId: linked.id }],
      }),
    );

    expect(kept.categoryId).toBe(category.id);
    expect(kept.tagIds).toEqual([linked.id]);
    expect(kept.amountMinor).toBe(2);

    expect(
      errorsOf(
        update({
          workspaceId,
          transactionId: created.id,
          type: "expense",
          amountMinor: 3,
          date: "2026-09-05",
          categoryId: other.id,
          concept: null,
          note: null,
          tags: [{ tagId: linked.id }],
        }),
      ),
    ).toEqual([{ field: "categoryId", code: "archived" }]);
    expect(
      errorsOf(
        update({
          workspaceId,
          transactionId: created.id,
          type: "expense",
          amountMinor: 3,
          date: "2026-09-05",
          categoryId: category.id,
          concept: null,
          note: null,
          tags: [{ tagId: extra.id }],
        }),
      ),
    ).toEqual([{ field: "tagId", code: "archived" }]);
    expect(read(created.id)).toEqual({ ok: true, value: kept });
  });

  it("refuses a type change that does not pick an active compatible category", () => {
    const expense = storeCategory(fixture, "Comida", "expense");
    const created = stored(
      create({
        workspaceId,
        type: "expense",
        amountMinor: 1,
        date: TODAY,
        categoryId: expense.id,
        concept: null,
        note: null,
      }),
    );

    expect(
      errorsOf(
        update({
          workspaceId,
          transactionId: created.id,
          type: "income",
          amountMinor: 1,
          date: TODAY,
          categoryId: expense.id,
          concept: null,
          note: null,
        }),
      ),
    ).toEqual([{ field: "type", code: "incompatibleCategoryType" }]);
    expect(read(created.id)).toEqual({ ok: true, value: created });
  });

  it("rolls the previous version back when associations fail", () => {
    const category = storeCategory(fixture, "Comida", "expense");
    const existing = storeTag(fixture, "Viaje");
    const created = stored(
      create({
        workspaceId,
        type: "expense",
        amountMinor: 500,
        date: TODAY,
        categoryId: category.id,
        concept: "Original",
        note: null,
        tags: [{ tagId: existing.id }],
      }),
    );
    const refusing: TransactionRepository<SqliteUnitOfWork> = {
      ...sqliteTransactionRepository,
      updateTransaction: () => failed("unknownTag"),
    };
    const result = update(
      {
        workspaceId,
        transactionId: created.id,
        type: "expense",
        amountMinor: 700,
        date: "2026-09-05",
        categoryId: category.id,
        concept: "Cambiado",
        note: null,
        tags: [{ name: "Nueva etiqueta" }],
      },
      refusing,
    );

    expect(errorsOf(result)).toEqual([{ field: "tagId", code: "notFound" }]);
    expect(
      listTags()
        .map((tag) => tag.name)
        .sort(),
    ).toEqual(["Viaje"]);
    expect(read(created.id)).toEqual({ ok: true, value: created });
  });

  it("returns not found for a missing or foreign movement and writes nothing", () => {
    const category = storeCategory(fixture, "Comida", "expense");
    const missing = update({
      workspaceId,
      transactionId: "00000000-0000-4000-8000-000000000099",
      type: "expense",
      amountMinor: 1,
      date: TODAY,
      categoryId: category.id,
      concept: null,
      note: null,
    });
    const foreign = createTransactionFixture();

    try {
      const elsewhere = storeCategory(foreign, "Comida", "expense");
      const createdElsewhere = foreign.connection.db.transaction((tx) => {
        const result = createCreateTransaction({
          transactions: sqliteTransactionRepository,
          categories: sqliteCategoryRepository,
          tags: sqliteTagRepository,
          clock: new FixedClock(TODAY),
          createId,
          now: () => CREATED_AT,
        }).execute(
          { isTransactional: true, db: tx },
          {
            workspaceId: foreign.workspaceId,
            type: "expense",
            amountMinor: 1,
            date: TODAY,
            categoryId: elsewhere.id,
            concept: null,
            note: null,
          },
        );

        if (!result.ok) {
          throw new Error(
            `Expected a foreign movement: ${JSON.stringify(result)}`,
          );
        }

        return result.value;
      });

      const cross = update({
        workspaceId,
        transactionId: createdElsewhere.id,
        type: "expense",
        amountMinor: 9,
        date: TODAY,
        categoryId: category.id,
        concept: null,
        note: null,
      });

      expect(errorsOf(missing)).toEqual([{ field: "id", code: "notFound" }]);
      expect(errorsOf(cross)).toEqual([{ field: "id", code: "notFound" }]);
      expect(
        sqliteTransactionRepository.findTransactionById(
          { isTransactional: false, db: foreign.connection.db },
          {
            workspaceId: foreign.workspaceId,
            transactionId: createdElsewhere.id,
          },
        ),
      ).toEqual({ ok: true, value: createdElsewhere });
    } finally {
      foreign.cleanup();
    }
  });
});
