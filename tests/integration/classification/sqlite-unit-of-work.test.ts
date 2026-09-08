/**
 * Caller-owned unit of work against a real, migrated SQLite file.
 *
 * The cases prove that the classification repositories share the transaction
 * the caller opened: what commits, commits together, and what is refused or
 * throws leaves no partial write behind.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { sqliteCategoryRepository } from "../../../src/modules/classification/infrastructure/sqlite-category-repository";
import { sqliteTagRepository } from "../../../src/modules/classification/infrastructure/sqlite-tag-repository";
import {
  autocommitUnitOfWork,
  runInTransaction,
} from "../../../src/modules/classification/infrastructure/sqlite-unit-of-work";
import {
  type ClassificationFixture,
  createClassificationFixture,
  errorCode,
  newCategory,
  newTag,
  okValue,
} from "./helpers";

let fixture: ClassificationFixture;
let workspaceId: string;

beforeEach(() => {
  fixture = createClassificationFixture();
  workspaceId = fixture.workspaceId;
});

afterEach(() => {
  fixture.cleanup();
});

function storedCounts(): { categories: number; tags: number } {
  const unit = autocommitUnitOfWork(fixture.connection);

  return {
    categories: okValue(
      sqliteCategoryRepository.listCategories(unit, {
        workspaceId,
        status: "all",
      }),
    ).length,
    tags: okValue(
      sqliteTagRepository.listTags(unit, { workspaceId, status: "all" }),
    ).length,
  };
}

describe("autocommit unit of work", () => {
  it("commits each statement on its own", () => {
    const unit = autocommitUnitOfWork(fixture.connection);

    okValue(
      sqliteCategoryRepository.insertCategory(unit, {
        workspaceId,
        category: newCategory("Casa", "expense", 0),
      }),
    );

    expect(unit.isTransactional).toBe(false);
    expect(storedCounts()).toEqual({ categories: 1, tags: 0 });
  });
});

describe("caller-owned transaction", () => {
  it("commits the writes of both repositories together", () => {
    const result = runInTransaction(fixture.connection, (unit) => {
      const category = sqliteCategoryRepository.insertCategory(unit, {
        workspaceId,
        category: newCategory("Casa", "expense", 0),
      });

      if (!category.ok) {
        return category;
      }

      expect(unit.isTransactional).toBe(true);

      return sqliteTagRepository.insertTag(unit, {
        workspaceId,
        tag: newTag("Navidad"),
      });
    });

    expect(errorCode(result)).toBe("ok");
    expect(storedCounts()).toEqual({ categories: 1, tags: 1 });
  });

  it("rolls back every write when the work reports a refusal", () => {
    const result = runInTransaction(fixture.connection, (unit) => {
      okValue(
        sqliteTagRepository.insertTag(unit, {
          workspaceId,
          tag: newTag("Navidad"),
        }),
      );
      okValue(
        sqliteCategoryRepository.insertCategory(unit, {
          workspaceId,
          category: newCategory("Casa", "expense", 0),
        }),
      );

      return sqliteCategoryRepository.insertCategory(unit, {
        workspaceId,
        category: newCategory("CASA", "expense", 1),
      });
    });

    expect(errorCode(result)).toBe("duplicateName");
    expect(storedCounts()).toEqual({ categories: 0, tags: 0 });
  });

  it("rolls back and reports a controlled failure when the work throws", () => {
    const result = runInTransaction(fixture.connection, (unit) => {
      okValue(
        sqliteTagRepository.insertTag(unit, {
          workspaceId,
          tag: newTag("Navidad"),
        }),
      );

      throw "unexpected classification failure";
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "storageFailure",
        cause: "unexpected classification failure",
      },
    });
    expect(storedCounts()).toEqual({ categories: 0, tags: 0 });
  });
});
