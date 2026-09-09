import { describe, expect, it } from "vitest";

import type { Category } from "../../classification/domain/category";
import { createCategory } from "../../classification/domain/category";
import { FixedClock } from "../../../shared/domain/clock";
import type { LocalDate } from "../../../shared/domain/dates";
import type { TransactionRepository } from "../../transactions/application/ports/transaction-repository";
import {
  failed as transactionFailed,
  succeeded as transactionSucceeded,
} from "../../transactions/application/ports/transaction-repository";
import type { Transaction } from "../../transactions/domain/transaction";
import {
  type GenerateDueOccurrencesDeps,
  catchUpDueDatesInUnit,
  createGenerateDueOccurrences,
} from "./generate-due-occurrences";
import type { DueDateRunner } from "./ports/due-date-runner";
import type {
  RecurringOccurrenceRepository,
  RecurringRepositoryErrorCode,
  RecurringRuleRepository,
  StoredRecurringRule,
} from "./ports/recurring-repository";
import { failed, succeeded } from "./ports/recurring-repository";
import type { UnitOfWork } from "./ports/unit-of-work";
import { createRecurringOccurrence } from "../domain/recurring-occurrence";
import { createRecurringRule } from "../domain/recurring-rule";

const TODAY = "2026-09-08" as LocalDate;
const NOW = 1_746_268_800_000;
const WORKSPACE_ID = "workspace-personal";

function unused(): never {
  throw new Error("Unexpected repository method");
}

function expenseCategory(): Category {
  const built = createCategory({
    id: "category-expense",
    name: "Alquiler",
    type: "expense",
    sortOrder: 0,
    archivedAt: null,
  });

  if (!built.ok) {
    throw new Error(`Expected a valid category: ${JSON.stringify(built)}`);
  }

  return built.value;
}

function storedRule(
  overrides: {
    readonly id?: string;
    readonly nextDueDate?: string;
    readonly monthlyDay?: number;
    readonly deactivatedAt?: number | null;
    readonly amountMinor?: number;
    readonly concept?: string | null;
    readonly note?: string | null;
    readonly tagIds?: readonly string[];
    readonly category?: Category;
  } = {},
): StoredRecurringRule {
  const category = overrides.category ?? expenseCategory();
  const built = createRecurringRule({
    id: overrides.id ?? "rule-1",
    sourceTransactionId: null,
    type: category.type,
    amountMinor: overrides.amountMinor ?? 1_299,
    category,
    concept: overrides.concept ?? null,
    note: overrides.note ?? null,
    tagIds: overrides.tagIds ?? [],
    monthlyDay: overrides.monthlyDay ?? 31,
    nextDueDate: overrides.nextDueDate ?? "2026-08-31",
    templateVersion: 1,
    deactivatedAt: overrides.deactivatedAt ?? null,
    createdAt: NOW,
    updatedAt: NOW,
  });

  if (!built.ok) {
    throw new Error(`Expected a valid rule: ${JSON.stringify(built)}`);
  }

  return { rule: built.value, category };
}

function rules(
  overrides: Partial<RecurringRuleRepository> = {},
): RecurringRuleRepository {
  return {
    findDueRules: unused,
    findActiveRules: unused,
    findActiveRuleBySource: unused,
    findActiveRuleByCategory: unused,
    findActiveRuleByTag: unused,
    findRuleForUpdate: unused,
    insertRule: unused,
    replaceActiveRule: unused,
    deactivateRule: unused,
    advanceNextDueDate: unused,
    ...overrides,
  };
}

function occurrences(
  overrides: Partial<RecurringOccurrenceRepository> = {},
): RecurringOccurrenceRepository {
  return {
    reserveOccurrence: unused,
    linkGeneratedTransaction: unused,
    clearGeneratedTransaction: unused,
    ...overrides,
  };
}

function transactions(
  overrides: Partial<TransactionRepository> = {},
): TransactionRepository {
  return {
    findTransactionById: unused,
    findTransactionsByIds: unused,
    insertTransaction: unused,
    updateTransaction: unused,
    deleteTransaction: unused,
    ...overrides,
  };
}

function runner(transactionalUnit = true): DueDateRunner {
  return {
    runForDueDate(work) {
      return work({ isTransactional: transactionalUnit });
    },
  };
}

function sequentialIds(prefix: string): () => string {
  let next = 0;

  return () => {
    next += 1;
    return `${prefix}-${String(next)}`;
  };
}

function service(
  overrides: Partial<GenerateDueOccurrencesDeps<UnitOfWork>> & {
    readonly due?: readonly StoredRecurringRule[];
  } = {},
) {
  const stored = overrides.due ?? [storedRule()];

  return createGenerateDueOccurrences({
    runner: overrides.runner ?? runner(),
    rules:
      overrides.rules ??
      rules({
        findDueRules: () => succeeded(stored),
        findRuleForUpdate: (_unit, query) =>
          succeeded(stored.find((row) => row.rule.id === query.ruleId) ?? null),
        advanceNextDueDate: (_unit, command) => succeeded(command.to),
      }),
    occurrences:
      overrides.occurrences ??
      occurrences({
        reserveOccurrence: (_unit, command) => succeeded(command.occurrence),
        linkGeneratedTransaction: (_unit, command) => {
          const built = createRecurringOccurrence({
            id: command.occurrenceId,
            recurringRuleId: stored[0]?.rule.id ?? "rule-1",
            scheduledFor: "2026-08-31",
            transactionId: command.transactionId,
            createdAt: NOW,
          });

          if (!built.ok) {
            throw new Error(
              `Expected a linked occurrence: ${JSON.stringify(built)}`,
            );
          }

          return succeeded(built.value);
        },
      }),
    transactions:
      overrides.transactions ??
      transactions({
        insertTransaction: (_unit, command) =>
          transactionSucceeded(command.transaction),
      }),
    clock: overrides.clock ?? new FixedClock(TODAY),
    createId: overrides.createId ?? sequentialIds("gen"),
    now: overrides.now ?? (() => NOW),
  });
}

describe("createGenerateDueOccurrences", () => {
  it("uses the system clock when no collaborators override it", () => {
    const report = createGenerateDueOccurrences({
      runner: runner(),
      rules: rules({
        findDueRules: () => succeeded([]),
      }),
      occurrences: occurrences(),
      transactions: transactions(),
    }).execute({ workspaceId: WORKSPACE_ID });

    expect(report).toEqual({
      ok: true,
      value: { generated: [], skipped: [], failed: [] },
    });
  });

  it("copies the stored template onto the owed date and advances the rule", () => {
    const home = "tag-home";
    const stored = storedRule({
      concept: "Alquiler",
      note: "Último día",
      tagIds: [home],
    });
    let inserted: Transaction | undefined;
    let advancedTo: string | undefined;

    const report = service({
      due: [stored],
      rules: rules({
        findDueRules: () => succeeded([stored]),
        findRuleForUpdate: () => succeeded(stored),
        advanceNextDueDate: (_unit, command) => {
          advancedTo = command.to;
          return succeeded(command.to);
        },
      }),
      transactions: transactions({
        insertTransaction: (_unit, command) => {
          inserted = command.transaction;
          return transactionSucceeded(command.transaction);
        },
      }),
    }).execute({ workspaceId: WORKSPACE_ID });

    expect(report).toEqual({
      ok: true,
      value: {
        generated: [
          {
            ruleId: "rule-1",
            scheduledFor: "2026-08-31",
            transactionId: "gen-2",
          },
        ],
        skipped: [],
        failed: [],
      },
    });
    expect(inserted).toEqual(
      expect.objectContaining({
        id: "gen-2",
        type: "expense",
        amountMinor: 1_299,
        date: "2026-08-31",
        categoryId: stored.category.id,
        concept: "Alquiler",
        note: "Último día",
        tagIds: [home],
      }),
    );
    expect(advancedTo).toBe("2026-09-30");
  });

  it("returns the listing refusal instead of a partial report", () => {
    const report = service({
      rules: rules({
        findDueRules: () => failed("storageFailure", "disk full"),
      }),
    }).execute({ workspaceId: WORKSPACE_ID });

    expect(report).toEqual({
      ok: false,
      error: { code: "storageFailure", cause: "disk full" },
    });
  });

  it("records a stored calendar that cannot walk forward as a failed date", () => {
    const stored = storedRule({
      nextDueDate: "9999-12-31",
      monthlyDay: 31,
    });

    const report = service({
      clock: new FixedClock("9999-12-31" as LocalDate),
      due: [stored],
    }).execute({ workspaceId: WORKSPACE_ID });

    expect(report).toEqual({
      ok: true,
      value: {
        generated: [],
        skipped: [],
        failed: [
          {
            ruleId: "rule-1",
            scheduledFor: "9999-12-31",
            code: "invalidStoredRow",
          },
        ],
      },
    });
  });

  it("skips a rule that was deactivated between the listing and the write", () => {
    const listed = storedRule();
    const stopped = storedRule({ deactivatedAt: NOW });

    const report = service({
      due: [listed],
      rules: rules({
        findDueRules: () => succeeded([listed]),
        findRuleForUpdate: () => succeeded(stopped),
        advanceNextDueDate: unused,
      }),
    }).execute({ workspaceId: WORKSPACE_ID });

    expect(report).toEqual({
      ok: true,
      value: {
        generated: [],
        skipped: [
          {
            ruleId: "rule-1",
            scheduledFor: "2026-08-31",
            reason: "ruleChanged",
          },
        ],
        failed: [],
      },
    });
  });

  it("skips a rule that stopped or moved on between the listing and the write", () => {
    const listed = storedRule();
    const moved = storedRule({ nextDueDate: "2026-09-30" });

    const report = service({
      due: [listed],
      rules: rules({
        findDueRules: () => succeeded([listed]),
        findRuleForUpdate: () => succeeded(moved),
        advanceNextDueDate: unused,
      }),
    }).execute({ workspaceId: WORKSPACE_ID });

    expect(report).toEqual({
      ok: true,
      value: {
        generated: [],
        skipped: [
          {
            ruleId: "rule-1",
            scheduledFor: "2026-08-31",
            reason: "ruleChanged",
          },
        ],
        failed: [],
      },
    });
  });

  it("skips a date another writer already reserved and still advances the rule", () => {
    let advancedFrom: string | undefined;
    const stored = storedRule();

    const report = service({
      due: [stored],
      rules: rules({
        findDueRules: () => succeeded([stored]),
        findRuleForUpdate: () => succeeded(stored),
        advanceNextDueDate: (_unit, command) => {
          advancedFrom = command.from;
          return succeeded(command.to);
        },
      }),
      occurrences: occurrences({
        reserveOccurrence: () => failed("alreadyProcessed"),
      }),
    }).execute({ workspaceId: WORKSPACE_ID });

    expect(report).toEqual({
      ok: true,
      value: {
        generated: [],
        skipped: [
          {
            ruleId: "rule-1",
            scheduledFor: "2026-08-31",
            reason: "alreadyProcessed",
          },
        ],
        failed: [],
      },
    });
    expect(advancedFrom).toBe("2026-08-31");
  });

  it("treats a stale advance after a reserved date as a skip, not a failure", () => {
    const stored = storedRule();

    const report = service({
      due: [stored],
      rules: rules({
        findDueRules: () => succeeded([stored]),
        findRuleForUpdate: () => succeeded(stored),
        advanceNextDueDate: () => failed("staleNextDueDate"),
      }),
      occurrences: occurrences({
        reserveOccurrence: () => failed("alreadyProcessed"),
      }),
    }).execute({ workspaceId: WORKSPACE_ID });

    expect(report).toEqual({
      ok: true,
      value: {
        generated: [],
        skipped: [
          {
            ruleId: "rule-1",
            scheduledFor: "2026-08-31",
            reason: "alreadyProcessed",
          },
        ],
        failed: [],
      },
    });
  });

  it("keeps walking a rule after a date that was already processed", () => {
    let nextDueDate = "2026-07-31";

    const report = service({
      due: [storedRule({ nextDueDate })],
      rules: rules({
        findDueRules: () =>
          succeeded([storedRule({ nextDueDate: "2026-07-31" })]),
        findRuleForUpdate: () => succeeded(storedRule({ nextDueDate })),
        advanceNextDueDate: (_unit, command) => {
          nextDueDate = command.to;
          return succeeded(command.to);
        },
      }),
      occurrences: occurrences({
        reserveOccurrence: (_unit, command) => {
          if (command.occurrence.scheduledFor === "2026-07-31") {
            return failed("alreadyProcessed");
          }

          return succeeded(command.occurrence);
        },
        linkGeneratedTransaction: (_unit, command) => {
          const built = createRecurringOccurrence({
            id: command.occurrenceId,
            recurringRuleId: "rule-1",
            scheduledFor: "2026-08-31",
            transactionId: command.transactionId,
            createdAt: NOW,
          });

          if (!built.ok) {
            throw new Error(
              `Expected a linked occurrence: ${JSON.stringify(built)}`,
            );
          }

          return succeeded(built.value);
        },
      }),
    }).execute({ workspaceId: WORKSPACE_ID });

    expect(report).toEqual({
      ok: true,
      value: {
        generated: [
          {
            ruleId: "rule-1",
            scheduledFor: "2026-08-31",
            transactionId: "gen-3",
          },
        ],
        skipped: [
          {
            ruleId: "rule-1",
            scheduledFor: "2026-07-31",
            reason: "alreadyProcessed",
          },
        ],
        failed: [],
      },
    });
  });

  it("stops that rule on the first date that cannot be written", () => {
    const reserved: string[] = [];
    let nextDueDate = "2026-07-31";

    const report = service({
      due: [storedRule({ nextDueDate })],
      rules: rules({
        findDueRules: () =>
          succeeded([storedRule({ nextDueDate: "2026-07-31" })]),
        findRuleForUpdate: () => succeeded(storedRule({ nextDueDate })),
        advanceNextDueDate: (_unit, command) => {
          nextDueDate = command.to;
          return succeeded(command.to);
        },
      }),
      occurrences: occurrences({
        reserveOccurrence: (_unit, command) => {
          reserved.push(command.occurrence.scheduledFor);

          if (command.occurrence.scheduledFor === "2026-08-31") {
            return failed("storageFailure", "disk full");
          }

          return succeeded(command.occurrence);
        },
        linkGeneratedTransaction: (_unit, command) => {
          const built = createRecurringOccurrence({
            id: command.occurrenceId,
            recurringRuleId: "rule-1",
            scheduledFor: reserved.at(-1) ?? "2026-07-31",
            transactionId: command.transactionId,
            createdAt: NOW,
          });

          if (!built.ok) {
            throw new Error(
              `Expected a linked occurrence: ${JSON.stringify(built)}`,
            );
          }

          return succeeded(built.value);
        },
      }),
    }).execute({ workspaceId: WORKSPACE_ID });

    expect(reserved).toEqual(["2026-07-31", "2026-08-31"]);
    expect(report).toEqual({
      ok: true,
      value: expect.objectContaining({
        generated: [
          {
            ruleId: "rule-1",
            scheduledFor: "2026-07-31",
            transactionId: "gen-2",
          },
        ],
        failed: [
          {
            ruleId: "rule-1",
            scheduledFor: "2026-08-31",
            code: "storageFailure",
          },
        ],
      }),
    });
  });

  it("refuses a unit that cannot roll back a due date", () => {
    const report = service({ runner: runner(false) }).execute({
      workspaceId: WORKSPACE_ID,
    });

    expect(report).toEqual({
      ok: true,
      value: {
        generated: [],
        skipped: [],
        failed: [
          {
            ruleId: "rule-1",
            scheduledFor: "2026-08-31",
            code: "transactionRequired",
          },
        ],
      },
    });
  });

  it("returns a re-read refusal instead of writing the date", () => {
    const stored = storedRule();

    const report = service({
      due: [stored],
      rules: rules({
        findDueRules: () => succeeded([stored]),
        findRuleForUpdate: () => failed("storageFailure"),
      }),
    }).execute({ workspaceId: WORKSPACE_ID });

    expect(report).toEqual({
      ok: true,
      value: {
        generated: [],
        skipped: [],
        failed: [
          {
            ruleId: "rule-1",
            scheduledFor: "2026-08-31",
            code: "storageFailure",
          },
        ],
      },
    });
  });

  it("skips a listed rule that disappeared before the write", () => {
    const stored = storedRule();

    const report = service({
      due: [stored],
      rules: rules({
        findDueRules: () => succeeded([stored]),
        findRuleForUpdate: () => succeeded(null),
      }),
    }).execute({ workspaceId: WORKSPACE_ID });

    expect(report).toEqual({
      ok: true,
      value: {
        generated: [],
        skipped: [
          {
            ruleId: "rule-1",
            scheduledFor: "2026-08-31",
            reason: "ruleChanged",
          },
        ],
        failed: [],
      },
    });
  });

  it("refuses an injected instant that is not a timestamp", () => {
    const report = service({ now: () => -1 }).execute({
      workspaceId: WORKSPACE_ID,
    });

    expect(report).toEqual({
      ok: true,
      value: {
        generated: [],
        skipped: [],
        failed: [
          {
            ruleId: "rule-1",
            scheduledFor: "2026-08-31",
            code: "storageFailure",
          },
        ],
      },
    });
  });

  it("refuses a reserved date whose identifier the domain would reject", () => {
    const report = service({ createId: () => "not valid" }).execute({
      workspaceId: WORKSPACE_ID,
    });

    expect(report).toEqual({
      ok: true,
      value: {
        generated: [],
        skipped: [],
        failed: [
          {
            ruleId: "rule-1",
            scheduledFor: "2026-08-31",
            code: "invalidStoredRow",
          },
        ],
      },
    });
  });

  it("refuses a movement identifier the domain would reject after reserving", () => {
    let calls = 0;

    const report = service({
      createId: () => {
        calls += 1;
        return calls === 1 ? "occ-1" : "not valid";
      },
    }).execute({ workspaceId: WORKSPACE_ID });

    expect(report).toEqual({
      ok: true,
      value: {
        generated: [],
        skipped: [],
        failed: [
          {
            ruleId: "rule-1",
            scheduledFor: "2026-08-31",
            code: "invalidStoredRow",
          },
        ],
      },
    });
  });

  it("returns a reservation refusal other than an already processed date", () => {
    const stored = storedRule();

    const report = service({
      due: [stored],
      occurrences: occurrences({
        reserveOccurrence: () => failed("duplicateId"),
      }),
    }).execute({ workspaceId: WORKSPACE_ID });

    expect(report).toEqual({
      ok: true,
      value: {
        generated: [],
        skipped: [],
        failed: [
          {
            ruleId: "rule-1",
            scheduledFor: "2026-08-31",
            code: "duplicateId",
          },
        ],
      },
    });
  });

  it("translates every named movement insert refusal", () => {
    const codes: readonly RecurringRepositoryErrorCode[] = [
      "duplicateId",
      "unknownCategory",
      "unknownTag",
      "unknownWorkspace",
      "unknownTransaction",
      "transactionRequired",
      "invalidStoredRow",
      "storageFailure",
    ];
    const mapped = [
      "duplicateId",
      "unknownCategory",
      "unknownTag",
      "unknownWorkspace",
      "transactionNotFound",
      "transactionRequired",
      "invalidStoredRow",
      "storageFailure",
    ] as const;

    for (const [index, code] of mapped.entries()) {
      const report = service({
        transactions: transactions({
          insertTransaction: () => transactionFailed(code),
        }),
      }).execute({ workspaceId: WORKSPACE_ID });

      expect(report).toEqual({
        ok: true,
        value: {
          generated: [],
          skipped: [],
          failed: [
            {
              ruleId: "rule-1",
              scheduledFor: "2026-08-31",
              code: codes[index],
            },
          ],
        },
      });
    }
  });

  it("returns a link refusal after the movement was written", () => {
    const report = service({
      occurrences: occurrences({
        reserveOccurrence: (_unit, command) => succeeded(command.occurrence),
        linkGeneratedTransaction: () => failed("occurrenceNotFound"),
      }),
    }).execute({ workspaceId: WORKSPACE_ID });

    expect(report).toEqual({
      ok: true,
      value: {
        generated: [],
        skipped: [],
        failed: [
          {
            ruleId: "rule-1",
            scheduledFor: "2026-08-31",
            code: "occurrenceNotFound",
          },
        ],
      },
    });
  });

  it("returns an advance refusal of a date that was just materialised", () => {
    const stored = storedRule();

    const report = service({
      due: [stored],
      rules: rules({
        findDueRules: () => succeeded([stored]),
        findRuleForUpdate: () => succeeded(stored),
        advanceNextDueDate: () => failed("staleNextDueDate"),
      }),
    }).execute({ workspaceId: WORKSPACE_ID });

    expect(report).toEqual({
      ok: true,
      value: {
        generated: [],
        skipped: [],
        failed: [
          {
            ruleId: "rule-1",
            scheduledFor: "2026-08-31",
            code: "staleNextDueDate",
          },
        ],
      },
    });
  });

  it("keeps going with the next rule after one date fails", () => {
    const broken = storedRule({ id: "rule-broken", nextDueDate: "2026-08-31" });
    const healthy = storedRule({
      id: "rule-healthy",
      nextDueDate: "2026-08-31",
    });

    const report = service({
      due: [broken, healthy],
      rules: rules({
        findDueRules: () => succeeded([broken, healthy]),
        findRuleForUpdate: (_unit, query) =>
          succeeded(query.ruleId === broken.rule.id ? broken : healthy),
        advanceNextDueDate: (_unit, command) => succeeded(command.to),
      }),
      occurrences: occurrences({
        reserveOccurrence: (_unit, command) => {
          if (command.occurrence.recurringRuleId === broken.rule.id) {
            return failed("storageFailure");
          }

          return succeeded(command.occurrence);
        },
        linkGeneratedTransaction: (_unit, command) => {
          const built = createRecurringOccurrence({
            id: command.occurrenceId,
            recurringRuleId: healthy.rule.id,
            scheduledFor: "2026-08-31",
            transactionId: command.transactionId,
            createdAt: NOW,
          });

          if (!built.ok) {
            throw new Error(
              `Expected a linked occurrence: ${JSON.stringify(built)}`,
            );
          }

          return succeeded(built.value);
        },
      }),
    }).execute({ workspaceId: WORKSPACE_ID });

    expect(report).toEqual({
      ok: true,
      value: {
        generated: [
          {
            ruleId: "rule-healthy",
            scheduledFor: "2026-08-31",
            transactionId: "gen-3",
          },
        ],
        skipped: [],
        failed: [
          {
            ruleId: "rule-broken",
            scheduledFor: "2026-08-31",
            code: "storageFailure",
          },
        ],
      },
    });
  });
});

describe("catchUpDueDatesInUnit", () => {
  const transactionalUnit: UnitOfWork = { isTransactional: true };
  const ruleId = storedRule().rule.id;

  it("refuses a catch-up whose rule disappeared before the write", () => {
    const caughtUp = catchUpDueDatesInUnit(transactionalUnit, {
      workspaceId: WORKSPACE_ID,
      ruleId,
      today: TODAY,
      deps: {
        rules: rules({ findRuleForUpdate: () => succeeded(null) }),
        occurrences: occurrences(),
        transactions: transactions(),
      },
      createId: sequentialIds("gen"),
      now: () => NOW,
    });

    expect(caughtUp).toEqual({
      ok: false,
      error: { code: "ruleNotFound", cause: undefined },
    });
  });

  it("refuses a catch-up whose rule was deactivated before the write", () => {
    const caughtUp = catchUpDueDatesInUnit(transactionalUnit, {
      workspaceId: WORKSPACE_ID,
      ruleId,
      today: TODAY,
      deps: {
        rules: rules({
          findRuleForUpdate: () =>
            succeeded(storedRule({ deactivatedAt: NOW })),
        }),
        occurrences: occurrences(),
        transactions: transactions(),
      },
      createId: sequentialIds("gen"),
      now: () => NOW,
    });

    expect(caughtUp).toEqual({
      ok: false,
      error: { code: "ruleNotFound", cause: undefined },
    });
  });

  it("stops the catch-up and reports the storage failure of a due date", () => {
    let reservations = 0;

    const caughtUp = catchUpDueDatesInUnit(transactionalUnit, {
      workspaceId: WORKSPACE_ID,
      ruleId,
      today: TODAY,
      deps: {
        rules: rules({
          findRuleForUpdate: () => succeeded(storedRule()),
          advanceNextDueDate: (_unit, command) => succeeded(command.to),
        }),
        occurrences: occurrences({
          reserveOccurrence: () => {
            reservations += 1;
            return failed(
              "storageFailure",
              "the reservation could not be written",
            );
          },
        }),
        transactions: transactions(),
      },
      createId: sequentialIds("gen"),
      now: () => NOW,
    });

    expect(caughtUp).toEqual({
      ok: false,
      error: {
        code: "storageFailure",
        cause: "the reservation could not be written",
      },
    });
    expect(reservations).toBe(1);
  });

  it("refuses the catch-up when the rule moved on between the read and the write", () => {
    let reads = 0;

    const caughtUp = catchUpDueDatesInUnit(transactionalUnit, {
      workspaceId: WORKSPACE_ID,
      ruleId,
      today: TODAY,
      deps: {
        rules: rules({
          findRuleForUpdate: () => {
            reads += 1;
            return succeeded(
              reads === 1
                ? storedRule()
                : storedRule({ nextDueDate: "2026-09-30" }),
            );
          },
        }),
        occurrences: occurrences(),
        transactions: transactions(),
      },
      createId: sequentialIds("gen"),
      now: () => NOW,
    });

    expect(caughtUp).toEqual({
      ok: false,
      error: { code: "staleNextDueDate", cause: undefined },
    });
    expect(reads).toBe(2);
  });

  it("advances over a date another run already reserved without writing it twice", () => {
    let inserts = 0;

    const caughtUp = catchUpDueDatesInUnit(transactionalUnit, {
      workspaceId: WORKSPACE_ID,
      ruleId,
      today: TODAY,
      deps: {
        rules: rules({
          findRuleForUpdate: () => succeeded(storedRule()),
          advanceNextDueDate: (_unit, command) => succeeded(command.to),
        }),
        occurrences: occurrences({
          reserveOccurrence: () => failed("alreadyProcessed"),
        }),
        transactions: transactions({
          insertTransaction: (_unit, command) => {
            inserts += 1;
            return transactionSucceeded(command.transaction);
          },
        }),
      },
      createId: sequentialIds("gen"),
      now: () => NOW,
    });

    expect(caughtUp).toEqual({ ok: true, value: [] });
    expect(inserts).toBe(0);
  });
});
