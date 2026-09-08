/**
 * Generation of the due dates of the active rules, on a real SQLite file.
 *
 * Every test runs the real use case over the real adapters, the committed
 * migrations and the production PRAGMAs. Races use two real connections to the
 * same file, and the failure that is injected is a real constraint violation:
 * an identifier that already belongs to a stored movement, which the schema
 * refuses exactly as it would refuse a collision in production. Nothing here
 * stubs the calendar, the uniqueness or the transaction boundary.
 */

import { afterEach, describe, expect, it } from "vitest";

import type { DueDateRunner } from "../../../src/modules/recurring/application/ports/due-date-runner";
import type { SqliteUnitOfWork } from "../../../src/modules/recurring/infrastructure/sqlite-unit-of-work";
import { sqliteDueDateRunner } from "../../../src/modules/recurring/infrastructure/sqlite-unit-of-work";
import type { SqliteConnection } from "../../../src/shared/server/database";
import {
  type RecurringFixture,
  NOW,
  createGenerator,
  createRecurringFixture,
  deactivateRule,
  newTransaction,
  okValue,
  openWriter,
  readOccurrences,
  readRule,
  readTransactionTags,
  readTransactions,
  rewindNextDueDate,
  runDomainTransaction,
  sequentialIds,
  storeCategory,
  storeRule,
  storeTag,
} from "./helpers";
import { createDeleteTransaction } from "../../../src/modules/transactions/application/delete-transaction";
import { sqliteRecurringOccurrenceRepository } from "../../../src/modules/recurring/infrastructure/sqlite-recurring-occurrence-repository";
import { sqliteTransactionRepository } from "../../../src/modules/transactions/infrastructure/sqlite-transaction-repository";
import { runInTransaction } from "../../../src/modules/transactions/infrastructure/sqlite-unit-of-work";

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

describe("generating one due date", () => {
  it("copies the stored template into the movement of that day", () => {
    const fixture = openedFixture();
    const category = storeCategory(fixture, "Suscripciones", "expense");
    const home = storeTag(fixture, "Casa");
    const leisure = storeTag(fixture, "Ocio");
    const rule = storeRule(fixture, {
      id: "rule-1",
      category,
      amountMinor: 1_299,
      concept: "Suscripción mensual",
      note: "Se cobra el último día",
      tagIds: [home.id, leisure.id],
      monthlyDay: 31,
      nextDueDate: "2026-08-31",
    });

    const report = okValue(
      createGenerator(fixture.connection, {
        today: TODAY,
        createId: sequentialIds("gen"),
      }).execute({ workspaceId: fixture.workspaceId }),
    );

    expect(report.generated).toEqual([
      {
        ruleId: "rule-1",
        scheduledFor: "2026-08-31",
        transactionId: "gen-2",
      },
    ]);
    expect(report.skipped).toEqual([]);
    expect(report.failed).toEqual([]);
    expect(readTransactions(fixture.connection)).toEqual([
      {
        id: "gen-2",
        type: "expense",
        amountMinor: 1_299,
        date: "2026-08-31",
        categoryId: category.id,
        concept: "Suscripción mensual",
        note: "Se cobra el último día",
      },
    ]);
    expect(readTransactionTags(fixture.connection, "gen-2")).toEqual(
      [home.id, leisure.id].sort(),
    );
    expect(readOccurrences(fixture.connection)).toEqual([
      {
        id: "gen-1",
        recurringRuleId: "rule-1",
        scheduledFor: "2026-08-31",
        transactionId: "gen-2",
      },
    ]);
    expect(readRule(fixture.connection, rule.id)).toEqual({
      nextDueDate: "2026-09-30",
      deactivatedAt: null,
    });
  });

  it("keeps a template without text or tags exactly as it is stored", () => {
    const fixture = openedFixture();
    const category = storeCategory(fixture, "Sueldo", "income");
    storeRule(fixture, {
      id: "rule-1",
      category,
      amountMinor: 250_000,
      concept: null,
      note: null,
      tagIds: [],
      monthlyDay: 1,
      nextDueDate: "2026-09-01",
    });

    okValue(
      createGenerator(fixture.connection, {
        today: TODAY,
        createId: sequentialIds("gen"),
      }).execute({ workspaceId: fixture.workspaceId }),
    );

    expect(readTransactions(fixture.connection)).toEqual([
      {
        id: "gen-2",
        type: "income",
        amountMinor: 250_000,
        date: "2026-09-01",
        categoryId: category.id,
        concept: null,
        note: null,
      },
    ]);
    expect(readTransactionTags(fixture.connection, "gen-2")).toEqual([]);
  });
});

describe("recovering omitted months", () => {
  it("creates every owed date once, in order, and stops in the future", () => {
    const fixture = openedFixture();
    const category = storeCategory(fixture, "Alquiler", "expense");
    storeRule(fixture, {
      id: "rule-1",
      category,
      monthlyDay: 31,
      nextDueDate: "2026-05-31",
    });

    const report = okValue(
      createGenerator(fixture.connection, {
        today: TODAY,
        createId: sequentialIds("gen"),
      }).execute({ workspaceId: fixture.workspaceId }),
    );

    expect(report.generated.map((entry) => entry.scheduledFor)).toEqual([
      "2026-05-31",
      "2026-06-30",
      "2026-07-31",
      "2026-08-31",
    ]);
    expect(report.generated.every((entry) => entry.scheduledFor <= TODAY)).toBe(
      true,
    );
    expect(
      (readTransactions(fixture.connection) as Array<{ date: string }>).map(
        (row) => row.date,
      ),
    ).toEqual(["2026-05-31", "2026-06-30", "2026-07-31", "2026-08-31"]);
    expect(readRule(fixture.connection, "rule-1")).toEqual({
      nextDueDate: "2026-09-30",
      deactivatedAt: null,
    });
  });

  it("creates the date that falls exactly on today and none after", () => {
    const fixture = openedFixture();
    const category = storeCategory(fixture, "Alquiler", "expense");
    storeRule(fixture, {
      id: "rule-1",
      category,
      monthlyDay: 8,
      nextDueDate: TODAY,
    });

    const report = okValue(
      createGenerator(fixture.connection, {
        today: TODAY,
        createId: sequentialIds("gen"),
      }).execute({ workspaceId: fixture.workspaceId }),
    );

    expect(report.generated.map((entry) => entry.scheduledFor)).toEqual([
      TODAY,
    ]);
    expect(report.generated[0]?.scheduledFor <= TODAY).toBe(true);
    expect(readRule(fixture.connection, "rule-1")).toEqual({
      nextDueDate: "2026-10-08",
      deactivatedAt: null,
    });
  });

  it("owes nothing when the next date is still in the future", () => {
    const fixture = openedFixture();
    const category = storeCategory(fixture, "Alquiler", "expense");
    storeRule(fixture, {
      id: "rule-1",
      category,
      monthlyDay: 30,
      nextDueDate: "2026-09-30",
    });

    const report = okValue(
      createGenerator(fixture.connection, { today: TODAY }).execute({
        workspaceId: fixture.workspaceId,
      }),
    );

    expect(report).toEqual({ generated: [], skipped: [], failed: [] });
    expect(readTransactions(fixture.connection)).toEqual([]);
    expect(readOccurrences(fixture.connection)).toEqual([]);
  });
});

describe("running the task twice", () => {
  it("creates nothing on the second run", () => {
    const fixture = openedFixture();
    const category = storeCategory(fixture, "Alquiler", "expense");
    storeRule(fixture, {
      id: "rule-1",
      category,
      monthlyDay: 31,
      nextDueDate: "2026-07-31",
    });
    const generator = createGenerator(fixture.connection, {
      today: TODAY,
      createId: sequentialIds("gen"),
    });

    const first = okValue(
      generator.execute({ workspaceId: fixture.workspaceId }),
    );
    const second = okValue(
      generator.execute({ workspaceId: fixture.workspaceId }),
    );

    expect(first.generated).toHaveLength(2);
    expect(second).toEqual({ generated: [], skipped: [], failed: [] });
    expect(readTransactions(fixture.connection)).toHaveLength(2);
    expect(readOccurrences(fixture.connection)).toHaveLength(2);
  });

  it("does not repeat a date when a crashed run left the rule behind", () => {
    const fixture = openedFixture();
    const category = storeCategory(fixture, "Alquiler", "expense");
    storeRule(fixture, {
      id: "rule-1",
      category,
      monthlyDay: 31,
      nextDueDate: "2026-08-31",
    });
    okValue(
      createGenerator(fixture.connection, {
        today: TODAY,
        createId: sequentialIds("first"),
      }).execute({ workspaceId: fixture.workspaceId }),
    );

    rewindNextDueDate(fixture.connection, "rule-1", "2026-08-31");

    const retried = okValue(
      createGenerator(fixture.connection, {
        today: TODAY,
        createId: sequentialIds("retry"),
      }).execute({ workspaceId: fixture.workspaceId }),
    );

    expect(retried.generated).toEqual([]);
    expect(retried.skipped).toEqual([
      {
        ruleId: "rule-1",
        scheduledFor: "2026-08-31",
        reason: "alreadyProcessed",
      },
    ]);
    expect(readTransactions(fixture.connection)).toHaveLength(1);
    expect(readOccurrences(fixture.connection)).toHaveLength(1);
    expect(readRule(fixture.connection, "rule-1")).toEqual({
      nextDueDate: "2026-09-30",
      deactivatedAt: null,
    });
  });
});

describe("a generated movement the user deleted", () => {
  it("is not created again and its processed date survives", () => {
    const fixture = openedFixture();
    const category = storeCategory(fixture, "Alquiler", "expense");
    storeRule(fixture, {
      id: "rule-1",
      category,
      monthlyDay: 31,
      nextDueDate: "2026-08-31",
    });
    okValue(
      createGenerator(fixture.connection, {
        today: TODAY,
        createId: sequentialIds("gen"),
      }).execute({ workspaceId: fixture.workspaceId }),
    );

    okValue(
      runDomainTransaction(fixture.connection, (unit) =>
        createDeleteTransaction({
          transactions: sqliteTransactionRepository,
          occurrences: sqliteRecurringOccurrenceRepository,
        }).execute(unit, {
          workspaceId: fixture.workspaceId,
          transactionId: "gen-2",
        }),
      ),
    );
    rewindNextDueDate(fixture.connection, "rule-1", "2026-08-31");

    const report = okValue(
      createGenerator(fixture.connection, {
        today: TODAY,
        createId: sequentialIds("again"),
      }).execute({ workspaceId: fixture.workspaceId }),
    );

    expect(report.skipped).toEqual([
      {
        ruleId: "rule-1",
        scheduledFor: "2026-08-31",
        reason: "alreadyProcessed",
      },
    ]);
    expect(readTransactions(fixture.connection)).toEqual([]);
    expect(readOccurrences(fixture.connection)).toEqual([
      {
        id: "gen-1",
        recurringRuleId: "rule-1",
        scheduledFor: "2026-08-31",
        transactionId: null,
      },
    ]);
  });
});

describe("two connections running at the same time", () => {
  it("materialises the same due date exactly once", () => {
    const fixture = openedFixture();
    const category = storeCategory(fixture, "Alquiler", "expense");
    storeRule(fixture, {
      id: "rule-1",
      category,
      monthlyDay: 31,
      nextDueDate: "2026-08-31",
    });
    const writer = secondWriter(fixture);

    const first = createGenerator(fixture.connection, {
      today: TODAY,
      createId: sequentialIds("first"),
    }).execute({ workspaceId: fixture.workspaceId });
    const second = createGenerator(writer, {
      today: TODAY,
      createId: sequentialIds("second"),
    }).execute({ workspaceId: fixture.workspaceId });

    expect(okValue(first).generated).toHaveLength(1);
    expect(okValue(second).generated).toEqual([]);
    expect(readTransactions(fixture.connection)).toHaveLength(1);
    expect(readOccurrences(writer)).toHaveLength(1);
    expect(readRule(writer, "rule-1")).toEqual({
      nextDueDate: "2026-09-30",
      deactivatedAt: null,
    });
  });

  it("lets the loser of a race write nothing at all", () => {
    const fixture = openedFixture();
    const category = storeCategory(fixture, "Alquiler", "expense");
    storeRule(fixture, {
      id: "rule-1",
      category,
      monthlyDay: 31,
      nextDueDate: "2026-08-31",
    });
    const writer = secondWriter(fixture);
    const winner = sqliteDueDateRunner(writer);

    /**
     * Runs the competing task after this one listed the owed dates and before
     * it opens the boundary of the first date, so both writers saw the same
     * next date. Both sides are the real runner over real connections; only
     * the moment they overlap is chosen here.
     */
    let calls = 0;
    const racingRunner: DueDateRunner<SqliteUnitOfWork> = {
      runForDueDate(work) {
        calls += 1;

        if (calls === 2) {
          okValue(
            createGenerate(writer, winner, "second").execute({
              workspaceId: fixture.workspaceId,
            }),
          );
        }

        return sqliteDueDateRunner(fixture.connection).runForDueDate(work);
      },
    };

    const report = okValue(
      createGenerator(fixture.connection, {
        today: TODAY,
        createId: sequentialIds("first"),
        runner: racingRunner,
      }).execute({ workspaceId: fixture.workspaceId }),
    );

    expect(report.generated).toEqual([]);
    expect(report.skipped).toEqual([
      { ruleId: "rule-1", scheduledFor: "2026-08-31", reason: "ruleChanged" },
    ]);
    expect(readTransactions(fixture.connection)).toHaveLength(1);
    expect(readOccurrences(fixture.connection)).toHaveLength(1);
  });
});

/** Builds a competing task on another connection with its own real runner. */
function createGenerate(
  connection: SqliteConnection,
  runner: DueDateRunner<SqliteUnitOfWork>,
  prefix: string,
) {
  return createGenerator(connection, {
    today: TODAY,
    createId: sequentialIds(prefix),
    runner,
  });
}

describe("a rule that stops generating", () => {
  it("is ignored once it is deactivated, however overdue it is", () => {
    const fixture = openedFixture();
    const category = storeCategory(fixture, "Alquiler", "expense");
    storeRule(fixture, {
      id: "rule-1",
      category,
      monthlyDay: 31,
      nextDueDate: "2026-05-31",
      deactivatedAt: NOW,
    });

    const report = okValue(
      createGenerator(fixture.connection, { today: TODAY }).execute({
        workspaceId: fixture.workspaceId,
      }),
    );

    expect(report).toEqual({ generated: [], skipped: [], failed: [] });
    expect(readTransactions(fixture.connection)).toEqual([]);
  });

  it("stops mid-run when it is deactivated between two dates", () => {
    const fixture = openedFixture();
    const category = storeCategory(fixture, "Alquiler", "expense");
    storeRule(fixture, {
      id: "rule-1",
      category,
      monthlyDay: 31,
      nextDueDate: "2026-06-30",
    });

    /**
     * Stops the rule from another connection after the first date committed.
     * The write is a real one on a real second connection; the runner only
     * decides when it happens, so the re-read inside the second boundary sees
     * a genuinely deactivated rule.
     */
    const writer = secondWriter(fixture);
    let dates = 0;
    const stoppingRunner: DueDateRunner<SqliteUnitOfWork> = {
      runForDueDate(work) {
        const result = sqliteDueDateRunner(fixture.connection).runForDueDate(
          work,
        );

        dates += 1;

        if (dates === 2) {
          deactivateRule(writer, "rule-1");
        }

        return result;
      },
    };

    const report = okValue(
      createGenerator(fixture.connection, {
        today: TODAY,
        createId: sequentialIds("gen"),
        runner: stoppingRunner,
      }).execute({ workspaceId: fixture.workspaceId }),
    );

    expect(report.generated.map((entry) => entry.scheduledFor)).toEqual([
      "2026-06-30",
    ]);
    expect(report.skipped).toEqual([
      { ruleId: "rule-1", scheduledFor: "2026-07-31", reason: "ruleChanged" },
    ]);
    expect(readTransactions(fixture.connection)).toHaveLength(1);
    expect(readRule(fixture.connection, "rule-1")).toEqual({
      nextDueDate: "2026-07-31",
      deactivatedAt: NOW,
    });
  });
});

describe("a due date that cannot be written", () => {
  it("rolls back completely and lets the next run recover it", () => {
    const fixture = openedFixture();
    const category = storeCategory(fixture, "Alquiler", "expense");
    storeRule(fixture, {
      id: "rule-1",
      category,
      monthlyDay: 31,
      nextDueDate: "2026-06-30",
    });

    /**
     * A movement already owns the identifier the third generated date would
     * take, so the insertion violates the primary key of the movement table.
     * The failure is a real constraint verdict on real rows.
     */
    okValue(
      runInTransaction(fixture.connection, (unit) =>
        sqliteTransactionRepository.insertTransaction(unit, {
          workspaceId: fixture.workspaceId,
          transaction: newTransaction({
            id: "gen-6",
            category,
            date: "2026-01-15",
          }),
        }),
      ) as never,
    );

    const report = okValue(
      createGenerator(fixture.connection, {
        today: TODAY,
        createId: sequentialIds("gen"),
      }).execute({ workspaceId: fixture.workspaceId }),
    );

    expect(report.generated.map((entry) => entry.scheduledFor)).toEqual([
      "2026-06-30",
      "2026-07-31",
    ]);
    expect(report.failed).toEqual([
      {
        ruleId: "rule-1",
        scheduledFor: "2026-08-31",
        code: "duplicateId",
      },
    ]);
    expect(
      (
        readOccurrences(fixture.connection) as Array<{ scheduledFor: string }>
      ).map((row) => row.scheduledFor),
    ).toEqual(["2026-06-30", "2026-07-31"]);
    expect(readRule(fixture.connection, "rule-1")).toEqual({
      nextDueDate: "2026-08-31",
      deactivatedAt: null,
    });

    const recovered = okValue(
      createGenerator(fixture.connection, {
        today: TODAY,
        createId: sequentialIds("recovered"),
      }).execute({ workspaceId: fixture.workspaceId }),
    );

    expect(recovered.generated.map((entry) => entry.scheduledFor)).toEqual([
      "2026-08-31",
    ]);
    expect(recovered.failed).toEqual([]);
    expect(
      (
        readOccurrences(fixture.connection) as Array<{ scheduledFor: string }>
      ).map((row) => row.scheduledFor),
    ).toEqual(["2026-06-30", "2026-07-31", "2026-08-31"]);
    expect(readRule(fixture.connection, "rule-1")).toEqual({
      nextDueDate: "2026-09-30",
      deactivatedAt: null,
    });
  });

  it("keeps the other rules of the run going", () => {
    const fixture = openedFixture();
    const category = storeCategory(fixture, "Alquiler", "expense");
    const salary = storeCategory(fixture, "Sueldo", "income");
    storeRule(fixture, {
      id: "rule-broken",
      category,
      monthlyDay: 15,
      nextDueDate: "2026-08-15",
    });
    storeRule(fixture, {
      id: "rule-healthy",
      category: salary,
      monthlyDay: 20,
      nextDueDate: "2026-08-20",
    });
    okValue(
      runInTransaction(fixture.connection, (unit) =>
        sqliteTransactionRepository.insertTransaction(unit, {
          workspaceId: fixture.workspaceId,
          transaction: newTransaction({
            id: "gen-2",
            category,
            date: "2026-01-15",
          }),
        }),
      ) as never,
    );

    const report = okValue(
      createGenerator(fixture.connection, {
        today: TODAY,
        createId: sequentialIds("gen"),
      }).execute({ workspaceId: fixture.workspaceId }),
    );

    expect(report.failed).toEqual([
      {
        ruleId: "rule-broken",
        scheduledFor: "2026-08-15",
        code: "duplicateId",
      },
    ]);
    expect(report.generated.map((entry) => entry.ruleId)).toEqual([
      "rule-healthy",
    ]);
    expect(readRule(fixture.connection, "rule-broken")).toEqual({
      nextDueDate: "2026-08-15",
      deactivatedAt: null,
    });
    expect(readRule(fixture.connection, "rule-healthy")).toEqual({
      nextDueDate: "2026-09-20",
      deactivatedAt: null,
    });
  });
});

describe("workspace isolation", () => {
  it("generates nothing for a workspace this file does not own", () => {
    const fixture = openedFixture();
    const category = storeCategory(fixture, "Alquiler", "expense");
    storeRule(fixture, {
      id: "rule-1",
      category,
      monthlyDay: 31,
      nextDueDate: "2026-08-31",
    });

    const report = okValue(
      createGenerator(fixture.connection, { today: TODAY }).execute({
        workspaceId: "another-workspace",
      }),
    );

    expect(report).toEqual({ generated: [], skipped: [], failed: [] });
    expect(readTransactions(fixture.connection)).toEqual([]);
    expect(readOccurrences(fixture.connection)).toEqual([]);
    expect(readRule(fixture.connection, "rule-1")).toEqual({
      nextDueDate: "2026-08-31",
      deactivatedAt: null,
    });
  });
});
