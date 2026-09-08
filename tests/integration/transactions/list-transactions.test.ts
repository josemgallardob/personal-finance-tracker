/**
 * ListTransactions against a real, migrated SQLite file.
 *
 * The cases walk more than two pages of tied dates, apply every filter and
 * their combinations, keep SQL wildcards literal, refuse corrupt or
 * cross-filter cursors, return a movement that matches several tags once, and
 * prove that one page is a consistent snapshot. Nothing here stubs the driver.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createListTransactions,
  type ListTransactionsQuery,
} from "../../../src/modules/transactions/application/list-transactions";
import { parseListTransactionsInput } from "../../../src/modules/transactions/application/list-transaction-filters";
import { sqliteTransactionQuery } from "../../../src/modules/transactions/infrastructure/sqlite-list-transactions-query";
import { sqliteTransactionRepository } from "../../../src/modules/transactions/infrastructure/sqlite-transaction-repository";
import {
  autocommitUnitOfWork,
  runInTransaction,
} from "../../../src/modules/transactions/infrastructure/sqlite-unit-of-work";
import { loadAppConfig } from "../../../src/shared/server/config";
import { openSqliteConnection } from "../../../src/shared/server/database";
import type { DomainResult } from "../../../src/shared/domain/errors";
import type { Transaction } from "../../../src/modules/transactions/domain/transaction";
import { createValidAppEnv } from "../helpers/sqlite";
import {
  createTransactionFixture,
  newTransaction,
  okValue,
  storeCategory,
  storeTag,
  type TransactionFixture,
} from "./helpers";

let fixture: TransactionFixture;
let workspaceId: string;

beforeEach(() => {
  fixture = createTransactionFixture();
  workspaceId = fixture.workspaceId;
});

afterEach(() => {
  fixture.cleanup();
});

function list(
  query: Omit<ListTransactionsQuery, "workspaceId"> & {
    readonly workspaceId?: string;
  } = {},
): DomainResult<{ items: readonly Transaction[]; nextCursor: string | null }> {
  return createListTransactions({ query: sqliteTransactionQuery }).execute(
    autocommitUnitOfWork(fixture.connection),
    { ...query, workspaceId: query.workspaceId ?? workspaceId },
  );
}

function idsOf(
  result: DomainResult<{ items: readonly Transaction[] }>,
): readonly string[] {
  if (!result.ok) {
    throw new Error(`Expected a page: ${JSON.stringify(result)}`);
  }

  return result.value.items.map((item) => item.id);
}

function save(stored: Transaction): Transaction {
  return okValue(
    runInTransaction(fixture.connection, (unit) =>
      sqliteTransactionRepository.insertTransaction(unit, {
        workspaceId,
        transaction: stored,
      }),
    ),
  );
}

describe("stable traversal over tied dates", () => {
  it("walks more than two pages without repeating or skipping a tied movement", () => {
    const expense = storeCategory(fixture, "Comida", "expense");
    const ordered = [
      { id: "tx-07", createdAt: 700 },
      { id: "tx-06", createdAt: 600 },
      { id: "tx-05", createdAt: 500 },
      { id: "tx-04b", createdAt: 400 },
      { id: "tx-04a", createdAt: 400 },
      { id: "tx-03", createdAt: 300 },
      { id: "tx-02", createdAt: 200 },
    ].map((row) =>
      save(
        newTransaction({
          id: row.id,
          category: expense,
          date: "2026-03-14",
          createdAt: row.createdAt,
          updatedAt: row.createdAt,
        }),
      ),
    );

    const first = list({ limit: 2 });
    const second = list({
      limit: 2,
      cursor: first.ok ? (first.value.nextCursor ?? undefined) : undefined,
    });
    const third = list({
      limit: 2,
      cursor: second.ok ? (second.value.nextCursor ?? undefined) : undefined,
    });
    const fourth = list({
      limit: 2,
      cursor: third.ok ? (third.value.nextCursor ?? undefined) : undefined,
    });

    expect(idsOf(first)).toEqual([ordered[0].id, ordered[1].id]);
    expect(idsOf(second)).toEqual([ordered[2].id, ordered[3].id]);
    expect(idsOf(third)).toEqual([ordered[4].id, ordered[5].id]);
    expect(idsOf(fourth)).toEqual([ordered[6].id]);
    expect(first.ok ? first.value.nextCursor : null).not.toBeNull();
    expect(second.ok ? second.value.nextCursor : null).not.toBeNull();
    expect(third.ok ? third.value.nextCursor : null).not.toBeNull();
    expect(fourth.ok ? fourth.value.nextCursor : "x").toBeNull();
  });
});

describe("page limits", () => {
  it("returns thirty movements by default and the remainder on the next page", () => {
    const expense = storeCategory(fixture, "Comida", "expense");
    const stored = Array.from({ length: 31 }, (_, index) =>
      save(
        newTransaction({
          id: `tx-${String(index).padStart(2, "0")}`,
          category: expense,
          date: "2026-03-14",
          createdAt: 1_000 - index,
          updatedAt: 1_000 - index,
        }),
      ),
    );

    const first = list({ workspaceId });
    const second = list({
      cursor: first.ok ? (first.value.nextCursor ?? undefined) : undefined,
    });

    expect(first.ok ? first.value.items : []).toHaveLength(30);
    expect(idsOf(first)).toEqual(stored.slice(0, 30).map((row) => row.id));
    expect(idsOf(second)).toEqual([stored[30].id]);
  });

  it("accepts a page of one hundred and refuses a larger limit", () => {
    const expense = storeCategory(fixture, "Comida", "expense");

    for (let index = 0; index < 101; index += 1) {
      save(
        newTransaction({
          id: `row-${String(index).padStart(3, "0")}`,
          category: expense,
          date: "2026-04-01",
          createdAt: 2_000 - index,
          updatedAt: 2_000 - index,
        }),
      );
    }

    const page = list({ limit: 100 });

    expect(page.ok ? page.value.items : []).toHaveLength(100);
    expect(page.ok ? page.value.nextCursor : null).not.toBeNull();
    expect(list({ limit: 101 })).toEqual({
      ok: false,
      errors: [{ field: "limit", code: "invalidLimit" }],
    });
  });
});

describe("filters", () => {
  it("applies every dimension and their combinations without duplicating rows", () => {
    const expense = storeCategory(fixture, "Comida", "expense");
    const extraExpense = storeCategory(fixture, "Casa", "expense", 1);
    const income = storeCategory(fixture, "Nómina", "income");
    const travel = storeTag(fixture, "Viaje");
    const work = storeTag(fixture, "Trabajo");
    const friends = storeTag(fixture, "Amigos");

    const matching = save(
      newTransaction({
        id: "tx-match",
        category: expense,
        date: "2026-03-10",
        concept: "Hotel 100%_refund",
        note: "Viaje de trabajo",
        tagIds: [travel.id, work.id],
        createdAt: 50,
      }),
    );
    save(
      newTransaction({
        id: "tx-other-day",
        category: expense,
        date: "2026-03-20",
        concept: "Hotel 100%_refund",
        tagIds: [travel.id],
        createdAt: 40,
      }),
    );
    save(
      newTransaction({
        id: "tx-income",
        category: income,
        date: "2026-03-10",
        concept: "Hotel 100%_refund",
        createdAt: 30,
      }),
    );
    save(
      newTransaction({
        id: "tx-other-category",
        category: extraExpense,
        date: "2026-03-10",
        concept: "Hotel 100%_refund",
        tagIds: [travel.id],
        createdAt: 20,
      }),
    );
    save(
      newTransaction({
        id: "tx-other-text",
        category: expense,
        date: "2026-03-10",
        concept: "Supermercado",
        tagIds: [travel.id],
        createdAt: 10,
      }),
    );
    save(
      newTransaction({
        id: "tx-friends",
        category: expense,
        date: "2026-03-10",
        concept: "Hotel 100%_refund",
        tagIds: [friends.id],
        createdAt: 5,
      }),
    );
    const untagged = save(
      newTransaction({
        id: "tx-none",
        category: expense,
        date: "2026-03-10",
        concept: "Hotel 100%_refund",
        createdAt: 1,
      }),
    );

    const combined = list({
      dateFrom: "2026-03-01",
      dateTo: "2026-03-15",
      type: "expense",
      categoryId: expense.id,
      tagIds: [travel.id, work.id],
      q: "100%_refund",
    });

    expect(idsOf(combined)).toEqual([matching.id]);
    expect(combined.ok ? combined.value.items : []).toHaveLength(1);

    const eitherTag = list({
      dateFrom: "2026-03-10",
      dateTo: "2026-03-10",
      tagIds: [travel.id, work.id],
    });

    expect(idsOf(eitherTag)).toEqual([
      "tx-match",
      "tx-other-category",
      "tx-other-text",
    ]);

    const onlyUntagged = list({
      dateFrom: "2026-03-10",
      dateTo: "2026-03-10",
      type: "expense",
      untagged: true,
    });

    expect(idsOf(onlyUntagged)).toEqual([untagged.id]);
  });

  it("treats percent and underscore as literal characters of the search", () => {
    const expense = storeCategory(fixture, "Comida", "expense");
    const literal = save(
      newTransaction({
        id: "tx-literal",
        category: expense,
        concept: "descuento 50%_promo",
        note: null,
      }),
    );
    save(
      newTransaction({
        id: "tx-wildcard-would-match",
        category: expense,
        concept: "descuento 50XYpromo",
        note: null,
      }),
    );
    save(
      newTransaction({
        id: "tx-note",
        category: expense,
        concept: null,
        note: "código 50%_promo en caja",
      }),
    );

    expect(idsOf(list({ q: "50%_promo" }))).toEqual(["tx-note", literal.id]);
  });

  it("includes both open date extremes and hides another workspace", () => {
    const expense = storeCategory(fixture, "Comida", "expense");
    save(
      newTransaction({
        id: "tx-before",
        category: expense,
        date: "2026-02-28",
        createdAt: 3,
      }),
    );
    save(
      newTransaction({
        id: "tx-from",
        category: expense,
        date: "2026-03-01",
        createdAt: 2,
      }),
    );
    save(
      newTransaction({
        id: "tx-to",
        category: expense,
        date: "2026-03-31",
        createdAt: 1,
      }),
    );

    expect(idsOf(list({ dateFrom: "2026-03-01" }))).toEqual([
      "tx-to",
      "tx-from",
    ]);
    expect(idsOf(list({ dateTo: "2026-03-01" }))).toEqual([
      "tx-from",
      "tx-before",
    ]);
    expect(idsOf(list({ workspaceId: "missing-workspace" }))).toEqual([]);
  });

  it("restarts from the first page when filters change and refuses the old cursor", () => {
    const expense = storeCategory(fixture, "Comida", "expense");
    save(
      newTransaction({
        id: "tx-a",
        category: expense,
        date: "2026-03-14",
        concept: "alpha",
        createdAt: 2,
      }),
    );
    save(
      newTransaction({
        id: "tx-b",
        category: expense,
        date: "2026-03-14",
        concept: "beta",
        createdAt: 1,
      }),
    );

    const first = list({ limit: 1 });
    const continued = list({
      q: "beta",
      limit: 1,
      cursor: first.ok ? (first.value.nextCursor ?? undefined) : undefined,
    });
    const restarted = list({ q: "beta", limit: 1 });

    expect(idsOf(first)).toEqual(["tx-a"]);
    expect(first.ok ? first.value.nextCursor : null).not.toBeNull();
    expect(continued).toEqual({
      ok: false,
      errors: [{ field: "cursor", code: "invalidCursor" }],
    });
    expect(idsOf(restarted)).toEqual(["tx-b"]);
  });

  it("refuses a corrupt cursor", () => {
    expect(list({ cursor: "not-base64" })).toEqual({
      ok: false,
      errors: [{ field: "cursor", code: "invalidCursor" }],
    });
  });

  it("refuses untagged together with a tag identifier", () => {
    const expense = storeCategory(fixture, "Comida", "expense");
    const travel = storeTag(fixture, "Viaje");

    save(newTransaction({ category: expense, tagIds: [travel.id] }));

    expect(list({ tagIds: [travel.id], untagged: true })).toEqual({
      ok: false,
      errors: [
        { field: "tagId", code: "incompatibleFilters" },
        { field: "untagged", code: "incompatibleFilters" },
      ],
    });
  });
});

describe("snapshot-consistent page", () => {
  it("does not observe a writer that commits after the page snapshot starts", () => {
    const expense = storeCategory(fixture, "Comida", "expense");
    const first = save(
      newTransaction({
        id: "tx-old",
        category: expense,
        date: "2026-03-14",
        createdAt: 1,
      }),
    );
    const config = loadAppConfig(
      createValidAppEnv(fixture.connection.filePath),
    );

    if (!config.ok) {
      throw new Error(
        `Expected valid configuration: ${JSON.stringify(config)}`,
      );
    }

    const writer = openSqliteConnection(config.value);

    if (!writer.ok) {
      throw new Error(
        `Expected a second connection: ${JSON.stringify(writer)}`,
      );
    }

    try {
      const seen = fixture.connection.db.transaction((tx) => {
        const page = createListTransactions({
          query: sqliteTransactionQuery,
        }).execute({ isTransactional: true, db: tx }, { workspaceId });

        const newer = newTransaction({
          id: "tx-new",
          category: expense,
          date: "2026-03-15",
          createdAt: 9,
        });

        okValue(
          runInTransaction(writer.value, (unit) =>
            sqliteTransactionRepository.insertTransaction(unit, {
              workspaceId,
              transaction: newer,
            }),
          ),
        );

        const still = createListTransactions({
          query: sqliteTransactionQuery,
        }).execute({ isTransactional: true, db: tx }, { workspaceId });

        return { page, still };
      });

      expect(idsOf(seen.page)).toEqual([first.id]);
      expect(idsOf(seen.still)).toEqual([first.id]);
      expect(idsOf(list({ workspaceId }))).toEqual(["tx-new", first.id]);
    } finally {
      writer.value.close();
    }
  });

  it("refuses a page whose stored rows no longer satisfy the domain contract", () => {
    const expense = storeCategory(fixture, "Comida", "expense");
    save(newTransaction({ category: expense, concept: "Café" }));

    fixture.connection.sqlite
      .prepare("UPDATE category SET name = '' WHERE id = ?")
      .run(expense.id);

    expect(list({ workspaceId })).toEqual({
      ok: false,
      errors: [{ field: "storage", code: "unavailable" }],
    });
  });

  it("reports a closed connection as a storage failure instead of throwing", () => {
    const parsed = parseListTransactionsInput({ workspaceId });

    if (!parsed.ok) {
      throw new Error(`Expected valid filters: ${JSON.stringify(parsed)}`);
    }

    fixture.connection.close();

    expect(list({ workspaceId })).toEqual({
      ok: false,
      errors: [{ field: "storage", code: "unavailable" }],
    });
    expect(
      sqliteTransactionQuery.listTransactions(
        { isTransactional: true, db: fixture.connection.db },
        parsed.value,
      ).ok,
    ).toBe(false);
  });
});
