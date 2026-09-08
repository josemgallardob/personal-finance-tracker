/**
 * Tag resolution against a real, migrated SQLite file.
 *
 * The cases cover reuse of normalized names, silent deduplication, rejection
 * of archived and foreign identifiers, a same-name race that reuses the
 * winner, and a caller rollback that removes tags created during a cancelled
 * save. Nothing here stubs the unique index or the transaction the caller owns.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveTags } from "../../../src/modules/classification/application/resolve-tags";
import { sqliteTagRepository } from "../../../src/modules/classification/infrastructure/sqlite-tag-repository";
import {
  autocommitUnitOfWork,
  runInTransaction,
} from "../../../src/modules/classification/infrastructure/sqlite-unit-of-work";
import { MAX_TAGS_PER_TRANSACTION } from "../../../src/modules/transactions/domain/transaction";
import type { Timestamp } from "../../../src/shared/domain/timestamp";
import {
  type ClassificationFixture,
  createClassificationFixture,
  errorCode,
  newTag,
  okValue,
} from "./helpers";

const ARCHIVED_AT = 1_746_268_800_000 as Timestamp;

let fixture: ClassificationFixture;
let workspaceId: string;
let ids: number;

beforeEach(() => {
  fixture = createClassificationFixture();
  workspaceId = fixture.workspaceId;
  ids = 0;
});

afterEach(() => {
  fixture.cleanup();
});

function createId(): string {
  ids += 1;
  return `tag-${ids}`;
}

function unit() {
  return autocommitUnitOfWork(fixture.connection);
}

function resolve(
  tags: Parameters<typeof resolveTags>[2]["tags"],
  workspace = workspaceId,
) {
  return runInTransaction(fixture.connection, (transaction) => {
    const result = resolveTags(
      transaction,
      sqliteTagRepository,
      { workspaceId: workspace, tags },
      { createId },
    );

    if (!result.ok) {
      return {
        ok: false as const,
        error: {
          code: "storageFailure" as const,
          cause: JSON.stringify(result.errors),
        },
      };
    }

    return { ok: true as const, value: result.value };
  });
}

function errorsOf(result: ReturnType<typeof resolve>) {
  if (result.ok) {
    return [];
  }

  return JSON.parse(result.error.cause ?? "[]") as Array<{
    field: string;
    code: string;
  }>;
}

describe("resolveTags", () => {
  it("creates a new name, reuses a normalized existing name and an id", () => {
    const stored = okValue(
      sqliteTagRepository.insertTag(unit(), {
        workspaceId,
        tag: newTag("Navidad"),
      }),
    );

    const result = okValue(
      resolve([
        { name: "  Trabajo  " },
        { name: "navidad" },
        { tagId: stored.id },
        { name: "TRABAJO" },
      ]),
    );

    expect(result.map((tag) => tag.name)).toEqual(["Trabajo", "Navidad"]);
    expect(result.map((tag) => tag.id)).toEqual(["tag-1", stored.id]);
    expect(
      okValue(
        sqliteTagRepository.listTags(unit(), { workspaceId, status: "all" }),
      ),
    ).toHaveLength(2);
  });

  it("returns no tags for an empty input list", () => {
    expect(okValue(resolve([]))).toEqual([]);
  });

  it("rejects an archived identifier and a missing or foreign identifier", () => {
    const archived = okValue(
      sqliteTagRepository.insertTag(unit(), {
        workspaceId,
        tag: newTag("Vacaciones"),
      }),
    );
    okValue(
      sqliteTagRepository.archiveTag(unit(), {
        workspaceId,
        tagId: archived.id,
        archivedAt: ARCHIVED_AT,
      }),
    );

    expect(errorsOf(resolve([{ tagId: archived.id }]))).toEqual([
      { field: "tagId", code: "archived" },
    ]);
    expect(errorsOf(resolve([{ tagId: "missing-tag" }]))).toEqual([
      { field: "tagId", code: "notFound" },
    ]);
    expect(errorsOf(resolve([{ tagId: "bad id" }]))).toEqual([
      { field: "tagId", code: "invalidIdentifier" },
    ]);
    expect(
      errorsOf(resolve([{ tagId: archived.id }], "other-workspace")),
    ).toEqual([{ field: "tagId", code: "notFound" }]);
    expect(errorsOf(resolve([{}]))).toEqual([
      { field: "tags.0", code: "required" },
    ]);
  });

  it("lets a name that matches only an archived tag create a new active row", () => {
    const archived = okValue(
      sqliteTagRepository.insertTag(unit(), {
        workspaceId,
        tag: newTag("Madrid"),
      }),
    );
    okValue(
      sqliteTagRepository.archiveTag(unit(), {
        workspaceId,
        tagId: archived.id,
        archivedAt: ARCHIVED_AT,
      }),
    );

    const result = okValue(resolve([{ name: "madrid" }]));

    expect(result).toHaveLength(1);
    expect(result[0]?.id).not.toBe(archived.id);
    expect(result[0]?.archivedAt).toBeNull();
    expect(result[0]?.normalizedName).toBe("madrid");
  });

  it("rejects an invalid name before writing and too many unique tags", () => {
    expect(errorsOf(resolve([{ name: "   " }]))).toEqual([
      { field: "name", code: "required" },
    ]);
    expect(
      sqliteTagRepository.listTags(unit(), { workspaceId, status: "all" }),
    ).toMatchObject({ ok: true, value: [] });

    const tooMany = Array.from(
      { length: MAX_TAGS_PER_TRANSACTION + 1 },
      (_, index) => ({ name: `Tag ${index}` }),
    );

    expect(errorsOf(resolve(tooMany))).toEqual([
      { field: "tags", code: "tooManyTags" },
    ]);
  });

  it("rolls back tags created during a cancelled save", () => {
    const result = runInTransaction(fixture.connection, (transaction) => {
      const resolved = resolveTags(
        transaction,
        sqliteTagRepository,
        { workspaceId, tags: [{ name: "Navidad" }] },
        { createId },
      );

      expect(resolved.ok).toBe(true);
      return {
        ok: false as const,
        error: { code: "storageFailure" as const, cause: "save cancelled" },
      };
    });

    expect(errorCode(result)).toBe("storageFailure");
    expect(
      okValue(
        sqliteTagRepository.listTags(unit(), { workspaceId, status: "all" }),
      ),
    ).toEqual([]);
  });

  it("reuses the winning row or reports a controlled conflict on a same-name race", () => {
    const writer = autocommitUnitOfWork(fixture.openWriter());
    const winner = newTag("Regalos");

    const result = runInTransaction(fixture.connection, (transaction) => {
      const free = sqliteTagRepository.findActiveTagByNormalizedName(
        transaction,
        { workspaceId, normalizedName: "regalos" },
      );

      expect(free).toEqual({ ok: true, value: null });
      okValue(
        sqliteTagRepository.insertTag(writer, { workspaceId, tag: winner }),
      );

      const resolved = resolveTags(
        transaction,
        sqliteTagRepository,
        { workspaceId, tags: [{ name: "regalos" }] },
        { createId },
      );

      if (!resolved.ok) {
        return {
          ok: false as const,
          error: {
            code: "storageFailure" as const,
            cause: JSON.stringify(resolved.errors),
          },
        };
      }

      return { ok: true as const, value: resolved.value };
    });

    const listed = okValue(
      sqliteTagRepository.listTags(unit(), { workspaceId, status: "active" }),
    );
    expect(listed.map((tag) => tag.id)).toEqual([winner.id]);

    if (result.ok) {
      expect(result.value.map((tag) => tag.id)).toEqual([winner.id]);
    } else {
      expect(errorCode(result)).toBe("storageFailure");
      const errors = JSON.parse(result.error.cause ?? "[]") as Array<{
        field: string;
        code: string;
      }>;
      expect(["duplicateName", "unavailable"]).toContain(errors[0]?.code);
    }
  });

  it("rejects a new name for a workspace that does not exist", () => {
    expect(
      errorsOf(resolve([{ name: "Navidad" }], "missing-workspace")),
    ).toEqual([{ field: "workspaceId", code: "notFound" }]);
  });
});
