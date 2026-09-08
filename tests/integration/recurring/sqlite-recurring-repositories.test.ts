/**
 * Recurrence repositories against a real, migrated SQLite file.
 *
 * These cases check the round trip of a rule and of a reserved due date, the
 * workspace scope of every statement, the unique index that decides whether a
 * date was already processed, the conditional advance of the next date and the
 * complete rollback of a refused write. Nothing here stubs the driver or the
 * constraints of the schema.
 */

import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { sqliteRecurringOccurrenceRepository } from "../../../src/modules/recurring/infrastructure/sqlite-recurring-occurrence-repository";
import { sqliteRecurringRuleRepository } from "../../../src/modules/recurring/infrastructure/sqlite-recurring-rule-repository";
import {
  autocommitUnitOfWork,
  runInTransaction,
  type SqliteUnitOfWork,
} from "../../../src/modules/recurring/infrastructure/sqlite-unit-of-work";
import { createRecurringOccurrence } from "../../../src/modules/recurring/domain/recurring-occurrence";
import type {
  RecurringRule,
  RecurringRuleId,
} from "../../../src/modules/recurring/domain/recurring-rule";
import {
  deactivateRecurringRule,
  editRecurringRule,
} from "../../../src/modules/recurring/domain/recurring-rule";
import type { Category } from "../../../src/modules/classification/domain/category";
import { sqliteTransactionRepository } from "../../../src/modules/transactions/infrastructure/sqlite-transaction-repository";
import { runInTransaction as runTransactionWrite } from "../../../src/modules/transactions/infrastructure/sqlite-unit-of-work";
import type { LocalDate } from "../../../src/shared/domain/dates";
import type { Timestamp } from "../../../src/shared/domain/timestamp";
import {
  countStatements,
  newTransaction,
  storeCategory,
  storeTag,
} from "../transactions/helpers";
import {
  NOW,
  createRecurringFixture,
  errorCode,
  newRule,
  okValue,
  openWriter,
  type RecurringFixture,
} from "./helpers";

const MISSING_WORKSPACE = "missing-workspace";
const TODAY = "2026-09-08" as LocalDate;

function day(value: string): LocalDate {
  return value as LocalDate;
}

function stamp(value: number): Timestamp {
  return value as Timestamp;
}

function ruleId(value: string): RecurringRuleId {
  return value as RecurringRuleId;
}

let fixture: RecurringFixture;
let unit: SqliteUnitOfWork;
let workspaceId: string;
let writers: ReturnType<typeof openWriter>[];

beforeEach(() => {
  fixture = createRecurringFixture();
  unit = autocommitUnitOfWork(fixture.connection);
  workspaceId = fixture.workspaceId;
  writers = [];
});

afterEach(() => {
  while (writers.length > 0) {
    writers.pop()?.close();
  }

  fixture.cleanup();
});

function saveRule(rule: RecurringRule, scope = workspaceId) {
  return runInTransaction(fixture.connection, (transactional) =>
    sqliteRecurringRuleRepository.insertRule(transactional, {
      workspaceId: scope,
      rule,
    }),
  );
}

function saveMovement(category: Category, date: string) {
  const stored = runTransactionWrite(fixture.connection, (transactional) =>
    sqliteTransactionRepository.insertTransaction(transactional, {
      workspaceId,
      transaction: newTransaction({ category, date }),
    }),
  );

  if (!stored.ok) {
    throw new Error(`Expected a stored movement: ${JSON.stringify(stored)}`);
  }

  return stored.value;
}

function occurrence(values: {
  readonly id?: string;
  readonly recurringRuleId: string;
  readonly scheduledFor: string;
  readonly transactionId?: string | null;
}) {
  const built = createRecurringOccurrence({
    id: values.id ?? randomUUID(),
    recurringRuleId: values.recurringRuleId,
    scheduledFor: values.scheduledFor,
    transactionId: values.transactionId ?? null,
    createdAt: NOW,
  });

  if (!built.ok) {
    throw new Error(`Expected a valid occurrence: ${JSON.stringify(built)}`);
  }

  return built.value;
}

describe("round trip of a stored rule", () => {
  it("reads back the template, tags and category of an inserted rule", () => {
    const category = storeCategory(fixture, "Suscripciones", "expense");
    const tags = [storeTag(fixture, "Casa"), storeTag(fixture, "Ocio")];
    const rule = newRule({
      category,
      amountMinor: 1_299,
      concept: "Suscripción mensual",
      note: "Se cobra el último día",
      tagIds: tags.map((tag) => tag.id),
      monthlyDay: 31,
      nextDueDate: "2026-08-31",
    });

    expect(okValue(saveRule(rule))).toEqual(rule);

    const due = okValue(
      sqliteRecurringRuleRepository.findDueRules(unit, {
        workspaceId,
        onOrBefore: TODAY,
      }),
    );

    expect(due).toHaveLength(1);
    expect(due[0]?.category).toEqual(category);
    expect(due[0]?.rule).toEqual({
      ...rule,
      template: {
        ...rule.template,
        tagIds: [...rule.template.tagIds].sort(),
      },
    });
    const stored = okValue(
      sqliteRecurringRuleRepository.findRuleForUpdate(unit, {
        workspaceId,
        ruleId: rule.id,
      }),
    );

    expect(stored?.category).toEqual(category);
    expect(stored?.rule.template.tagIds).toEqual(
      [...rule.template.tagIds].sort(),
    );
    expect(stored?.rule.template.concept).toBe("Suscripción mensual");
    expect(stored?.rule.template.note).toBe("Se cobra el último día");
    expect(stored?.rule.template.amountMinor).toBe(1_299);
  });

  it("loads the template tags of several rules in a constant number of statements", () => {
    const category = storeCategory(fixture, "Alquiler", "expense");
    const tag = storeTag(fixture, "Casa");
    okValue(
      saveRule(
        newRule({
          id: "rule-a",
          category,
          tagIds: [tag.id],
          nextDueDate: "2026-07-31",
        }),
      ),
    );
    okValue(
      saveRule(
        newRule({
          id: "rule-b",
          category,
          tagIds: [tag.id],
          nextDueDate: "2026-08-31",
        }),
      ),
    );

    const counted = countStatements(fixture, () =>
      sqliteRecurringRuleRepository.findDueRules(unit, {
        workspaceId,
        onOrBefore: TODAY,
      }),
    );

    expect(okValue(counted.value)).toHaveLength(2);
    expect(counted.statements).toBe(2);
  });

  it("lists owed rules by next date and identifier and ignores the rest", () => {
    const category = storeCategory(fixture, "Alquiler", "expense");
    okValue(
      saveRule(
        newRule({
          id: "rule-later",
          category,
          nextDueDate: "2026-08-31",
        }),
      ),
    );
    okValue(
      saveRule(
        newRule({
          id: "rule-earlier",
          category,
          nextDueDate: "2026-07-31",
        }),
      ),
    );
    okValue(
      saveRule(
        newRule({
          id: "rule-future",
          category,
          nextDueDate: "2026-09-30",
        }),
      ),
    );
    okValue(
      saveRule(
        newRule({
          id: "rule-stopped",
          category,
          nextDueDate: "2026-05-31",
          deactivatedAt: NOW,
        }),
      ),
    );

    const due = okValue(
      sqliteRecurringRuleRepository.findDueRules(unit, {
        workspaceId,
        onOrBefore: TODAY,
      }),
    );

    expect(due.map((row) => row.rule.id)).toEqual([
      "rule-earlier",
      "rule-later",
    ]);
    expect(
      okValue(
        sqliteRecurringRuleRepository.findDueRules(unit, {
          workspaceId: MISSING_WORKSPACE,
          onOrBefore: TODAY,
        }),
      ),
    ).toEqual([]);
    expect(
      okValue(
        sqliteRecurringRuleRepository.findRuleForUpdate(unit, {
          workspaceId: MISSING_WORKSPACE,
          ruleId: ruleId("rule-earlier"),
        }),
      ),
    ).toBeNull();
  });
});

describe("active listing, replacement and deactivation", () => {
  it("lists only active rules and finds the one of an origin movement", () => {
    const rent = storeCategory(fixture, "Alquiler", "expense");
    const salary = storeCategory(fixture, "Sueldo", "income");
    const home = storeTag(fixture, "Casa");
    const origin = saveMovement(rent, TODAY);
    okValue(
      saveRule(
        newRule({
          id: "rule-expense",
          sourceTransactionId: origin.id,
          category: rent,
          tagIds: [home.id],
          nextDueDate: "2026-10-08",
        }),
      ),
    );
    okValue(
      saveRule(
        newRule({
          id: "rule-income",
          category: salary,
          amountMinor: 250_000,
          monthlyDay: 1,
          nextDueDate: "2026-10-01",
        }),
      ),
    );
    okValue(
      saveRule(
        newRule({
          id: "rule-stopped",
          category: rent,
          monthlyDay: 15,
          nextDueDate: "2026-05-15",
          deactivatedAt: NOW,
        }),
      ),
    );

    expect(
      okValue(
        sqliteRecurringRuleRepository.findActiveRules(unit, { workspaceId }),
      ).map((row) => row.rule.id),
    ).toEqual(["rule-expense", "rule-income"]);
    expect(
      okValue(
        sqliteRecurringRuleRepository.findActiveRuleBySource(unit, {
          workspaceId,
          sourceTransactionId: origin.id,
        }),
      )?.rule.id,
    ).toBe("rule-expense");
    expect(
      okValue(
        sqliteRecurringRuleRepository.findActiveRuleBySource(unit, {
          workspaceId,
          sourceTransactionId: saveMovement(rent, "2026-01-15").id,
        }),
      ),
    ).toBeNull();
    expect(
      okValue(
        sqliteRecurringRuleRepository.findActiveRuleByCategory(unit, {
          workspaceId,
          categoryId: salary.id,
        }),
      )?.rule.id,
    ).toBe("rule-income");
    expect(
      okValue(
        sqliteRecurringRuleRepository.findActiveRuleByCategory(unit, {
          workspaceId,
          categoryId: storeCategory(fixture, "Ocio", "expense").id,
        }),
      ),
    ).toBeNull();
    expect(
      okValue(
        sqliteRecurringRuleRepository.findActiveRuleByTag(unit, {
          workspaceId,
          tagId: home.id,
        }),
      )?.rule.id,
    ).toBe("rule-expense");
    expect(
      okValue(
        sqliteRecurringRuleRepository.findActiveRuleByTag(unit, {
          workspaceId,
          tagId: storeTag(fixture, "Vacaciones").id,
        }),
      ),
    ).toBeNull();
  });

  it("replaces an active template only while the version still matches", () => {
    const category = storeCategory(fixture, "Alquiler", "expense");
    const stored = okValue(
      saveRule(
        newRule({
          id: "rule-1",
          category,
          amountMinor: 85_000,
          concept: "Alquiler",
          nextDueDate: "2026-10-08",
        }),
      ),
    );
    const edited = editRecurringRule(stored, {
      type: "expense",
      amountMinor: 90_000,
      category,
      concept: "Alquiler actualizado",
      note: null,
      tagIds: [],
      monthlyDay: 15,
      nextDueDate: "2026-09-15",
      updatedAt: NOW + 1,
    });

    if (!edited.ok) {
      throw new Error(`Expected an edited rule: ${JSON.stringify(edited)}`);
    }

    expect(
      errorCode(
        runInTransaction(fixture.connection, (transactional) =>
          sqliteRecurringRuleRepository.replaceActiveRule(transactional, {
            workspaceId,
            expectedTemplateVersion: 99,
            rule: edited.value,
          }),
        ),
      ),
    ).toBe("staleTemplateVersion");

    const replaced = okValue(
      runInTransaction(fixture.connection, (transactional) =>
        sqliteRecurringRuleRepository.replaceActiveRule(transactional, {
          workspaceId,
          expectedTemplateVersion: 1,
          rule: edited.value,
        }),
      ),
    );

    expect(replaced.template.amountMinor).toBe(90_000);
    expect(replaced.templateVersion).toBe(2);
    expect(
      errorCode(
        sqliteRecurringRuleRepository.replaceActiveRule(unit, {
          workspaceId,
          expectedTemplateVersion: 1,
          rule: edited.value,
        }),
      ),
    ).toBe("transactionRequired");
  });

  it("stops an active rule once and refuses a second stop", () => {
    const category = storeCategory(fixture, "Alquiler", "expense");
    okValue(
      saveRule(
        newRule({
          id: "rule-1",
          category,
          nextDueDate: "2026-10-08",
        }),
      ),
    );

    const stopped = okValue(
      runInTransaction(fixture.connection, (transactional) =>
        sqliteRecurringRuleRepository.deactivateRule(transactional, {
          workspaceId,
          ruleId: ruleId("rule-1"),
          expectedTemplateVersion: 1,
          deactivatedAt: stamp(NOW),
        }),
      ),
    );

    expect(stopped.deactivatedAt).toBe(NOW);
    expect(
      errorCode(
        runInTransaction(fixture.connection, (transactional) =>
          sqliteRecurringRuleRepository.deactivateRule(transactional, {
            workspaceId,
            ruleId: ruleId("rule-1"),
            expectedTemplateVersion: 1,
            deactivatedAt: stamp(NOW + 1),
          }),
        ),
      ),
    ).toBe("alreadyDeactivated");
    expect(
      errorCode(
        runInTransaction(fixture.connection, (transactional) =>
          sqliteRecurringRuleRepository.deactivateRule(transactional, {
            workspaceId,
            ruleId: ruleId("missing-rule"),
            expectedTemplateVersion: 1,
            deactivatedAt: stamp(NOW),
          }),
        ),
      ),
    ).toBe("ruleNotFound");
    expect(deactivateRecurringRule(stopped, NOW).ok).toBe(false);
  });
});

describe("inserting a rule", () => {
  it("refuses a write that cannot roll back its tag associations", () => {
    const category = storeCategory(fixture, "Alquiler", "expense");

    expect(
      errorCode(
        sqliteRecurringRuleRepository.insertRule(unit, {
          workspaceId,
          rule: newRule({ category, nextDueDate: "2026-08-31" }),
        }),
      ),
    ).toBe("transactionRequired");
  });

  it("refuses a duplicate identifier, an unknown category and an unknown tag", () => {
    const category = storeCategory(fixture, "Alquiler", "expense");
    const rule = newRule({
      id: "rule-1",
      category,
      nextDueDate: "2026-08-31",
    });
    okValue(saveRule(rule));

    expect(errorCode(saveRule(rule))).toBe("duplicateId");
    expect(
      errorCode(
        saveRule(
          newRule({
            category: {
              ...category,
              id: randomUUID() as typeof category.id,
            },
            nextDueDate: "2026-08-31",
          }),
        ),
      ),
    ).toBe("unknownCategory");
    expect(
      errorCode(
        saveRule(
          newRule({
            category,
            tagIds: [randomUUID()],
            nextDueDate: "2026-08-31",
          }),
        ),
      ),
    ).toBe("unknownTag");
    expect(
      errorCode(
        saveRule(
          newRule({ category, nextDueDate: "2026-08-31" }),
          MISSING_WORKSPACE,
        ),
      ),
    ).toBe("unknownWorkspace");
  });
});

describe("advancing the next date", () => {
  it("moves the date only while the rule is active and still on that day", () => {
    const category = storeCategory(fixture, "Alquiler", "expense");
    const rule = okValue(
      saveRule(newRule({ category, nextDueDate: "2026-08-31" })),
    );

    expect(
      okValue(
        sqliteRecurringRuleRepository.advanceNextDueDate(unit, {
          workspaceId,
          ruleId: rule.id,
          from: day("2026-08-31"),
          to: day("2026-09-30"),
          updatedAt: stamp(NOW),
        }),
      ),
    ).toBe("2026-09-30");
    expect(
      errorCode(
        sqliteRecurringRuleRepository.advanceNextDueDate(unit, {
          workspaceId,
          ruleId: rule.id,
          from: day("2026-08-31"),
          to: day("2026-10-31"),
          updatedAt: stamp(NOW),
        }),
      ),
    ).toBe("staleNextDueDate");

    fixture.connection.sqlite
      .prepare("UPDATE recurring_rule SET deactivated_at = ? WHERE id = ?")
      .run(NOW, rule.id);

    expect(
      errorCode(
        sqliteRecurringRuleRepository.advanceNextDueDate(unit, {
          workspaceId,
          ruleId: rule.id,
          from: day("2026-09-30"),
          to: day("2026-10-31"),
          updatedAt: stamp(NOW),
        }),
      ),
    ).toBe("staleNextDueDate");
  });

  it("changes nothing when another writer holds the write lock", () => {
    const category = storeCategory(fixture, "Alquiler", "expense");
    const rule = okValue(
      saveRule(newRule({ category, nextDueDate: "2026-08-31" })),
    );
    const writer = openWriter(fixture);
    writers.push(writer);
    fixture.connection.sqlite.pragma("busy_timeout = 50");
    writer.sqlite.exec("BEGIN IMMEDIATE");

    const result = sqliteRecurringRuleRepository.advanceNextDueDate(unit, {
      workspaceId,
      ruleId: rule.id,
      from: day("2026-08-31"),
      to: day("2026-09-30"),
      updatedAt: stamp(NOW),
    });

    writer.sqlite.exec("ROLLBACK");

    expect(errorCode(result)).toBe("storageFailure");
    expect(
      fixture.connection.sqlite
        .prepare("SELECT next_due_date AS nextDueDate FROM recurring_rule")
        .get() as { nextDueDate: string },
    ).toEqual({ nextDueDate: "2026-08-31" });
  });
});

describe("reserving a due date", () => {
  it("inserts the reservation and links the movement that materialised it", () => {
    const category = storeCategory(fixture, "Alquiler", "expense");
    const rule = okValue(
      saveRule(newRule({ category, nextDueDate: "2026-08-31" })),
    );
    const movement = saveMovement(category, "2026-08-31");
    const reserved = occurrence({
      recurringRuleId: rule.id,
      scheduledFor: "2026-08-31",
    });

    expect(
      okValue(
        sqliteRecurringOccurrenceRepository.reserveOccurrence(unit, {
          workspaceId,
          occurrence: reserved,
        }),
      ),
    ).toEqual(reserved);

    const linked = okValue(
      sqliteRecurringOccurrenceRepository.linkGeneratedTransaction(unit, {
        workspaceId,
        occurrenceId: reserved.id,
        transactionId: movement.id,
      }),
    );

    expect(linked.transactionId).toBe(movement.id);
  });

  it("refuses a second reservation of the same rule and day", () => {
    const category = storeCategory(fixture, "Alquiler", "expense");
    const rule = okValue(
      saveRule(newRule({ category, nextDueDate: "2026-08-31" })),
    );
    const first = occurrence({
      recurringRuleId: rule.id,
      scheduledFor: "2026-08-31",
    });
    okValue(
      sqliteRecurringOccurrenceRepository.reserveOccurrence(unit, {
        workspaceId,
        occurrence: first,
      }),
    );

    expect(
      errorCode(
        sqliteRecurringOccurrenceRepository.reserveOccurrence(unit, {
          workspaceId,
          occurrence: occurrence({
            recurringRuleId: rule.id,
            scheduledFor: "2026-08-31",
          }),
        }),
      ),
    ).toBe("alreadyProcessed");
  });

  it("lets a second connection lose the unique reservation", () => {
    const category = storeCategory(fixture, "Alquiler", "expense");
    const rule = okValue(
      saveRule(newRule({ category, nextDueDate: "2026-08-31" })),
    );
    const writer = openWriter(fixture);
    writers.push(writer);

    okValue(
      sqliteRecurringOccurrenceRepository.reserveOccurrence(unit, {
        workspaceId,
        occurrence: occurrence({
          recurringRuleId: rule.id,
          scheduledFor: "2026-08-31",
        }),
      }),
    );

    expect(
      errorCode(
        sqliteRecurringOccurrenceRepository.reserveOccurrence(
          autocommitUnitOfWork(writer),
          {
            workspaceId,
            occurrence: occurrence({
              recurringRuleId: rule.id,
              scheduledFor: "2026-08-31",
            }),
          },
        ),
      ),
    ).toBe("alreadyProcessed");
  });

  it("refuses an unknown rule, workspace, occurrence and movement", () => {
    const category = storeCategory(fixture, "Alquiler", "expense");
    const rule = okValue(
      saveRule(newRule({ category, nextDueDate: "2026-08-31" })),
    );

    expect(
      errorCode(
        sqliteRecurringOccurrenceRepository.reserveOccurrence(unit, {
          workspaceId,
          occurrence: occurrence({
            recurringRuleId: randomUUID(),
            scheduledFor: "2026-08-31",
          }),
        }),
      ),
    ).toBe("ruleNotFound");
    expect(
      errorCode(
        sqliteRecurringOccurrenceRepository.reserveOccurrence(unit, {
          workspaceId: MISSING_WORKSPACE,
          occurrence: occurrence({
            recurringRuleId: rule.id,
            scheduledFor: "2026-08-31",
          }),
        }),
      ),
    ).toBe("unknownWorkspace");
    expect(
      errorCode(
        sqliteRecurringOccurrenceRepository.linkGeneratedTransaction(unit, {
          workspaceId,
          occurrenceId: randomUUID() as never,
          transactionId: randomUUID() as never,
        }),
      ),
    ).toBe("occurrenceNotFound");

    const reserved = occurrence({
      recurringRuleId: rule.id,
      scheduledFor: "2026-08-31",
    });
    okValue(
      sqliteRecurringOccurrenceRepository.reserveOccurrence(unit, {
        workspaceId,
        occurrence: reserved,
      }),
    );
    expect(
      errorCode(
        sqliteRecurringOccurrenceRepository.linkGeneratedTransaction(unit, {
          workspaceId,
          occurrenceId: reserved.id,
          transactionId: randomUUID() as never,
        }),
      ),
    ).toBe("unknownTransaction");
  });

  it("refuses to link the same movement to two reserved dates", () => {
    const category = storeCategory(fixture, "Alquiler", "expense");
    const rule = okValue(
      saveRule(newRule({ category, nextDueDate: "2026-07-31" })),
    );
    const movement = saveMovement(category, "2026-07-31");
    const first = occurrence({
      recurringRuleId: rule.id,
      scheduledFor: "2026-07-31",
    });
    const second = occurrence({
      recurringRuleId: rule.id,
      scheduledFor: "2026-08-31",
    });
    okValue(
      sqliteRecurringOccurrenceRepository.reserveOccurrence(unit, {
        workspaceId,
        occurrence: first,
      }),
    );
    okValue(
      sqliteRecurringOccurrenceRepository.reserveOccurrence(unit, {
        workspaceId,
        occurrence: second,
      }),
    );
    okValue(
      sqliteRecurringOccurrenceRepository.linkGeneratedTransaction(unit, {
        workspaceId,
        occurrenceId: first.id,
        transactionId: movement.id,
      }),
    );

    expect(
      errorCode(
        sqliteRecurringOccurrenceRepository.linkGeneratedTransaction(unit, {
          workspaceId,
          occurrenceId: second.id,
          transactionId: movement.id,
        }),
      ),
    ).toBe("alreadyProcessed");
  });

  it("clears the movement link and leaves the processed date in place", () => {
    const category = storeCategory(fixture, "Alquiler", "expense");
    const rule = okValue(
      saveRule(newRule({ category, nextDueDate: "2026-07-31" })),
    );
    const movement = saveMovement(category, "2026-07-31");
    const reserved = occurrence({
      recurringRuleId: rule.id,
      scheduledFor: "2026-07-31",
    });
    okValue(
      sqliteRecurringOccurrenceRepository.reserveOccurrence(unit, {
        workspaceId,
        occurrence: reserved,
      }),
    );
    okValue(
      sqliteRecurringOccurrenceRepository.linkGeneratedTransaction(unit, {
        workspaceId,
        occurrenceId: reserved.id,
        transactionId: movement.id,
      }),
    );

    const tombstone = okValue(
      sqliteRecurringOccurrenceRepository.clearGeneratedTransaction(unit, {
        workspaceId,
        transactionId: movement.id,
      }),
    );

    expect(tombstone).toMatchObject({
      id: reserved.id,
      transactionId: null,
      scheduledFor: "2026-07-31",
    });
    expect(
      okValue(
        sqliteRecurringOccurrenceRepository.clearGeneratedTransaction(unit, {
          workspaceId,
          transactionId: movement.id,
        }),
      ),
    ).toBeNull();
    expect(
      errorCode(
        sqliteRecurringOccurrenceRepository.reserveOccurrence(unit, {
          workspaceId,
          occurrence: occurrence({
            recurringRuleId: rule.id,
            scheduledFor: "2026-07-31",
          }),
        }),
      ),
    ).toBe("alreadyProcessed");
  });
});

describe("unreadable stored rows", () => {
  it("reports a stored rule the domain contract would reject", () => {
    const category = storeCategory(fixture, "Alquiler", "expense");
    const rule = okValue(
      saveRule(newRule({ category, nextDueDate: "2026-08-31" })),
    );
    fixture.connection.sqlite
      .prepare("UPDATE recurring_rule SET concept = ? WHERE id = ?")
      .run("\t", rule.id);

    expect(
      sqliteRecurringRuleRepository.findDueRules(unit, {
        workspaceId,
        onOrBefore: TODAY,
      }),
    ).toEqual({
      ok: false,
      error: { code: "invalidStoredRow", cause: "concept:invalidCharacter" },
    });
  });

  it("reports a rule whose joined category no longer satisfies the domain", () => {
    const category = storeCategory(fixture, "Alquiler", "expense");
    const rule = okValue(
      saveRule(newRule({ category, nextDueDate: "2026-08-31" })),
    );
    const tooLongName = "a".repeat(81);
    fixture.connection.sqlite
      .prepare("UPDATE category SET name = ?, normalized_name = ? WHERE id = ?")
      .run(tooLongName, tooLongName, category.id);

    expect(
      sqliteRecurringRuleRepository.findRuleForUpdate(unit, {
        workspaceId,
        ruleId: rule.id,
      }),
    ).toEqual({
      ok: false,
      error: { code: "invalidStoredRow", cause: "category.name:tooLong" },
    });
  });

  it("reports an occurrence the domain contract would reject", () => {
    const category = storeCategory(fixture, "Alquiler", "expense");
    const rule = okValue(
      saveRule(newRule({ category, nextDueDate: "2026-08-31" })),
    );
    const reserved = occurrence({
      recurringRuleId: rule.id,
      scheduledFor: "2026-08-31",
    });
    okValue(
      sqliteRecurringOccurrenceRepository.reserveOccurrence(unit, {
        workspaceId,
        occurrence: reserved,
      }),
    );
    fixture.connection.sqlite
      .prepare("UPDATE recurring_occurrence SET created_at = ? WHERE id = ?")
      .run(-1, reserved.id);

    const movement = saveMovement(category, "2026-08-31");

    expect(
      sqliteRecurringOccurrenceRepository.linkGeneratedTransaction(unit, {
        workspaceId,
        occurrenceId: reserved.id,
        transactionId: movement.id,
      }),
    ).toEqual({
      ok: false,
      error: { code: "invalidStoredRow", cause: "createdAt:invalidTimestamp" },
    });
  });
});

describe("storage failures", () => {
  it("reports a controlled failure when the connection is closed", () => {
    const category = storeCategory(fixture, "Alquiler", "expense");
    const rule = newRule({ category, nextDueDate: "2026-08-31" });
    fixture.connection.close();

    expect(
      errorCode(
        sqliteRecurringRuleRepository.findDueRules(unit, {
          workspaceId,
          onOrBefore: TODAY,
        }),
      ),
    ).toBe("storageFailure");
    expect(
      errorCode(
        sqliteRecurringRuleRepository.findRuleForUpdate(unit, {
          workspaceId,
          ruleId: rule.id,
        }),
      ),
    ).toBe("storageFailure");
    expect(
      errorCode(
        sqliteRecurringRuleRepository.advanceNextDueDate(unit, {
          workspaceId,
          ruleId: rule.id,
          from: day("2026-08-31"),
          to: day("2026-09-30"),
          updatedAt: stamp(NOW),
        }),
      ),
    ).toBe("storageFailure");
    expect(
      errorCode(
        sqliteRecurringOccurrenceRepository.reserveOccurrence(unit, {
          workspaceId,
          occurrence: occurrence({
            recurringRuleId: rule.id,
            scheduledFor: "2026-08-31",
          }),
        }),
      ),
    ).toBe("storageFailure");
    expect(
      errorCode(
        sqliteRecurringOccurrenceRepository.linkGeneratedTransaction(unit, {
          workspaceId,
          occurrenceId: "occ-1" as never,
          transactionId: "tx-1" as never,
        }),
      ),
    ).toBe("storageFailure");
    expect(
      errorCode(
        runInTransaction(fixture.connection, (transactional) =>
          sqliteRecurringRuleRepository.insertRule(transactional, {
            workspaceId,
            rule,
          }),
        ),
      ),
    ).toBe("storageFailure");
  });

  it("treats a reused occurrence identifier as already processed", () => {
    const category = storeCategory(fixture, "Alquiler", "expense");
    const rule = okValue(
      saveRule(newRule({ category, nextDueDate: "2026-07-31" })),
    );
    const first = occurrence({
      id: "occ-1",
      recurringRuleId: rule.id,
      scheduledFor: "2026-07-31",
    });
    okValue(
      sqliteRecurringOccurrenceRepository.reserveOccurrence(unit, {
        workspaceId,
        occurrence: first,
      }),
    );

    expect(
      errorCode(
        sqliteRecurringOccurrenceRepository.reserveOccurrence(unit, {
          workspaceId,
          occurrence: occurrence({
            id: "occ-1",
            recurringRuleId: rule.id,
            scheduledFor: "2026-08-31",
          }),
        }),
      ),
    ).toBe("alreadyProcessed");
  });

  it("rolls a refused due-date transaction back completely", () => {
    const category = storeCategory(fixture, "Alquiler", "expense");
    const rule = okValue(
      saveRule(newRule({ category, nextDueDate: "2026-08-31" })),
    );

    const result = runInTransaction(fixture.connection, (transactional) => {
      okValue(
        sqliteRecurringOccurrenceRepository.reserveOccurrence(transactional, {
          workspaceId,
          occurrence: occurrence({
            recurringRuleId: rule.id,
            scheduledFor: "2026-08-31",
          }),
        }),
      );

      return sqliteRecurringRuleRepository.advanceNextDueDate(transactional, {
        workspaceId,
        ruleId: rule.id,
        from: day("2026-07-31"),
        to: day("2026-09-30"),
        updatedAt: stamp(NOW),
      });
    });

    expect(errorCode(result)).toBe("staleNextDueDate");
    expect(
      fixture.connection.sqlite
        .prepare("SELECT count(*) AS count FROM recurring_occurrence")
        .get() as { count: number },
    ).toEqual({ count: 0 });
    expect(
      fixture.connection.sqlite
        .prepare("SELECT next_due_date AS nextDueDate FROM recurring_rule")
        .get() as { nextDueDate: string },
    ).toEqual({ nextDueDate: "2026-08-31" });
  });

  it("reports an unexpected throw as a storage failure and rolls back", () => {
    const category = storeCategory(fixture, "Alquiler", "expense");
    const rule = okValue(
      saveRule(newRule({ category, nextDueDate: "2026-08-31" })),
    );

    const result = runInTransaction(fixture.connection, (transactional) => {
      okValue(
        sqliteRecurringOccurrenceRepository.reserveOccurrence(transactional, {
          workspaceId,
          occurrence: occurrence({
            recurringRuleId: rule.id,
            scheduledFor: "2026-08-31",
          }),
        }),
      );
      throw new Error("boom");
    });

    expect(errorCode(result)).toBe("storageFailure");
    expect(
      fixture.connection.sqlite
        .prepare("SELECT count(*) AS count FROM recurring_occurrence")
        .get() as { count: number },
    ).toEqual({ count: 0 });
  });

  it("reports a schema check that is not a uniqueness or foreign-key verdict", () => {
    const category = storeCategory(fixture, "Alquiler", "expense");
    const rule = newRule({ category, nextDueDate: "2026-08-31" });
    const invalidAmount = {
      ...rule,
      template: { ...rule.template, amountMinor: 0 },
    };

    expect(errorCode(saveRule(invalidAmount as RecurringRule))).toBe(
      "storageFailure",
    );
  });

  it("reports that template tags cannot be read after the association table is gone", () => {
    const category = storeCategory(fixture, "Alquiler", "expense");
    const tag = storeTag(fixture, "Casa");
    okValue(
      saveRule(
        newRule({
          category,
          tagIds: [tag.id],
          nextDueDate: "2026-08-31",
        }),
      ),
    );
    fixture.connection.sqlite.exec("DROP TABLE recurring_rule_tag");

    expect(
      errorCode(
        sqliteRecurringRuleRepository.findDueRules(unit, {
          workspaceId,
          onOrBefore: TODAY,
        }),
      ),
    ).toBe("storageFailure");
  });

  it("reports a storage failure when a foreign-key lookup cannot read workspaces", () => {
    const category = storeCategory(fixture, "Alquiler", "expense");
    const rule = newRule({ category, nextDueDate: "2026-08-31" });
    fixture.connection.sqlite.pragma("foreign_keys = OFF");
    fixture.connection.sqlite.exec("DROP TABLE workspace");
    fixture.connection.sqlite.pragma("foreign_keys = ON");

    expect(errorCode(saveRule(rule))).toBe("storageFailure");
    expect(
      errorCode(
        sqliteRecurringOccurrenceRepository.reserveOccurrence(unit, {
          workspaceId,
          occurrence: occurrence({
            recurringRuleId: rule.id,
            scheduledFor: "2026-08-31",
          }),
        }),
      ),
    ).toBe("storageFailure");
  });

  it("reports a non-error throw as a storage failure", () => {
    const result = runInTransaction(fixture.connection, () => {
      throw "boom";
    });

    expect(errorCode(result)).toEqual("storageFailure");
    expect(result).toEqual({
      ok: false,
      error: { code: "storageFailure", cause: "boom" },
    });
  });
});
