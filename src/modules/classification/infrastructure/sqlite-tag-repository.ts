/**
 * SQLite adapter of the tag port.
 *
 * It follows the same rules as the category adapter: it runs on the handle the
 * caller owns, it lets the partial unique index of the schema decide a name
 * race, it carries the workspace in every statement, and it rebuilds stored
 * rows through the domain contract before returning them. Tags have no order
 * column, so their stable order is alphabetical by normalized name.
 */

import "server-only";

import { and, asc, eq, isNotNull, isNull, sql, type SQL } from "drizzle-orm";

import { tag } from "../../../../db/schema";
import { nameKey, normalizeName } from "../../../shared/domain/text";
import {
  type ClassificationResult,
  failed,
  succeeded,
} from "../application/ports/classification-repository";
import type {
  ArchiveTagCommand,
  InsertTagCommand,
  RenameTagCommand,
  TagByIdQuery,
  TagByNameQuery,
  TagListQuery,
  TagRepository,
} from "../application/ports/tag-repository";
import { type Tag, createTag } from "../domain/tag";
import { describeCause, writeErrorCode } from "./sqlite-errors";
import type { SqliteUnitOfWork } from "./sqlite-unit-of-work";

/** Row of the `tag` table as Drizzle returns it. */
interface TagRow {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly normalizedName: string;
  readonly archivedAt: number | null;
}

/** Keeps active tags before archived ones in every scoped list. */
const ACTIVE_FIRST = sql`case when ${tag.archivedAt} is null then 0 else 1 end`;

function listTags(
  unit: SqliteUnitOfWork,
  query: TagListQuery,
): ClassificationResult<readonly Tag[]> {
  const rows = selectTags(unit, listCondition(query));

  if (!rows.ok) {
    return rows;
  }

  const tags: Tag[] = [];

  for (const row of rows.value) {
    const built = toTag(row);

    if (!built.ok) {
      return built;
    }

    tags.push(built.value);
  }

  return succeeded(tags);
}

function findTagById(
  unit: SqliteUnitOfWork,
  query: TagByIdQuery,
): ClassificationResult<Tag | null> {
  return selectSingleTag(
    unit,
    and(eq(tag.workspaceId, query.workspaceId), eq(tag.id, query.tagId)),
  );
}

function findActiveTagByNormalizedName(
  unit: SqliteUnitOfWork,
  query: TagByNameQuery,
): ClassificationResult<Tag | null> {
  return selectSingleTag(
    unit,
    and(
      eq(tag.workspaceId, query.workspaceId),
      eq(tag.normalizedName, query.normalizedName),
      isNull(tag.archivedAt),
    ),
  );
}

function insertTag(
  unit: SqliteUnitOfWork,
  command: InsertTagCommand,
): ClassificationResult<Tag> {
  const stored = command.tag;

  try {
    unit.db
      .insert(tag)
      .values({
        id: stored.id,
        workspaceId: command.workspaceId,
        name: stored.name,
        normalizedName: stored.normalizedName,
        archivedAt: stored.archivedAt,
      })
      .run();
  } catch (cause) {
    return failed(writeErrorCode(cause), describeCause(cause));
  }

  return succeeded(stored);
}

function renameTag(
  unit: SqliteUnitOfWork,
  command: RenameTagCommand,
): ClassificationResult<Tag> {
  let rows: TagRow[];

  try {
    rows = unit.db
      .update(tag)
      .set({
        name: normalizeName(command.name),
        normalizedName: nameKey(command.name),
      })
      .where(
        and(
          eq(tag.workspaceId, command.workspaceId),
          eq(tag.id, command.tagId),
        ),
      )
      .returning()
      .all();
  } catch (cause) {
    return failed(writeErrorCode(cause), describeCause(cause));
  }

  const [row] = rows;

  if (row === undefined) {
    return failed("tagNotFound");
  }

  return toTag(row);
}

function archiveTag(
  unit: SqliteUnitOfWork,
  command: ArchiveTagCommand,
): ClassificationResult<Tag> {
  let rows: TagRow[];

  try {
    rows = unit.db
      .update(tag)
      .set({ archivedAt: command.archivedAt })
      .where(
        and(
          eq(tag.workspaceId, command.workspaceId),
          eq(tag.id, command.tagId),
          isNull(tag.archivedAt),
        ),
      )
      .returning()
      .all();
  } catch (cause) {
    return failed(writeErrorCode(cause), describeCause(cause));
  }

  const [row] = rows;

  if (row === undefined) {
    return refuseUnarchivableTag(unit, command);
  }

  return toTag(row);
}

/**
 * Explains why an archival wrote no row: the workspace has no such tag, or the
 * tag was already archived, here or by a writer that got there first.
 */
function refuseUnarchivableTag(
  unit: SqliteUnitOfWork,
  command: ArchiveTagCommand,
): ClassificationResult<Tag> {
  const existing = findTagById(unit, {
    workspaceId: command.workspaceId,
    tagId: command.tagId,
  });

  if (!existing.ok) {
    return existing;
  }

  return failed(existing.value === null ? "tagNotFound" : "alreadyArchived");
}

function listCondition(query: TagListQuery): SQL | undefined {
  const conditions: SQL[] = [eq(tag.workspaceId, query.workspaceId)];

  if (query.status === "active") {
    conditions.push(isNull(tag.archivedAt));
  }

  if (query.status === "archived") {
    conditions.push(isNotNull(tag.archivedAt));
  }

  return and(...conditions);
}

function selectTags(
  unit: SqliteUnitOfWork,
  where: SQL | undefined,
): ClassificationResult<readonly TagRow[]> {
  try {
    return succeeded(
      unit.db
        .select()
        .from(tag)
        .where(where)
        .orderBy(ACTIVE_FIRST, asc(tag.normalizedName), asc(tag.id))
        .all(),
    );
  } catch (cause) {
    return failed("storageFailure", describeCause(cause));
  }
}

function selectSingleTag(
  unit: SqliteUnitOfWork,
  where: SQL | undefined,
): ClassificationResult<Tag | null> {
  const rows = selectTags(unit, where);

  if (!rows.ok) {
    return rows;
  }

  const [row] = rows.value;

  if (row === undefined) {
    return succeeded(null);
  }

  return toTag(row);
}

/**
 * Rebuilds a stored row through the domain contract and checks that the stored
 * comparison key still matches the name beside it.
 */
function toTag(row: TagRow): ClassificationResult<Tag> {
  const built = createTag({
    id: row.id,
    name: row.name,
    archivedAt: row.archivedAt,
  });

  if (!built.ok) {
    return failed(
      "invalidStoredRow",
      built.errors.map((error) => `${error.field}:${error.code}`).join(","),
    );
  }

  if (built.value.normalizedName !== row.normalizedName) {
    return failed("invalidStoredRow", "normalizedName:mismatch");
  }

  return succeeded(built.value);
}

/** Tag port backed by a real SQLite file. */
export const sqliteTagRepository: TagRepository<SqliteUnitOfWork> = {
  listTags,
  findTagById,
  findActiveTagByNormalizedName,
  insertTag,
  renameTag,
  archiveTag,
};
