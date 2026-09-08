import { describe, expect, it } from "vitest";

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
});
