import { describe, expect, it } from "vitest";

import { createCategory } from "../../classification/domain/category";
import type { Transaction } from "../domain/transaction";
import { createTransaction } from "../domain/transaction";
import {
  encodeListCursor,
  parseListTransactionsInput,
} from "./list-transaction-filters";
import { createListTransactions } from "./list-transactions";
import type { TransactionQuery } from "./ports/transaction-query";
import { failed, succeeded } from "./ports/transaction-repository";
import type { UnitOfWork } from "./ports/unit-of-work";

const unit: UnitOfWork = { isTransactional: true };
const WORKSPACE = "workspace-1";

function unused(): never {
  throw new Error("Unexpected query method");
}

function expense(): Transaction {
  const category = createCategory({
    id: "category-expense",
    name: "Comida",
    type: "expense",
    sortOrder: 0,
    archivedAt: null,
  });

  if (!category.ok) {
    throw new Error(`Expected a category: ${JSON.stringify(category)}`);
  }

  const built = createTransaction({
    id: "tx-last",
    type: "expense",
    amountMinor: 1_250,
    date: "2026-03-14",
    category: category.value,
    concept: "Café",
    note: null,
    tagIds: [],
    createdAt: 1_746_268_800_000,
    updatedAt: 1_746_268_800_000,
  });

  if (!built.ok) {
    throw new Error(`Expected a transaction: ${JSON.stringify(built)}`);
  }

  return built.value;
}

function query(overrides: Partial<TransactionQuery> = {}): TransactionQuery {
  return {
    listTransactions: unused,
    ...overrides,
  };
}

function service(overrides: Partial<TransactionQuery> = {}) {
  return createListTransactions({ query: query(overrides) });
}

describe("createListTransactions", () => {
  it("returns the page and a cursor bound to the same filters", () => {
    const stored = expense();
    const listed = service({
      listTransactions: () => succeeded({ items: [stored], hasNextPage: true }),
    }).execute(unit, { workspaceId: WORKSPACE, limit: 1 });
    const fingerprint = parseListTransactionsInput({
      workspaceId: WORKSPACE,
      limit: 1,
    });

    expect(listed).toEqual({
      ok: true,
      value: {
        items: [stored],
        nextCursor: fingerprint.ok
          ? encodeListCursor(
              {
                date: stored.date,
                createdAt: stored.createdAt,
                id: stored.id,
              },
              fingerprint.value.fingerprint,
            )
          : null,
      },
    });
  });

  it("omits the next cursor on the last page", () => {
    const listed = service({
      listTransactions: () =>
        succeeded({ items: [expense()], hasNextPage: false }),
    }).execute(unit, { workspaceId: WORKSPACE });

    expect(listed.ok ? listed.value.nextCursor : "x").toBeNull();
  });

  it("omits the next cursor when storage claims another page without items", () => {
    const listed = service({
      listTransactions: () => succeeded({ items: [], hasNextPage: true }),
    }).execute(unit, { workspaceId: WORKSPACE });

    expect(listed).toEqual({
      ok: true,
      value: { items: [], nextCursor: null },
    });
  });

  it("does not query storage when the filters are refused", () => {
    const listed = service().execute(unit, {
      workspaceId: WORKSPACE,
      tagIds: ["tag-1"],
      untagged: true,
    });

    expect(listed).toEqual({
      ok: false,
      errors: [
        { field: "tagId", code: "incompatibleFilters" },
        { field: "untagged", code: "incompatibleFilters" },
      ],
    });
  });

  it("translates every named query refusal into a domain field error", () => {
    const codes = [
      ["duplicateId", "id", "invalidIdentifier"],
      ["transactionNotFound", "id", "notFound"],
      ["unknownCategory", "categoryId", "notFound"],
      ["unknownTag", "tagId", "notFound"],
      ["unknownWorkspace", "workspaceId", "notFound"],
      ["transactionRequired", "storage", "unavailable"],
      ["invalidStoredRow", "storage", "unavailable"],
      ["storageFailure", "storage", "unavailable"],
    ] as const;

    for (const [code, field, expected] of codes) {
      const listed = service({
        listTransactions: () => failed(code),
      }).execute(unit, { workspaceId: WORKSPACE });

      expect(listed).toEqual({
        ok: false,
        errors: [{ field, code: expected }],
      });
    }
  });
});
