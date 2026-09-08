/**
 * Archive guards of active recurrence templates on a real SQLite file.
 *
 * Archive and generation share the same WAL file on two real connections. A
 * category or tag still copied by an active rule is refused with a conflict
 * that identifies that rule, including when the other connection is already
 * materialising a due date. Nothing here stubs the lookup, the archive write
 * or the generator.
 */

import { afterEach, describe, expect, it } from "vitest";

import { createClassificationMaintenance } from "../../../src/modules/classification/application/services/classification-maintenance";
import { sqliteCategoryRepository } from "../../../src/modules/classification/infrastructure/sqlite-category-repository";
import { sqliteTagRepository } from "../../../src/modules/classification/infrastructure/sqlite-tag-repository";
import type { DueDateRunner } from "../../../src/modules/recurring/application/ports/due-date-runner";
import { sqliteRecurringRuleRepository } from "../../../src/modules/recurring/infrastructure/sqlite-recurring-rule-repository";
import {
  sqliteDueDateRunner,
  type SqliteUnitOfWork,
} from "../../../src/modules/recurring/infrastructure/sqlite-unit-of-work";
import type { SqliteConnection } from "../../../src/shared/server/database";
import {
  type RecurringFixture,
  createGenerator,
  createRecurringFixture,
  deactivateRule,
  okValue,
  openWriter,
  readTransactions,
  runDomainTransaction,
  sequentialIds,
  storeCategory,
  storeRule,
  storeTag,
} from "./helpers";

const TODAY = "2026-09-08";

const fixtures: RecurringFixture[] = [];
const writers: SqliteConnection[] = [];

afterEach(() => {
  while (writers.length > 0) {
    writers.pop()?.close();
  }

  while (fixtures.length > 0) {
    fixtures.pop()?.cleanup();
  }
});

function openedFixture(): RecurringFixture {
  const fixture = createRecurringFixture();
  fixtures.push(fixture);
  return fixture;
}

function secondWriter(fixture: RecurringFixture): SqliteConnection {
  const writer = openWriter(fixture);
  writers.push(writer);
  return writer;
}

function maintenance() {
  return createClassificationMaintenance({
    categories: sqliteCategoryRepository,
    tags: sqliteTagRepository,
    rules: sqliteRecurringRuleRepository,
  });
}

describe("archive of a classification used by an active rule", () => {
  it("identifies the rule and leaves the category unchanged", () => {
    const fixture = openedFixture();
    const category = storeCategory(fixture, "Alquiler", "expense");
    storeRule(fixture, {
      id: "rule-rent",
      category,
      monthlyDay: 31,
      nextDueDate: "2026-08-31",
    });

    const refused = runDomainTransaction(fixture.connection, (unit) =>
      maintenance().archiveCategory(unit, {
        workspaceId: fixture.workspaceId,
        categoryId: category.id,
      }),
    );

    expect(refused).toEqual({
      ok: false,
      errors: [
        { field: "categoryId", code: "usedByActiveRule" },
        { field: "rule-rent", code: "usedByActiveRule" },
      ],
    });
    expect(
      fixture.connection.sqlite
        .prepare("SELECT archived_at FROM category WHERE id = ?")
        .get(category.id),
    ).toEqual({ archived_at: null });
  });

  it("lets a second connection lose the archive while generation still uses the rule", () => {
    const fixture = openedFixture();
    const category = storeCategory(fixture, "Alquiler", "expense");
    storeRule(fixture, {
      id: "rule-rent",
      category,
      monthlyDay: 31,
      nextDueDate: "2026-08-31",
    });
    const writer = secondWriter(fixture);
    let archiveResult:
      ReturnType<ReturnType<typeof maintenance>["archiveCategory"]> | undefined;
    let calls = 0;
    const racingRunner: DueDateRunner<SqliteUnitOfWork> = {
      runForDueDate(work) {
        calls += 1;

        if (calls === 2) {
          archiveResult = runDomainTransaction(writer, (unit) =>
            maintenance().archiveCategory(unit, {
              workspaceId: fixture.workspaceId,
              categoryId: category.id,
            }),
          );
        }

        return sqliteDueDateRunner(fixture.connection).runForDueDate(work);
      },
    };

    const report = okValue(
      createGenerator(fixture.connection, {
        today: TODAY,
        createId: sequentialIds("gen"),
        runner: racingRunner,
      }).execute({ workspaceId: fixture.workspaceId }),
    );

    expect(report.generated).toHaveLength(1);
    expect(archiveResult).toEqual({
      ok: false,
      errors: [
        { field: "categoryId", code: "usedByActiveRule" },
        { field: "rule-rent", code: "usedByActiveRule" },
      ],
    });
    expect(readTransactions(fixture.connection)).toHaveLength(1);
    expect(
      fixture.connection.sqlite
        .prepare("SELECT archived_at FROM category WHERE id = ?")
        .get(category.id),
    ).toEqual({ archived_at: null });
  });

  it("archives the tag after the rule that used it has stopped", () => {
    const fixture = openedFixture();
    const category = storeCategory(fixture, "Suscripciones", "expense");
    const tag = storeTag(fixture, "Streaming");
    storeRule(fixture, {
      id: "rule-netflix",
      category,
      tagIds: [tag.id],
      monthlyDay: 8,
      nextDueDate: "2026-10-08",
    });

    const blocked = runDomainTransaction(fixture.connection, (unit) =>
      maintenance().archiveTag(unit, {
        workspaceId: fixture.workspaceId,
        tagId: tag.id,
      }),
    );
    deactivateRule(fixture.connection, "rule-netflix");
    const archived = okValue(
      runDomainTransaction(fixture.connection, (unit) =>
        maintenance().archiveTag(unit, {
          workspaceId: fixture.workspaceId,
          tagId: tag.id,
        }),
      ),
    );

    expect(blocked).toEqual({
      ok: false,
      errors: [
        { field: "tagId", code: "usedByActiveRule" },
        { field: "rule-netflix", code: "usedByActiveRule" },
      ],
    });
    expect(archived.archivedAt).not.toBeNull();
  });
});
