/**
 * Maintenance services of categories and tags.
 *
 * Create, rename, complete reorder and archive are the mutations of US-04 and
 * US-06. They validate through the domain contracts, persist through the
 * focused ports and return field errors for every conflict, so a caller never
 * has to treat a duplicate name or an invalid order as an unexpected failure.
 * Category type is taken from the stored row on every later mutation and has
 * no setter. An active recurrence that still copies a category or tag into its
 * template blocks archive with a conflict that identifies that rule.
 */

import { randomUUID } from "node:crypto";

import {
  type DomainError,
  type DomainResult,
  domainError,
  invalid,
  valid,
} from "../../../../shared/domain/errors";
import { isIdentifier } from "../../../../shared/domain/text";
import { toTimestamp } from "../../../../shared/domain/timestamp";
import { isTransactionType } from "../../../transactions/domain/transaction-type";
import {
  type Category,
  type CategoryId,
  createCategory,
  isCategoryActive,
} from "../../domain/category";
import { type Tag, type TagId, createTag, isTagActive } from "../../domain/tag";
import type { CategoryRepository } from "../ports/category-repository";
import type {
  ClassificationRepositoryError,
  ClassificationResult,
} from "../ports/classification-repository";
import type { TagRepository } from "../ports/tag-repository";
import type { UnitOfWork } from "../ports/unit-of-work";
import type {
  RecurringResult,
  RecurringRuleRepository,
} from "../../../recurring/application/ports/recurring-repository";

/** Dependencies the maintenance services share. */
export interface ClassificationMaintenanceDeps<TUnit extends UnitOfWork> {
  readonly categories: CategoryRepository<TUnit>;
  readonly tags: TagRepository<TUnit>;
  readonly rules?: Pick<
    RecurringRuleRepository<TUnit>,
    "findActiveRuleByCategory" | "findActiveRuleByTag"
  >;
  readonly createId?: () => string;
  readonly now?: () => number;
}

/** Command that creates a category of a fixed type. */
export interface CreateCategoryCommand {
  readonly workspaceId: string;
  readonly name: string;
  readonly type: string;
}

/** Command that renames a category without touching its type or history. */
export interface RenameCategoryCommand {
  readonly workspaceId: string;
  readonly categoryId: string;
  readonly name: string;
}

/** Command that applies a complete order of the active categories of one type. */
export interface ReorderCategoriesCommand {
  readonly workspaceId: string;
  readonly type: string;
  readonly orderedCategoryIds: readonly string[];
}

/** Command that archives a category, keeping its history readable. */
export interface ArchiveCategoryCommand {
  readonly workspaceId: string;
  readonly categoryId: string;
}

/** Command that creates a tag. */
export interface CreateTagCommand {
  readonly workspaceId: string;
  readonly name: string;
}

/** Command that renames a tag without touching its history. */
export interface RenameTagCommand {
  readonly workspaceId: string;
  readonly tagId: string;
  readonly name: string;
}

/** Command that archives a tag, keeping its history readable. */
export interface ArchiveTagCommand {
  readonly workspaceId: string;
  readonly tagId: string;
}

/** Lookup that decides whether a category may be assigned to a new movement. */
export interface AssignableCategoryQuery {
  readonly workspaceId: string;
  readonly categoryId: string;
  readonly type: string;
}

/** Lookup that decides whether a tag may be assigned to a new movement. */
export interface AssignableTagQuery {
  readonly workspaceId: string;
  readonly tagId: string;
}

/** Category and tag maintenance bound to one pair of ports. */
export interface ClassificationMaintenance<TUnit extends UnitOfWork> {
  createCategory(
    unit: TUnit,
    command: CreateCategoryCommand,
  ): DomainResult<Category>;
  renameCategory(
    unit: TUnit,
    command: RenameCategoryCommand,
  ): DomainResult<Category>;
  reorderCategories(
    unit: TUnit,
    command: ReorderCategoriesCommand,
  ): DomainResult<readonly Category[]>;
  archiveCategory(
    unit: TUnit,
    command: ArchiveCategoryCommand,
  ): DomainResult<Category>;
  createTag(unit: TUnit, command: CreateTagCommand): DomainResult<Tag>;
  renameTag(unit: TUnit, command: RenameTagCommand): DomainResult<Tag>;
  archiveTag(unit: TUnit, command: ArchiveTagCommand): DomainResult<Tag>;
  requireAssignableCategory(
    unit: TUnit,
    query: AssignableCategoryQuery,
  ): DomainResult<Category>;
  requireAssignableTag(
    unit: TUnit,
    query: AssignableTagQuery,
  ): DomainResult<Tag>;
}

/**
 * Builds the maintenance services.
 *
 * Identifiers and archive timestamps are injectable so tests stay deterministic
 * without patching uniqueness or archival rules.
 */
export function createClassificationMaintenance<TUnit extends UnitOfWork>(
  deps: ClassificationMaintenanceDeps<TUnit>,
): ClassificationMaintenance<TUnit> {
  const createId = deps.createId ?? randomUUID;
  const now = deps.now ?? Date.now;

  return {
    createCategory(unit, command) {
      return createCategoryRecord(unit, deps.categories, command, createId);
    },
    renameCategory(unit, command) {
      return renameCategoryRecord(unit, deps.categories, command);
    },
    reorderCategories(unit, command) {
      return reorderCategoryRecords(unit, deps.categories, command);
    },
    archiveCategory(unit, command) {
      return archiveCategoryRecord(unit, deps, command, now);
    },
    createTag(unit, command) {
      return createTagRecord(unit, deps.tags, command, createId);
    },
    renameTag(unit, command) {
      return renameTagRecord(unit, deps.tags, command);
    },
    archiveTag(unit, command) {
      return archiveTagRecord(unit, deps, command, now);
    },
    requireAssignableCategory(unit, query) {
      return requireAssignableCategoryRecord(unit, deps.categories, query);
    },
    requireAssignableTag(unit, query) {
      return requireAssignableTagRecord(unit, deps.tags, query);
    },
  };
}

function createCategoryRecord<TUnit extends UnitOfWork>(
  unit: TUnit,
  categories: CategoryRepository<TUnit>,
  command: CreateCategoryCommand,
  createId: () => string,
): DomainResult<Category> {
  const listed = categories.listCategories(unit, {
    workspaceId: command.workspaceId,
    status: "active",
    type: isTransactionType(command.type) ? command.type : undefined,
  });

  if (!listed.ok) {
    return fromRepository(listed.error, "name");
  }

  const sortOrder =
    listed.value.reduce((max, row) => Math.max(max, row.sortOrder), -1) + 1;
  const built = createCategory({
    id: createId(),
    name: command.name,
    type: command.type,
    sortOrder,
    archivedAt: null,
  });

  if (!built.ok) {
    return built;
  }

  return fromRepositoryResult(
    categories.insertCategory(unit, {
      workspaceId: command.workspaceId,
      category: built.value,
    }),
    "name",
  );
}

function renameCategoryRecord<TUnit extends UnitOfWork>(
  unit: TUnit,
  categories: CategoryRepository<TUnit>,
  command: RenameCategoryCommand,
): DomainResult<Category> {
  if (!isIdentifier(command.categoryId)) {
    return invalid([domainError("categoryId", "invalidIdentifier")]);
  }

  const existing = categories.findCategoryById(unit, {
    workspaceId: command.workspaceId,
    categoryId: command.categoryId as CategoryId,
  });

  if (!existing.ok) {
    return fromRepository(existing.error, "categoryId");
  }

  if (existing.value === null) {
    return invalid([domainError("categoryId", "notFound")]);
  }

  const built = createCategory({
    id: existing.value.id,
    name: command.name,
    type: existing.value.type,
    sortOrder: existing.value.sortOrder,
    archivedAt: existing.value.archivedAt,
  });

  if (!built.ok) {
    return built;
  }

  return fromRepositoryResult(
    categories.renameCategory(unit, {
      workspaceId: command.workspaceId,
      categoryId: existing.value.id,
      name: built.value.name,
    }),
    "name",
  );
}

function reorderCategoryRecords<TUnit extends UnitOfWork>(
  unit: TUnit,
  categories: CategoryRepository<TUnit>,
  command: ReorderCategoriesCommand,
): DomainResult<readonly Category[]> {
  const type = createCategory({
    id: "reorder-type-check",
    name: "Reorder",
    type: command.type,
    sortOrder: 0,
    archivedAt: null,
  });

  if (!type.ok) {
    return invalid(type.errors.filter((error) => error.field === "type"));
  }

  if (command.orderedCategoryIds.some((id) => !isIdentifier(id))) {
    return invalid([domainError("orderedCategoryIds", "invalidSortOrder")]);
  }

  return fromRepositoryResult(
    categories.reorderCategories(unit, {
      workspaceId: command.workspaceId,
      type: type.value.type,
      orderedCategoryIds: command.orderedCategoryIds as CategoryId[],
    }),
    "orderedCategoryIds",
  );
}

function archiveCategoryRecord<TUnit extends UnitOfWork>(
  unit: TUnit,
  deps: ClassificationMaintenanceDeps<TUnit>,
  command: ArchiveCategoryCommand,
  now: () => number,
): DomainResult<Category> {
  if (!isIdentifier(command.categoryId)) {
    return invalid([domainError("categoryId", "invalidIdentifier")]);
  }

  const archivedAt = toTimestamp("archivedAt", now());

  if (!archivedAt.ok) {
    return archivedAt;
  }

  if (deps.rules) {
    if (!unit.isTransactional) {
      return invalid([domainError("storage", "unavailable")]);
    }

    const blocked = refuseIfUsedByActiveRule(
      deps.rules.findActiveRuleByCategory(unit, {
        workspaceId: command.workspaceId,
        categoryId: command.categoryId as CategoryId,
      }),
      "categoryId",
    );

    if (!blocked.ok) {
      return blocked;
    }
  }

  return fromRepositoryResult(
    deps.categories.archiveCategory(unit, {
      workspaceId: command.workspaceId,
      categoryId: command.categoryId as CategoryId,
      archivedAt: archivedAt.value,
    }),
    "categoryId",
  );
}

function createTagRecord<TUnit extends UnitOfWork>(
  unit: TUnit,
  tags: TagRepository<TUnit>,
  command: CreateTagCommand,
  createId: () => string,
): DomainResult<Tag> {
  const built = createTag({
    id: createId(),
    name: command.name,
    archivedAt: null,
  });

  if (!built.ok) {
    return built;
  }

  return fromRepositoryResult(
    tags.insertTag(unit, {
      workspaceId: command.workspaceId,
      tag: built.value,
    }),
    "name",
  );
}

function renameTagRecord<TUnit extends UnitOfWork>(
  unit: TUnit,
  tags: TagRepository<TUnit>,
  command: RenameTagCommand,
): DomainResult<Tag> {
  if (!isIdentifier(command.tagId)) {
    return invalid([domainError("tagId", "invalidIdentifier")]);
  }

  const existing = tags.findTagById(unit, {
    workspaceId: command.workspaceId,
    tagId: command.tagId as TagId,
  });

  if (!existing.ok) {
    return fromRepository(existing.error, "tagId");
  }

  if (existing.value === null) {
    return invalid([domainError("tagId", "notFound")]);
  }

  const built = createTag({
    id: existing.value.id,
    name: command.name,
    archivedAt: existing.value.archivedAt,
  });

  if (!built.ok) {
    return built;
  }

  return fromRepositoryResult(
    tags.renameTag(unit, {
      workspaceId: command.workspaceId,
      tagId: existing.value.id,
      name: built.value.name,
    }),
    "name",
  );
}

function archiveTagRecord<TUnit extends UnitOfWork>(
  unit: TUnit,
  deps: ClassificationMaintenanceDeps<TUnit>,
  command: ArchiveTagCommand,
  now: () => number,
): DomainResult<Tag> {
  if (!isIdentifier(command.tagId)) {
    return invalid([domainError("tagId", "invalidIdentifier")]);
  }

  const archivedAt = toTimestamp("archivedAt", now());

  if (!archivedAt.ok) {
    return archivedAt;
  }

  if (deps.rules) {
    if (!unit.isTransactional) {
      return invalid([domainError("storage", "unavailable")]);
    }

    const blocked = refuseIfUsedByActiveRule(
      deps.rules.findActiveRuleByTag(unit, {
        workspaceId: command.workspaceId,
        tagId: command.tagId as TagId,
      }),
      "tagId",
    );

    if (!blocked.ok) {
      return blocked;
    }
  }

  return fromRepositoryResult(
    deps.tags.archiveTag(unit, {
      workspaceId: command.workspaceId,
      tagId: command.tagId as TagId,
      archivedAt: archivedAt.value,
    }),
    "tagId",
  );
}

function requireAssignableCategoryRecord<TUnit extends UnitOfWork>(
  unit: TUnit,
  categories: CategoryRepository<TUnit>,
  query: AssignableCategoryQuery,
): DomainResult<Category> {
  if (!isIdentifier(query.categoryId)) {
    return invalid([domainError("categoryId", "invalidIdentifier")]);
  }

  const type = createCategory({
    id: "assignable-type-check",
    name: "Assignable",
    type: query.type,
    sortOrder: 0,
    archivedAt: null,
  });

  if (!type.ok) {
    return invalid(type.errors.filter((error) => error.field === "type"));
  }

  const existing = categories.findCategoryById(unit, {
    workspaceId: query.workspaceId,
    categoryId: query.categoryId as CategoryId,
  });

  if (!existing.ok) {
    return fromRepository(existing.error, "categoryId");
  }

  if (existing.value === null) {
    return invalid([domainError("categoryId", "notFound")]);
  }

  if (!isCategoryActive(existing.value)) {
    return invalid([domainError("categoryId", "archived")]);
  }

  if (existing.value.type !== type.value.type) {
    return invalid([domainError("type", "incompatibleCategoryType")]);
  }

  return valid(existing.value);
}

function requireAssignableTagRecord<TUnit extends UnitOfWork>(
  unit: TUnit,
  tags: TagRepository<TUnit>,
  query: AssignableTagQuery,
): DomainResult<Tag> {
  if (!isIdentifier(query.tagId)) {
    return invalid([domainError("tagId", "invalidIdentifier")]);
  }

  const existing = tags.findTagById(unit, {
    workspaceId: query.workspaceId,
    tagId: query.tagId as TagId,
  });

  if (!existing.ok) {
    return fromRepository(existing.error, "tagId");
  }

  if (existing.value === null) {
    return invalid([domainError("tagId", "notFound")]);
  }

  if (!isTagActive(existing.value)) {
    return invalid([domainError("tagId", "archived")]);
  }

  return valid(existing.value);
}

function refuseIfUsedByActiveRule(
  lookup: RecurringResult<{ readonly rule: { readonly id: string } } | null>,
  classificationField: string,
): DomainResult<true> {
  if (!lookup.ok) {
    return invalid([domainError("storage", "unavailable")]);
  }

  if (lookup.value === null) {
    return valid(true);
  }

  return invalid([
    domainError(classificationField, "usedByActiveRule"),
    domainError(lookup.value.rule.id, "usedByActiveRule"),
  ]);
}

function fromRepositoryResult<TValue>(
  result: ClassificationResult<TValue>,
  nameField: string,
): DomainResult<TValue> {
  if (result.ok) {
    return valid(result.value);
  }

  return fromRepository(result.error, nameField);
}

/**
 * Turns a repository refusal into field errors a later HTTP adapter can map.
 *
 * Duplicate names, missing rows and incomplete orders stay named conflicts.
 * Only an unmodelled storage failure uses `unavailable`, still as a value,
 * never as a thrown generic error.
 */
function fromRepository(
  error: ClassificationRepositoryError,
  nameField: string,
): DomainResult<never> {
  return invalid([toDomainError(error, nameField)]);
}

function toDomainError(
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
