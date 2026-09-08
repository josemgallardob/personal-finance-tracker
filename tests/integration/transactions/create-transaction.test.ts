/**
 * CreateTransaction against a real, migrated SQLite file.
 *
 * The cases cover expense and income saves, the Madrid today boundary, refused
 * categories, optional values that survive persistence, and a forced
 * association failure that rolls the movement and newly created tags back
 * together. Nothing here stubs the driver or the constraints.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createCreateTransaction } from "../../../src/modules/transactions/application/create-transaction";
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

function useCase(
  transactions: TransactionRepository<SqliteUnitOfWork> = sqliteTransactionRepository,
) {
  return createCreateTransaction({
    transactions,
    categories: sqliteCategoryRepository,
    tags: sqliteTagRepository,
    clock: new FixedClock(TODAY),
    createId,
    now: () => NOW,
  });
}

function execute(
  command: Parameters<ReturnType<typeof useCase>["execute"]>[1],
  transactions?: TransactionRepository<SqliteUnitOfWork>,
): DomainResult<Transaction> {
  let refusal: DomainResult<Transaction> | undefined;

  try {
    return fixture.connection.db.transaction((tx) => {
      const result = useCase(transactions).execute(
        { isTransactional: true, db: tx },
        command,
      );

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

function errorsOf(result: DomainResult<Transaction>) {
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

describe("CreateTransaction against SQLite", () => {
  it("saves an expense of one cent with the server identifier", () => {
    const category = storeCategory(fixture, "Comida", "expense");
    const saved = stored(
      execute({
        workspaceId,
        type: "expense",
        amountMinor: 1,
        date: TODAY,
        categoryId: category.id,
        concept: null,
        note: null,
      }),
    );

    expect(saved).toEqual({
      id: "00000000-0000-4000-8000-000000000001",
      type: "expense",
      amountMinor: 1,
      date: TODAY,
      categoryId: category.id,
      concept: null,
      note: null,
      tagIds: [],
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(
      sqliteTransactionRepository.findTransactionById(
        { isTransactional: false, db: fixture.connection.db },
        { workspaceId, transactionId: saved.id },
      ),
    ).toEqual({ ok: true, value: saved });
  });

  it("saves an income without increasing any other type", () => {
    const category = storeCategory(fixture, "Nómina", "income");
    const saved = stored(
      execute({
        workspaceId,
        type: "income",
        amountMinor: 250_000,
        date: "2026-09-05",
        categoryId: category.id,
        concept: null,
        note: null,
      }),
    );

    expect(saved.type).toBe("income");
    expect(saved.amountMinor).toBe(250_000);
    expect(saved.date).toBe("2026-09-05");
  });

  it("keeps optional concept, note and mixed tag inputs after the round trip", () => {
    const category = storeCategory(fixture, "Comida", "expense");
    const existing = storeTag(fixture, "Con Amigos");
    const saved = stored(
      execute({
        workspaceId,
        type: "expense",
        amountMinor: 1_250,
        date: TODAY,
        categoryId: category.id,
        concept: "Café con leche",
        note: "Primera línea\nSegunda línea",
        tags: [{ tagId: existing.id }, { name: "Viaje" }],
      }),
    );

    expect(saved.concept).toBe("Café con leche");
    expect(saved.note).toBe("Primera línea\nSegunda línea");
    expect([...saved.tagIds].sort()).toEqual(
      [existing.id, "00000000-0000-4000-8000-000000000001"].sort(),
    );
    expect(
      listTags()
        .map((tag) => tag.name)
        .sort(),
    ).toEqual(["Con Amigos", "Viaje"]);
  });

  it("refuses a date after today and writes nothing", () => {
    const category = storeCategory(fixture, "Comida", "expense");
    const result = execute({
      workspaceId,
      type: "expense",
      amountMinor: 1,
      date: "2026-09-07",
      categoryId: category.id,
      concept: null,
      note: null,
    });

    expect(errorsOf(result)).toEqual([{ field: "date", code: "futureDate" }]);
    expect(
      sqliteTransactionRepository.findTransactionsByIds(
        { isTransactional: false, db: fixture.connection.db },
        { workspaceId, transactionIds: [] },
      ),
    ).toEqual({ ok: true, value: [] });
  });

  it("refuses an archived category of the workspace", () => {
    const category = storeCategory(fixture, "Comida", "expense");
    const archived = sqliteCategoryRepository.archiveCategory(
      { isTransactional: false, db: fixture.connection.db },
      {
        workspaceId,
        categoryId: category.id,
        archivedAt: NOW as Timestamp,
      },
    );

    if (!archived.ok) {
      throw new Error(
        `Expected an archived category: ${JSON.stringify(archived)}`,
      );
    }

    const result = execute({
      workspaceId,
      type: "expense",
      amountMinor: 1,
      date: TODAY,
      categoryId: category.id,
      concept: null,
      note: null,
    });

    expect(errorsOf(result)).toEqual([
      { field: "categoryId", code: "archived" },
    ]);
  });

  it("refuses a category of another workspace", () => {
    const foreign = createTransactionFixture();

    try {
      const elsewhere = storeCategory(foreign, "Comida", "expense");
      const result = execute({
        workspaceId,
        type: "expense",
        amountMinor: 1,
        date: TODAY,
        categoryId: elsewhere.id,
        concept: null,
        note: null,
      });

      expect(errorsOf(result)).toEqual([
        { field: "categoryId", code: "notFound" },
      ]);
    } finally {
      foreign.cleanup();
    }
  });

  it("refuses an income category on an expense", () => {
    const income = storeCategory(fixture, "Nómina", "income");
    const result = execute({
      workspaceId,
      type: "expense",
      amountMinor: 1,
      date: TODAY,
      categoryId: income.id,
      concept: null,
      note: null,
    });

    expect(errorsOf(result)).toEqual([
      { field: "type", code: "incompatibleCategoryType" },
    ]);
  });

  it("rolls back the movement and newly created tags when associations fail", () => {
    const category = storeCategory(fixture, "Comida", "expense");
    const refusing: TransactionRepository<SqliteUnitOfWork> = {
      ...sqliteTransactionRepository,
      insertTransaction: () => failed("unknownTag"),
    };
    const result = execute(
      {
        workspaceId,
        type: "expense",
        amountMinor: 1,
        date: TODAY,
        categoryId: category.id,
        concept: null,
        note: null,
        tags: [{ name: "Viaje nuevo" }],
      },
      refusing,
    );

    expect(errorsOf(result)).toEqual([{ field: "tagId", code: "notFound" }]);
    expect(listTags()).toEqual([]);
    expect(
      sqliteTransactionRepository.findTransactionById(
        { isTransactional: false, db: fixture.connection.db },
        {
          workspaceId,
          transactionId:
            "00000000-0000-4000-8000-000000000002" as Transaction["id"],
        },
      ),
    ).toEqual({ ok: true, value: null });
  });
});
