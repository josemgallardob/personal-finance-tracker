/**
 * Atomic replacement of a stored movement.
 *
 * The use case reloads the workspace-scoped row, applies the same date and
 * money rules as a create, and replaces its fields and tag set together. An
 * archived category or tag may stay only when it is already linked to that
 * movement and the type does not change; any other archived reference is
 * refused. Newly named tags are created inside the caller-owned transaction so
 * a refused save rolls them back with the edit that never landed.
 */

import { randomUUID } from "node:crypto";

import {
  type ResolveTagInput,
  resolveTags,
} from "../../classification/application/resolve-tags";
import type { CategoryRepository } from "../../classification/application/ports/category-repository";
import type { ClassificationRepositoryError } from "../../classification/application/ports/classification-repository";
import type { TagRepository } from "../../classification/application/ports/tag-repository";
import {
  type Category,
  type CategoryId,
  createCategory,
  isCategoryActive,
} from "../../classification/domain/category";
import {
  type Tag,
  type TagId,
  isTagActive,
} from "../../classification/domain/tag";
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
import { isIdentifier } from "../../../shared/domain/text";
import { toTimestamp } from "../../../shared/domain/timestamp";
import {
  createTransaction,
  MAX_TAGS_PER_TRANSACTION,
  type Transaction,
  type TransactionId,
} from "../domain/transaction";
import type {
  TransactionRepository,
  TransactionRepositoryError,
  TransactionResult,
} from "./ports/transaction-repository";
import type { UnitOfWork } from "./ports/unit-of-work";

/** Workspace-scoped replacement of a confirmed movement. */
export interface UpdateTransactionCommand {
  readonly workspaceId: string;
  readonly transactionId: string;
  readonly type: string;
  readonly amountMinor: number;
  readonly date: string;
  readonly categoryId: string;
  readonly concept: string | null;
  readonly note: string | null;
  readonly tags?: readonly ResolveTagInput[];
}

/** Collaborators of the use case. Clock, identifiers and time are injectable. */
export interface UpdateTransactionDeps<TUnit extends UnitOfWork> {
  readonly transactions: TransactionRepository<TUnit>;
  readonly categories: CategoryRepository<TUnit>;
  readonly tags: TagRepository<TUnit>;
  readonly clock?: Clock;
  readonly createId?: () => string;
  readonly now?: () => number;
}

/** Edit use case bound to one set of ports. */
export interface UpdateTransaction<TUnit extends UnitOfWork> {
  execute(
    unit: TUnit,
    command: UpdateTransactionCommand,
  ): DomainResult<Transaction>;
}

/**
 * Builds the use case.
 *
 * Identifiers, the current instant and the civil day are injectable so tests
 * stay deterministic without patching uniqueness, archival or calendar rules.
 */
export function createUpdateTransaction<TUnit extends UnitOfWork>(
  deps: UpdateTransactionDeps<TUnit>,
): UpdateTransaction<TUnit> {
  const createId = deps.createId ?? randomUUID;
  const now = deps.now ?? Date.now;
  const clock = deps.clock ?? new SystemClock();

  return {
    execute(unit, command) {
      return executeUpdateTransaction(
        unit,
        command,
        deps.transactions,
        deps.categories,
        deps.tags,
        clock,
        createId,
        now,
      );
    },
  };
}

function executeUpdateTransaction<TUnit extends UnitOfWork>(
  unit: TUnit,
  command: UpdateTransactionCommand,
  transactions: TransactionRepository<TUnit>,
  categories: CategoryRepository<TUnit>,
  tags: TagRepository<TUnit>,
  clock: Clock,
  createId: () => string,
  now: () => number,
): DomainResult<Transaction> {
  if (!unit.isTransactional) {
    return invalid([domainError("storage", "unavailable")]);
  }

  if (!isIdentifier(command.transactionId)) {
    return invalid([domainError("id", "invalidIdentifier")]);
  }

  const existing = transactions.findTransactionById(unit, {
    workspaceId: command.workspaceId,
    transactionId: command.transactionId as TransactionId,
  });

  if (!existing.ok) {
    return fromTransactionResult(existing);
  }

  if (existing.value === null) {
    return invalid([domainError("id", "notFound")]);
  }

  const category = requireEditableCategory(
    unit,
    categories,
    command,
    existing.value,
  );

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

  const updatedAt = toTimestamp("updatedAt", now());

  if (!updatedAt.ok) {
    return updatedAt;
  }

  const resolved = resolveEditableTags(
    unit,
    tags,
    command,
    existing.value,
    createId,
  );

  if (!resolved.ok) {
    return resolved;
  }

  const built = createTransaction({
    id: existing.value.id,
    type: command.type,
    amountMinor: command.amountMinor,
    date: command.date,
    category: category.value,
    concept: command.concept,
    note: command.note,
    tagIds: resolved.value.map((tag) => tag.id),
    createdAt: existing.value.createdAt,
    updatedAt: updatedAt.value,
  });

  if (!built.ok) {
    return built;
  }

  return fromTransactionResult(
    transactions.updateTransaction(unit, {
      workspaceId: command.workspaceId,
      transaction: built.value,
    }),
  );
}

/**
 * Accepts the incoming category when it is active and compatible, or when it is
 * the archived category the movement already has and the type stays the same.
 */
function requireEditableCategory<TUnit extends UnitOfWork>(
  unit: TUnit,
  categories: CategoryRepository<TUnit>,
  command: UpdateTransactionCommand,
  existing: Transaction,
): DomainResult<Category> {
  if (!isIdentifier(command.categoryId)) {
    return invalid([domainError("categoryId", "invalidIdentifier")]);
  }

  const type = createCategory({
    id: "assignable-type-check",
    name: "Assignable",
    type: command.type,
    sortOrder: 0,
    archivedAt: null,
  });

  if (!type.ok) {
    return invalid(type.errors.filter((error) => error.field === "type"));
  }

  const found = categories.findCategoryById(unit, {
    workspaceId: command.workspaceId,
    categoryId: command.categoryId as CategoryId,
  });

  if (!found.ok) {
    return fromClassification(found.error, "categoryId");
  }

  if (found.value === null) {
    return invalid([domainError("categoryId", "notFound")]);
  }

  if (found.value.type !== type.value.type) {
    return invalid([domainError("type", "incompatibleCategoryType")]);
  }

  const keepsCurrentArchived =
    found.value.id === existing.categoryId &&
    existing.type === type.value.type &&
    !isCategoryActive(found.value);

  if (!isCategoryActive(found.value) && !keepsCurrentArchived) {
    return invalid([domainError("categoryId", "archived")]);
  }

  return valid(found.value);
}

/**
 * Resolves the replacement tag set.
 *
 * Identifiers already linked to the movement are kept even when archived.
 * Every other input follows the create resolver, so a newly chosen archived
 * tag is refused and a removed archived tag cannot be added back.
 */
function resolveEditableTags<TUnit extends UnitOfWork>(
  unit: TUnit,
  tags: TagRepository<TUnit>,
  command: UpdateTransactionCommand,
  existing: Transaction,
  createId: () => string,
): DomainResult<readonly Tag[]> {
  const previousIds = new Set(existing.tagIds);
  const retained: Tag[] = [];
  const toResolve: ResolveTagInput[] = [];
  const errors: DomainError[] = [];
  const seen = new Set<string>();

  for (const input of command.tags ?? []) {
    const linkedId = linkedTagId(input, previousIds);

    if (linkedId === null) {
      toResolve.push(input);
      continue;
    }

    const found = tags.findTagById(unit, {
      workspaceId: command.workspaceId,
      tagId: linkedId,
    });

    if (!found.ok) {
      errors.push(toClassificationDomainError(found.error, "tagId"));
      continue;
    }

    if (found.value === null) {
      errors.push(domainError("tagId", "notFound"));
      continue;
    }

    if (isTagActive(found.value)) {
      toResolve.push(input);
      continue;
    }

    if (seen.has(found.value.id)) {
      continue;
    }

    seen.add(found.value.id);
    retained.push(found.value);
  }

  const resolved = resolveTags(
    unit,
    tags,
    { workspaceId: command.workspaceId, tags: toResolve },
    { createId },
  );

  if (!resolved.ok) {
    return errors.length > 0
      ? invalid([...errors, ...resolved.errors])
      : resolved;
  }

  const merged = [...retained, ...resolved.value];

  if (merged.length > MAX_TAGS_PER_TRANSACTION) {
    errors.push(domainError("tags", "tooManyTags"));
  }

  if (errors.length > 0) {
    return invalid(errors);
  }

  return valid(merged);
}

function linkedTagId(
  input: ResolveTagInput,
  previousIds: ReadonlySet<string>,
): TagId | null {
  if (input.tagId === undefined) {
    return null;
  }

  if (!isIdentifier(input.tagId) || !previousIds.has(input.tagId)) {
    return null;
  }

  return input.tagId as TagId;
}

function fromTransactionResult<TValue>(
  result: TransactionResult<TValue>,
): DomainResult<TValue> {
  if (result.ok) {
    return valid(result.value);
  }

  return invalid([toTransactionDomainError(result.error)]);
}

function fromClassification(
  error: ClassificationRepositoryError,
  nameField: string,
): DomainResult<never> {
  return invalid([toClassificationDomainError(error, nameField)]);
}

function toTransactionDomainError(
  error: TransactionRepositoryError,
): DomainError {
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

function toClassificationDomainError(
  error: ClassificationRepositoryError,
  nameField: string,
): DomainError {
  switch (error.code) {
    case "duplicateName":
      return domainError(nameField, "duplicateName");
    case "duplicateId":
      return domainError("id", "invalidIdentifier");
    case "categoryNotFound":
      return domainError("categoryId", "notFound");
    case "tagNotFound":
      return domainError("tagId", "notFound");
    case "alreadyArchived":
      return domainError(nameField, "alreadyArchived");
    case "invalidCategoryOrder":
    case "transactionRequired":
      return domainError("orderedCategoryIds", "invalidSortOrder");
    case "unknownWorkspace":
      return domainError("workspaceId", "notFound");
    case "invalidStoredRow":
    case "storageFailure":
      return domainError("storage", "unavailable");
  }
}
