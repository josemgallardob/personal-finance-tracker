import { describe, expect, it } from "vitest";

import type { RecurringOccurrenceRepository } from "../../recurring/application/ports/recurring-repository";
import {
  failed as recurringFailed,
  succeeded as recurringSucceeded,
} from "../../recurring/application/ports/recurring-repository";
import { failed, succeeded } from "./ports/transaction-repository";
import type { TransactionRepository } from "./ports/transaction-repository";
import type { UnitOfWork } from "./ports/unit-of-work";
import type { TransactionId } from "../domain/transaction";
import { createDeleteTransaction } from "./delete-transaction";

const unit: UnitOfWork = { isTransactional: true };
const TRANSACTION_ID = "0193f0a1-6f3d-7c62-9a24-8f5b0e1c2d35" as TransactionId;

function unused(): never {
  throw new Error("Unexpected repository method");
}

function transactions(
  overrides: Partial<TransactionRepository> = {},
): TransactionRepository {
  return {
    findTransactionById: unused,
    findTransactionsByIds: unused,
    insertTransaction: unused,
    updateTransaction: unused,
    deleteTransaction: unused,
    ...overrides,
  };
}

function service(overrides: Partial<TransactionRepository> = {}) {
  return createDeleteTransaction({
    transactions: transactions(overrides),
  });
}

describe("createDeleteTransaction", () => {
  it("deletes the movement by identifier", () => {
    const deleted = service({
      deleteTransaction: () => succeeded(TRANSACTION_ID),
    }).execute(unit, {
      workspaceId: "workspace-1",
      transactionId: TRANSACTION_ID,
    });

    expect(deleted).toEqual({ ok: true, value: TRANSACTION_ID });
  });

  it("refuses a malformed identifier without calling storage", () => {
    const deleted = service().execute(unit, {
      workspaceId: "workspace-1",
      transactionId: "not a uuid",
    });

    expect(deleted).toEqual({
      ok: false,
      errors: [{ field: "id", code: "invalidIdentifier" }],
    });
  });

  it("returns not found when the workspace does not own the movement", () => {
    const deleted = service({
      deleteTransaction: () => failed("transactionNotFound"),
    }).execute(unit, {
      workspaceId: "workspace-1",
      transactionId: TRANSACTION_ID,
    });

    expect(deleted).toEqual({
      ok: false,
      errors: [{ field: "id", code: "notFound" }],
    });
  });

  it("translates every named delete refusal into a domain field error", () => {
    const codes = [
      ["duplicateId", "id", "invalidIdentifier"],
      ["unknownCategory", "categoryId", "notFound"],
      ["unknownTag", "tagId", "notFound"],
      ["unknownWorkspace", "workspaceId", "notFound"],
      ["transactionRequired", "storage", "unavailable"],
      ["invalidStoredRow", "storage", "unavailable"],
      ["storageFailure", "storage", "unavailable"],
    ] as const;

    for (const [code, field, expected] of codes) {
      const deleted = service({
        deleteTransaction: () => failed(code),
      }).execute(unit, {
        workspaceId: "workspace-1",
        transactionId: TRANSACTION_ID,
      });

      expect(deleted).toEqual({
        ok: false,
        errors: [{ field, code: expected }],
      });
    }
  });

  it("clears a generated occurrence before deleting the movement", () => {
    let cleared = false;
    const occurrences: RecurringOccurrenceRepository = {
      reserveOccurrence: unused,
      linkGeneratedTransaction: unused,
      clearGeneratedTransaction: () => {
        cleared = true;
        return recurringSucceeded(null);
      },
    };

    const deleted = createDeleteTransaction({
      transactions: transactions({
        deleteTransaction: () => succeeded(TRANSACTION_ID),
      }),
      occurrences,
    }).execute(unit, {
      workspaceId: "workspace-1",
      transactionId: TRANSACTION_ID,
    });

    expect(cleared).toBe(true);
    expect(deleted).toEqual({ ok: true, value: TRANSACTION_ID });
  });

  it("refuses to clear a generated occurrence outside a transaction", () => {
    const deleted = createDeleteTransaction({
      transactions: transactions(),
      occurrences: {
        reserveOccurrence: unused,
        linkGeneratedTransaction: unused,
        clearGeneratedTransaction: unused,
      },
    }).execute(
      { isTransactional: false },
      {
        workspaceId: "workspace-1",
        transactionId: TRANSACTION_ID,
      },
    );

    expect(deleted).toEqual({
      ok: false,
      errors: [{ field: "storage", code: "unavailable" }],
    });
  });

  it("does not delete the movement when clearing the occurrence fails", () => {
    let deleted = false;
    const result = createDeleteTransaction({
      transactions: transactions({
        deleteTransaction: () => {
          deleted = true;
          return succeeded(TRANSACTION_ID);
        },
      }),
      occurrences: {
        reserveOccurrence: unused,
        linkGeneratedTransaction: unused,
        clearGeneratedTransaction: () => recurringFailed("storageFailure"),
      },
    }).execute(unit, {
      workspaceId: "workspace-1",
      transactionId: TRANSACTION_ID,
    });

    expect(deleted).toBe(false);
    expect(result).toEqual({
      ok: false,
      errors: [{ field: "storage", code: "unavailable" }],
    });
  });
});
