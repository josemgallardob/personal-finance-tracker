/**
 * Manual creation of a movement.
 *
 * The use case assigns the identifier on the server, refuses a civil date after
 * today in Madrid, requires an active category of the same workspace and type,
 * and resolves tags inside the caller-owned transaction. The movement and any
 * tags created for it land together or not at all. The result is the normalised
 * domain representation; HTTP never enters this layer.
 */

import { randomUUID } from "node:crypto";

import {
  type ResolveTagInput,
  resolveTags,
} from "../../classification/application/resolve-tags";
import { createClassificationMaintenance } from "../../classification/application/services/classification-maintenance";
import type { CategoryRepository } from "../../classification/application/ports/category-repository";
import type { TagRepository } from "../../classification/application/ports/tag-repository";
import { type Clock, SystemClock } from "../../../shared/domain/clock";
import {
  compareLocalDates,
  parseLocalDate,
} from "../../../shared/domain/dates";
import {
  type DomainError,
  type DomainResult,
  domainError,
  invalid,
  valid,
} from "../../../shared/domain/errors";
import { toTimestamp } from "../../../shared/domain/timestamp";
import { createTransaction, type Transaction } from "../domain/transaction";
import type {
  TransactionRepository,
  TransactionRepositoryError,
  TransactionResult,
} from "./ports/transaction-repository";
import type { UnitOfWork } from "./ports/unit-of-work";

/** Workspace-scoped values of a confirmed save. */
export interface CreateTransactionCommand {
  readonly workspaceId: string;
  readonly type: string;
  readonly amountMinor: number;
  readonly date: string;
  readonly categoryId: string;
  readonly concept: string | null;
  readonly note: string | null;
  readonly tags?: readonly ResolveTagInput[];
}

/** Collaborators of the use case. Clock, identifiers and time are injectable. */
export interface CreateTransactionDeps<TUnit extends UnitOfWork> {
  readonly transactions: TransactionRepository<TUnit>;
  readonly categories: CategoryRepository<TUnit>;
  readonly tags: TagRepository<TUnit>;
  readonly clock?: Clock;
  readonly createId?: () => string;
  readonly now?: () => number;
}

/** Manual-create use case bound to one set of ports. */
export interface CreateTransaction<TUnit extends UnitOfWork> {
  execute(
    unit: TUnit,
    command: CreateTransactionCommand,
  ): DomainResult<Transaction>;
}

/**
 * Builds the use case.
 *
 * Identifiers, the current instant and the civil day are injectable so tests
 * stay deterministic without patching uniqueness, archival or calendar rules.
 */
export function createCreateTransaction<TUnit extends UnitOfWork>(
  deps: CreateTransactionDeps<TUnit>,
): CreateTransaction<TUnit> {
  const createId = deps.createId ?? randomUUID;
  const now = deps.now ?? Date.now;
  const clock = deps.clock ?? new SystemClock();
  const maintenance = createClassificationMaintenance({
    categories: deps.categories,
    tags: deps.tags,
  });

  return {
    execute(unit, command) {
      return executeCreateTransaction(
        unit,
        command,
        deps.transactions,
        deps.tags,
        maintenance,
        clock,
        createId,
        now,
      );
    },
  };
}

function executeCreateTransaction<TUnit extends UnitOfWork>(
  unit: TUnit,
  command: CreateTransactionCommand,
  transactions: TransactionRepository<TUnit>,
  tags: TagRepository<TUnit>,
  maintenance: ReturnType<typeof createClassificationMaintenance<TUnit>>,
  clock: Clock,
  createId: () => string,
  now: () => number,
): DomainResult<Transaction> {
  if (!unit.isTransactional) {
    return invalid([domainError("storage", "unavailable")]);
  }

  const category = maintenance.requireAssignableCategory(unit, {
    workspaceId: command.workspaceId,
    categoryId: command.categoryId,
    type: command.type,
  });

  if (!category.ok) {
    return category;
  }

  const date = parseLocalDate(command.date);

  if (!date.ok) {
    return invalid([domainError("date", "invalidDate")]);
  }

  if (compareLocalDates(date.value, clock.today()) > 0) {
    return invalid([domainError("date", "futureDate")]);
  }

  const createdAt = toTimestamp("createdAt", now());

  if (!createdAt.ok) {
    return createdAt;
  }

  const resolved = resolveTags(
    unit,
    tags,
    {
      workspaceId: command.workspaceId,
      tags: command.tags ?? [],
    },
    { createId },
  );

  if (!resolved.ok) {
    return resolved;
  }

  const built = createTransaction({
    id: createId(),
    type: command.type,
    amountMinor: command.amountMinor,
    date: command.date,
    category: category.value,
    concept: command.concept,
    note: command.note,
    tagIds: resolved.value.map((tag) => tag.id),
    createdAt: createdAt.value,
    updatedAt: createdAt.value,
  });

  if (!built.ok) {
    return built;
  }

  return fromTransactionResult(
    transactions.insertTransaction(unit, {
      workspaceId: command.workspaceId,
      transaction: built.value,
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
