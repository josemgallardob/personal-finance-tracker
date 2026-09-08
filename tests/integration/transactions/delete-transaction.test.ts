/**
 * DeleteTransaction against a real, migrated SQLite file.
 *
 * Deleting a movement removes its associations and leaves the categories and
 * tags it used in place. A missing or foreign identifier is not found and
 * never touches another workspace.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { category, tag, transactionTag } from "../../../db/schema";
import { createCreateTransaction } from "../../../src/modules/transactions/application/create-transaction";
import { createDeleteTransaction } from "../../../src/modules/transactions/application/delete-transaction";
import { sqliteCategoryRepository } from "../../../src/modules/classification/infrastructure/sqlite-category-repository";
import { sqliteTagRepository } from "../../../src/modules/classification/infrastructure/sqlite-tag-repository";
import { sqliteTransactionRepository } from "../../../src/modules/transactions/infrastructure/sqlite-transaction-repository";
import type { SqliteUnitOfWork } from "../../../src/modules/transactions/infrastructure/sqlite-unit-of-work";
import { FixedClock } from "../../../src/shared/domain/clock";
import type { LocalDate } from "../../../src/shared/domain/dates";
import type { DomainResult } from "../../../src/shared/domain/errors";
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
  command: Parameters<ReturnType<typeof createCreateTransaction>["execute"]>[1],
) {
  return run((unit) =>
    createCreateTransaction({
      transactions: sqliteTransactionRepository,
      categories: sqliteCategoryRepository,
      tags: sqliteTagRepository,
      clock: new FixedClock(TODAY),
      createId,
      now: () => NOW,
    }).execute(unit, command),
  );
}

function remove(transactionId: string, scope = workspaceId) {
  return run((unit) =>
    createDeleteTransaction({
      transactions: sqliteTransactionRepository,
    }).execute(unit, { workspaceId: scope, transactionId }),
  );
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

describe("DeleteTransaction against SQLite", () => {
  it("removes the movement and its links without deleting classifications", () => {
    const expense = storeCategory(fixture, "Comida", "expense");
    const label = storeTag(fixture, "Viaje");
    const created = stored(
      create({
        workspaceId,
        type: "expense",
        amountMinor: 1,
        date: TODAY,
        categoryId: expense.id,
        concept: null,
        note: null,
        tags: [{ tagId: label.id }],
      }),
    );
    const deleted = remove(created.id);

    expect(deleted).toEqual({ ok: true, value: created.id });
    expect(
      sqliteTransactionRepository.findTransactionById(
        { isTransactional: false, db: fixture.connection.db },
        { workspaceId, transactionId: created.id },
      ),
    ).toEqual({ ok: true, value: null });
    expect(
      fixture.connection.db.select().from(transactionTag).all(),
    ).toHaveLength(0);
    expect(fixture.connection.db.select().from(category).all()).toHaveLength(1);
    expect(fixture.connection.db.select().from(tag).all()).toHaveLength(1);
  });

  it("returns not found for a missing identifier", () => {
    expect(errorsOf(remove("00000000-0000-4000-8000-000000000099"))).toEqual([
      { field: "id", code: "notFound" },
    ]);
  });

  it("returns not found for a movement of another workspace and keeps it", () => {
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
          now: () => NOW,
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

      expect(errorsOf(remove(createdElsewhere.id))).toEqual([
        { field: "id", code: "notFound" },
      ]);
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
