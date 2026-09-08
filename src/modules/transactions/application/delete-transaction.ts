/**
 * Atomic deletion of a stored movement.
 *
 * The use case removes the workspace-scoped row and its tag links together.
 * Categories and tags it used are left in place. If the movement was generated
 * by a rule, the processed due date is unlinked first so the tombstone stays
 * and a later run never recreates the entry.
 */

import {
  type DomainError,
  type DomainResult,
  domainError,
  invalid,
  valid,
} from "../../../shared/domain/errors";
import { isIdentifier } from "../../../shared/domain/text";
import type { RecurringOccurrenceRepository } from "../../recurring/application/ports/recurring-repository";
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
  readonly occurrences?: RecurringOccurrenceRepository<TUnit>;
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
      return executeDeleteTransaction(unit, command, deps);
    },
  };
}

function executeDeleteTransaction<TUnit extends UnitOfWork>(
  unit: TUnit,
  command: DeleteTransactionCommand,
  deps: DeleteTransactionDeps<TUnit>,
): DomainResult<TransactionId> {
  if (!isIdentifier(command.transactionId)) {
    return invalid([domainError("id", "invalidIdentifier")]);
  }

  if (deps.occurrences) {
    if (!unit.isTransactional) {
      return invalid([domainError("storage", "unavailable")]);
    }

    const cleared = deps.occurrences.clearGeneratedTransaction(unit, {
      workspaceId: command.workspaceId,
      transactionId: command.transactionId as TransactionId,
    });

    if (!cleared.ok) {
      return invalid([domainError("storage", "unavailable")]);
    }
  }

  return fromTransactionResult(
    deps.transactions.deleteTransaction(unit, {
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
