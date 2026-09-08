/**
 * Tag repository against a real, migrated SQLite file.
 *
 * Tags are unique in the whole workspace, so the cases here check the global
 * name rules, the alphabetical order, the archival that keeps history and the
 * isolation between workspaces.
 */

import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { TagId } from "../../../src/modules/classification/domain/tag";
import { sqliteTagRepository } from "../../../src/modules/classification/infrastructure/sqlite-tag-repository";
import {
  autocommitUnitOfWork,
  type SqliteUnitOfWork,
} from "../../../src/modules/classification/infrastructure/sqlite-unit-of-work";
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
let unit: SqliteUnitOfWork;
let workspaceId: string;

beforeEach(() => {
  fixture = createClassificationFixture();
  unit = autocommitUnitOfWork(fixture.connection);
  workspaceId = fixture.workspaceId;
});

afterEach(() => {
  fixture.cleanup();
});

function insert(name: string) {
  return okValue(
    sqliteTagRepository.insertTag(unit, { workspaceId, tag: newTag(name) }),
  );
}

function activeNames(): readonly string[] {
  return okValue(
    sqliteTagRepository.listTags(unit, { workspaceId, status: "active" }),
  ).map((stored) => stored.name);
}

function archive(tagId: TagId) {
  return sqliteTagRepository.archiveTag(unit, {
    workspaceId,
    tagId,
    archivedAt: ARCHIVED_AT,
  });
}

describe("scoped tag reads", () => {
  it("stores an inserted tag and reads it back by identifier", () => {
    const stored = insert("Con Amigos");

    expect(
      okValue(
        sqliteTagRepository.findTagById(unit, {
          workspaceId,
          tagId: stored.id,
        }),
      ),
    ).toEqual({
      id: stored.id,
      name: "Con Amigos",
      normalizedName: "con amigos",
      archivedAt: null,
    });
  });

  it("lists tags alphabetically and keeps archived ones last", () => {
    insert("Vacaciones");
    insert("Madrid");
    const navidad = insert("Navidad");
    okValue(archive(navidad.id));

    expect(activeNames()).toEqual(["Madrid", "Vacaciones"]);
    expect(
      okValue(
        sqliteTagRepository.listTags(unit, { workspaceId, status: "archived" }),
      ).map((stored) => stored.name),
    ).toEqual(["Navidad"]);
    expect(
      okValue(
        sqliteTagRepository.listTags(unit, { workspaceId, status: "all" }),
      ).map((stored) => stored.name),
    ).toEqual(["Madrid", "Vacaciones", "Navidad"]);
  });

  it("finds only the active tag that holds a normalized name", () => {
    const stored = insert("Trabajo");

    expect(
      okValue(
        sqliteTagRepository.findActiveTagByNormalizedName(unit, {
          workspaceId,
          normalizedName: "trabajo",
        }),
      )?.id,
    ).toBe(stored.id);

    okValue(archive(stored.id));

    expect(
      okValue(
        sqliteTagRepository.findActiveTagByNormalizedName(unit, {
          workspaceId,
          normalizedName: "trabajo",
        }),
      ),
    ).toBeNull();
  });

  it("hides every row from another workspace", () => {
    const stored = insert("Viajes");
    const foreignWorkspaceId = randomUUID();

    expect(
      okValue(
        sqliteTagRepository.listTags(unit, {
          workspaceId: foreignWorkspaceId,
          status: "all",
        }),
      ),
    ).toEqual([]);
    expect(
      okValue(
        sqliteTagRepository.findTagById(unit, {
          workspaceId: foreignWorkspaceId,
          tagId: stored.id,
        }),
      ),
    ).toBeNull();
    expect(
      okValue(
        sqliteTagRepository.findActiveTagByNormalizedName(unit, {
          workspaceId: foreignWorkspaceId,
          normalizedName: "viajes",
        }),
      ),
    ).toBeNull();
  });

  it("reports a stored comparison key that no longer matches its name", () => {
    const stored = insert("Ocio");
    fixture.connection.sqlite
      .prepare("UPDATE tag SET normalized_name = ? WHERE id = ?")
      .run("otro", stored.id);

    expect(
      sqliteTagRepository.findTagById(unit, { workspaceId, tagId: stored.id }),
    ).toEqual({
      ok: false,
      error: { code: "invalidStoredRow", cause: "normalizedName:mismatch" },
    });
    expect(
      errorCode(
        sqliteTagRepository.listTags(unit, { workspaceId, status: "all" }),
      ),
    ).toBe("invalidStoredRow");
  });

  it("reports a stored row the domain contract would reject", () => {
    const stored = insert("Madrid");
    const tooLongName = "a".repeat(81);
    fixture.connection.sqlite
      .prepare("UPDATE tag SET name = ?, normalized_name = ? WHERE id = ?")
      .run(tooLongName, tooLongName, stored.id);

    expect(
      sqliteTagRepository.findTagById(unit, { workspaceId, tagId: stored.id }),
    ).toEqual({
      ok: false,
      error: { code: "invalidStoredRow", cause: "name:tooLong" },
    });
  });

  it("reports a controlled failure when the connection is closed", () => {
    fixture.connection.close();

    expect(
      errorCode(
        sqliteTagRepository.listTags(unit, { workspaceId, status: "active" }),
      ),
    ).toBe("storageFailure");
    expect(
      errorCode(
        sqliteTagRepository.findTagById(unit, {
          workspaceId,
          tagId: randomUUID() as TagId,
        }),
      ),
    ).toBe("storageFailure");
    expect(
      errorCode(
        sqliteTagRepository.insertTag(unit, {
          workspaceId,
          tag: newTag("Ocio"),
        }),
      ),
    ).toBe("storageFailure");
  });
});

describe("tag insertion", () => {
  it("refuses a name already used by an active tag, ignoring case", () => {
    insert("Navidad");

    expect(
      errorCode(
        sqliteTagRepository.insertTag(unit, {
          workspaceId,
          tag: newTag("  NAVIDAD "),
        }),
      ),
    ).toBe("duplicateName");
    expect(activeNames()).toEqual(["Navidad"]);
  });

  it("accepts the name of an archived tag again", () => {
    const stored = insert("Madrid");
    okValue(archive(stored.id));

    expect(
      errorCode(
        sqliteTagRepository.insertTag(unit, {
          workspaceId,
          tag: newTag("Madrid"),
        }),
      ),
    ).toBe("ok");
    expect(activeNames()).toEqual(["Madrid"]);
  });

  it("refuses an identifier that already exists", () => {
    const stored = insert("Trabajo");

    expect(
      errorCode(
        sqliteTagRepository.insertTag(unit, {
          workspaceId,
          tag: { ...newTag("Ocio"), id: stored.id },
        }),
      ),
    ).toBe("duplicateId");
  });

  it("refuses a workspace that does not exist", () => {
    expect(
      errorCode(
        sqliteTagRepository.insertTag(unit, {
          workspaceId: randomUUID(),
          tag: newTag("Viajes"),
        }),
      ),
    ).toBe("unknownWorkspace");
  });

  it("lets the database decide a race between two writers", () => {
    const writerUnit = autocommitUnitOfWork(fixture.openWriter());

    const free = okValue(
      sqliteTagRepository.findActiveTagByNormalizedName(writerUnit, {
        workspaceId,
        normalizedName: "regalos",
      }),
    );
    insert("Regalos");

    const late = sqliteTagRepository.insertTag(writerUnit, {
      workspaceId,
      tag: newTag("Regalos"),
    });

    expect(free).toBeNull();
    expect(errorCode(late)).toBe("duplicateName");
    expect(activeNames()).toEqual(["Regalos"]);
  });
});

describe("tag rename", () => {
  it("stores the normalized written form and its comparison key", () => {
    const stored = insert("Viajes");

    expect(
      okValue(
        sqliteTagRepository.renameTag(unit, {
          workspaceId,
          tagId: stored.id,
          name: "  Viajes   Largos ",
        }),
      ),
    ).toEqual({
      id: stored.id,
      name: "Viajes Largos",
      normalizedName: "viajes largos",
      archivedAt: null,
    });
  });

  it("refuses a name held by another active tag", () => {
    const stored = insert("Viajes");
    insert("Trabajo");

    expect(
      errorCode(
        sqliteTagRepository.renameTag(unit, {
          workspaceId,
          tagId: stored.id,
          name: "TRABAJO",
        }),
      ),
    ).toBe("duplicateName");
    expect(activeNames()).toEqual(["Trabajo", "Viajes"]);
  });

  it("refuses an unknown tag and a tag of another workspace", () => {
    const stored = insert("Ocio");

    expect(
      errorCode(
        sqliteTagRepository.renameTag(unit, {
          workspaceId,
          tagId: randomUUID() as TagId,
          name: "Otro",
        }),
      ),
    ).toBe("tagNotFound");
    expect(
      errorCode(
        sqliteTagRepository.renameTag(unit, {
          workspaceId: randomUUID(),
          tagId: stored.id,
          name: "Otro",
        }),
      ),
    ).toBe("tagNotFound");
    expect(activeNames()).toEqual(["Ocio"]);
  });
});

describe("tag archival", () => {
  it("archives an active tag and keeps it readable in the history", () => {
    const stored = insert("Navidad");

    expect(okValue(archive(stored.id)).archivedAt).toBe(ARCHIVED_AT);
    expect(activeNames()).toEqual([]);
    expect(
      okValue(
        sqliteTagRepository.findTagById(unit, {
          workspaceId,
          tagId: stored.id,
        }),
      )?.archivedAt,
    ).toBe(ARCHIVED_AT);
  });

  it("refuses to archive twice, an unknown tag and another workspace", () => {
    const stored = insert("Madrid");
    okValue(archive(stored.id));

    expect(errorCode(archive(stored.id))).toBe("alreadyArchived");
    expect(errorCode(archive(randomUUID() as TagId))).toBe("tagNotFound");
    expect(
      errorCode(
        sqliteTagRepository.archiveTag(unit, {
          workspaceId: randomUUID(),
          tagId: stored.id,
          archivedAt: ARCHIVED_AT,
        }),
      ),
    ).toBe("tagNotFound");
  });

  it("changes nothing when another writer holds the write lock", () => {
    const stored = insert("Viajes");
    const writer = fixture.openWriter();
    fixture.connection.sqlite.pragma("busy_timeout = 50");
    writer.sqlite.exec("BEGIN IMMEDIATE");

    const result = archive(stored.id);

    writer.sqlite.exec("ROLLBACK");

    expect(errorCode(result)).toBe("storageFailure");
    expect(activeNames()).toEqual(["Viajes"]);
  });

  it("reports an archived row that no longer satisfies the domain contract", () => {
    const stored = insert("Trabajo");
    fixture.connection.sqlite
      .prepare(
        "UPDATE tag SET archived_at = ?, normalized_name = ? WHERE id = ?",
      )
      .run(ARCHIVED_AT, "otro", stored.id);

    expect(errorCode(archive(stored.id))).toBe("invalidStoredRow");
  });
});
