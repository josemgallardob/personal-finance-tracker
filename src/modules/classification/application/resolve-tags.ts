/**
 * Resolution of tag inputs inside the caller's save transaction.
 *
 * Each input is either an existing identifier or a new name. Names reuse the
 * active row that already owns the normalized form, so typing the same label
 * twice does not create a second tag. Archived identifiers are refused for a
 * new assignment; a name that only matches an archived row may create a fresh
 * active tag, because uniqueness applies to active names. The use case never
 * opens its own transaction: a cancelled save rolls the created rows back with
 * the movement that never landed.
 */

import { randomUUID } from "node:crypto";

import {
  type DomainError,
  type DomainResult,
  domainError,
  invalid,
  valid,
} from "../../../shared/domain/errors";
import { isIdentifier } from "../../../shared/domain/text";
import { MAX_TAGS_PER_TRANSACTION } from "../../transactions/domain/transaction";
import { type Tag, type TagId, createTag, isTagActive } from "../domain/tag";
import type { ClassificationRepositoryError } from "./ports/classification-repository";
import type { TagRepository } from "./ports/tag-repository";
import type { UnitOfWork } from "./ports/unit-of-work";

/** One tag chosen from a form: an existing id or a name to create or reuse. */
export type ResolveTagInput = {
  readonly tagId?: string;
  readonly name?: string;
};

/** Workspace-scoped list of tag inputs from a save. */
export interface ResolveTagsCommand {
  readonly workspaceId: string;
  readonly tags: readonly ResolveTagInput[];
}

/** Optional identifier factory so tests stay deterministic. */
export interface ResolveTagsOptions {
  readonly createId?: () => string;
}

/**
 * Resolves tag inputs to stored rows, creating missing names as needed.
 *
 * The unit must be transactional. Duplicates collapse to the first occurrence.
 * A race that loses the insert re-reads the winner and reuses it; only when
 * that row is still invisible is the conflict returned as a field error.
 */
export function resolveTags<TUnit extends UnitOfWork>(
  unit: TUnit,
  tags: TagRepository<TUnit>,
  command: ResolveTagsCommand,
  options: ResolveTagsOptions = {},
): DomainResult<readonly Tag[]> {
  if (!unit.isTransactional) {
    return invalid([domainError("tags", "unavailable")]);
  }

  const createId = options.createId ?? randomUUID;
  const resolved: Tag[] = [];
  const seen = new Set<string>();
  const errors: DomainError[] = [];

  for (const [index, input] of command.tags.entries()) {
    const parsed = parseInput(input, index);

    if (!parsed.ok) {
      errors.push(...parsed.errors);
      continue;
    }

    const tag = resolveOne(
      unit,
      tags,
      command.workspaceId,
      parsed.value,
      createId,
    );

    if (!tag.ok) {
      errors.push(...tag.errors);
      continue;
    }

    if (seen.has(tag.value.id)) {
      continue;
    }

    if (resolved.length >= MAX_TAGS_PER_TRANSACTION) {
      errors.push(domainError("tags", "tooManyTags"));
      break;
    }

    seen.add(tag.value.id);
    resolved.push(tag.value);
  }

  if (errors.length > 0) {
    return invalid(errors);
  }

  return valid(resolved);
}

type ParsedTagInput =
  | { readonly kind: "id"; readonly tagId: string }
  | { readonly kind: "name"; readonly name: string };

function parseInput(
  input: ResolveTagInput,
  index: number,
): DomainResult<ParsedTagInput> {
  const hasId = input.tagId !== undefined;
  const hasName = input.name !== undefined;

  if (!hasId && !hasName) {
    return invalid([domainError(tagField(index), "required")]);
  }

  if (hasId) {
    if (!isIdentifier(input.tagId ?? "")) {
      return invalid([domainError("tagId", "invalidIdentifier")]);
    }

    return valid({ kind: "id", tagId: input.tagId as string });
  }

  return valid({ kind: "name", name: input.name as string });
}

function resolveOne<TUnit extends UnitOfWork>(
  unit: TUnit,
  tags: TagRepository<TUnit>,
  workspaceId: string,
  input: ParsedTagInput,
  createId: () => string,
): DomainResult<Tag> {
  if (input.kind === "id") {
    return resolveById(unit, tags, workspaceId, input.tagId);
  }

  return resolveByName(unit, tags, workspaceId, input.name, createId);
}

function resolveById<TUnit extends UnitOfWork>(
  unit: TUnit,
  tags: TagRepository<TUnit>,
  workspaceId: string,
  tagId: string,
): DomainResult<Tag> {
  const existing = tags.findTagById(unit, {
    workspaceId,
    tagId: tagId as TagId,
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

function resolveByName<TUnit extends UnitOfWork>(
  unit: TUnit,
  tags: TagRepository<TUnit>,
  workspaceId: string,
  name: string,
  createId: () => string,
): DomainResult<Tag> {
  const built = createTag({
    id: createId(),
    name,
    archivedAt: null,
  });

  if (!built.ok) {
    return built;
  }

  const existing = tags.findActiveTagByNormalizedName(unit, {
    workspaceId,
    normalizedName: built.value.normalizedName,
  });

  if (!existing.ok) {
    return fromRepository(existing.error, "name");
  }

  if (existing.value !== null) {
    return valid(existing.value);
  }

  const inserted = tags.insertTag(unit, {
    workspaceId,
    tag: built.value,
  });

  if (inserted.ok) {
    return valid(inserted.value);
  }

  if (inserted.error.code !== "duplicateName") {
    return fromRepository(inserted.error, "name");
  }

  const winner = tags.findActiveTagByNormalizedName(unit, {
    workspaceId,
    normalizedName: built.value.normalizedName,
  });

  if (!winner.ok) {
    return fromRepository(winner.error, "name");
  }

  if (winner.value !== null) {
    return valid(winner.value);
  }

  return invalid([domainError("name", "duplicateName")]);
}

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
    case "tagNotFound":
    case "categoryNotFound":
      return domainError("tagId", "notFound");
    case "alreadyArchived":
      return domainError("tagId", "alreadyArchived");
    case "unknownWorkspace":
      return domainError("workspaceId", "notFound");
    case "invalidCategoryOrder":
    case "transactionRequired":
    case "invalidStoredRow":
    case "storageFailure":
      return domainError("storage", "unavailable");
  }
}

function tagField(index: number): string {
  return `tags.${index}`;
}
