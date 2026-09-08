/**
 * Atomic deletion of a stored movement.
 *
 * The use case removes the workspace-scoped row and its tag links together.
 * Categories and tags it used are left in place. Recurrence regeneration is
 * out of scope: deleting an entry here never recreates it.
 */

import {
  type DomainError,
  type DomainResult,
  domainError,
  invalid,
  valid,
} from "../../../shared/domain/errors";
import { isIdentifier } from "../../../shared/domain/text";
import type { TransactionId } from "../domain/transaction";
import type {
  TransactionRepository,
  TransactionRepositoryError,
  TransactionResult,
} from "./ports/transaction-repository";
import type { UnitOfWork } from "./ports/unit-of-work";

/** Workspace-scoped deletion of a confirmed movement. */
export interface DeleteTransactionCommand {
  readonly workspaceId: string;
  readonly transactionId: string;
}

/** Collaborators of the use case. */
export interface DeleteTransactionDeps<TUnit extends UnitOfWork> {
  readonly transactions: TransactionRepository<TUnit>;
}

/** Delete use case bound to one transaction port. */
export interface DeleteTransaction<TUnit extends UnitOfWork> {
  execute(
    unit: TUnit,
    command: DeleteTransactionCommand,
  ): DomainResult<TransactionId>;
}

/** Builds the use case. */
export function createDeleteTransaction<TUnit extends UnitOfWork>(
  deps: DeleteTransactionDeps<TUnit>,
): DeleteTransaction<TUnit> {
  return {
    execute(unit, command) {
      return executeDeleteTransaction(unit, command, deps.transactions);
    },
  };
}

function executeDeleteTransaction<TUnit extends UnitOfWork>(
  unit: TUnit,
  command: DeleteTransactionCommand,
  transactions: TransactionRepository<TUnit>,
): DomainResult<TransactionId> {
  if (!isIdentifier(command.transactionId)) {
    return invalid([domainError("id", "invalidIdentifier")]);
  }

  return fromTransactionResult(
    transactions.deleteTransaction(unit, {
      workspaceId: command.workspaceId,
      transactionId: command.transactionId as TransactionId,
    }),
  );
}

function fromTransactionResult<TValue>(
  result: TransactionResult<TValue>,
): DomainResult<TValue> {
  if (result.ok) {
    return valid(result.value);
  }

  return invalid([toDomainError(result.error)]);
}

function toDomainError(error: TransactionRepositoryError): DomainError {
  switch (error.code) {
    case "duplicateId":
      return domainError("id", "invalidIdentifier");
    case "transactionNotFound":
      return domainError("id", "notFound");
    case "unknownCategory":
      return domainError("categoryId", "notFound");
    case "unknownTag":
      return domainError("tagId", "notFound");
    case "unknownWorkspace":
      return domainError("workspaceId", "notFound");
    case "transactionRequired":
    case "invalidStoredRow":
    case "storageFailure":
      return domainError("storage", "unavailable");
  }
}
