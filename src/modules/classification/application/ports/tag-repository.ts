/**
 * Tag port.
 *
 * Tags cross categories, so their names are unique in the whole workspace and
 * they carry no order of their own: the schema stores no order column and the
 * list is alphabetical by normalized name. Like the category port, this is a
 * focused contract and not a generic CRUD repository: a tag is never deleted,
 * and every operation is scoped to a workspace and shares the caller's unit of
 * work.
 */

import type { Timestamp } from "../../../../shared/domain/timestamp";
import type { Tag, TagId } from "../../domain/tag";
import type {
  ClassificationResult,
  ClassificationStatus,
  WorkspaceScope,
} from "./classification-repository";
import type { UnitOfWork } from "./unit-of-work";

/** Scoped list of tags. */
export interface TagListQuery extends WorkspaceScope {
  readonly status: ClassificationStatus;
}

/** Lookup of a single tag by identifier. */
export interface TagByIdQuery extends WorkspaceScope {
  readonly tagId: TagId;
}

/** Lookup of the active tag that owns a normalized name. */
export interface TagByNameQuery extends WorkspaceScope {
  readonly normalizedName: string;
}

/** Insertion of a tag the domain already validated. */
export interface InsertTagCommand extends WorkspaceScope {
  readonly tag: Tag;
}

/**
 * Rename of an existing tag.
 *
 * The name comes from the domain contract that accepted it. The adapter stores
 * its normalized written form together with the comparison key uniqueness uses.
 * A rename never changes the archival mark or the history of the tag.
 */
export interface RenameTagCommand extends WorkspaceScope {
  readonly tagId: TagId;
  readonly name: string;
}

/** Archival of a tag, which keeps its history readable. */
export interface ArchiveTagCommand extends WorkspaceScope {
  readonly tagId: TagId;
  readonly archivedAt: Timestamp;
}

/** Focused storage contract of tags. */
export interface TagRepository<TUnitOfWork extends UnitOfWork = UnitOfWork> {
  /**
   * Lists the tags of a workspace in a stable order: active rows first, then by
   * normalized name and identifier.
   */
  listTags(
    unit: TUnitOfWork,
    query: TagListQuery,
  ): ClassificationResult<readonly Tag[]>;

  /** Reads one tag of the workspace, or `null` when it has none. */
  findTagById(
    unit: TUnitOfWork,
    query: TagByIdQuery,
  ): ClassificationResult<Tag | null>;

  /**
   * Reads the active tag that holds a normalized name. Archived tags are
   * ignored: only an active row can block a new name.
   */
  findActiveTagByNormalizedName(
    unit: TUnitOfWork,
    query: TagByNameQuery,
  ): ClassificationResult<Tag | null>;

  /**
   * Inserts a tag and returns the stored row. A name already taken by an active
   * tag is refused by the database constraint, so two concurrent writers cannot
   * both win.
   */
  insertTag(
    unit: TUnitOfWork,
    command: InsertTagCommand,
  ): ClassificationResult<Tag>;

  /** Renames a tag and returns the stored row. */
  renameTag(
    unit: TUnitOfWork,
    command: RenameTagCommand,
  ): ClassificationResult<Tag>;

  /**
   * Archives an active tag and returns the stored row. Archiving a tag that is
   * already archived changes nothing and is refused.
   */
  archiveTag(
    unit: TUnitOfWork,
    command: ArchiveTagCommand,
  ): ClassificationResult<Tag>;
}
