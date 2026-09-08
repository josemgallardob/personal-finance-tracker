/**
 * Dashboard analytics services against an in-memory analytics port.
 *
 * The port is the storage boundary. These cases fix the composition: windows,
 * exact numerators, nullable percentages, empty history versus a zero month,
 * overflow and the fact that a UI series selection never becomes a query
 * filter. Figures against SQLite live in the integration suite.
 */

import { describe, expect, it } from "vitest";

import { FixedClock } from "../../../shared/domain/clock";
import type { LocalDate, MonthKey } from "../../../shared/domain/dates";
import { parseLocalDate, parseMonthKey } from "../../../shared/domain/dates";
import type { MoneyMinor } from "../../../shared/domain/money";
import { toMoneyMinor } from "../../../shared/domain/money";
import { createCategory } from "../../classification/domain/category";
import { createTag } from "../../classification/domain/tag";
import type { Transaction } from "../../transactions/domain/transaction";
import { NO_COMPARISON_BASE } from "../domain/comparison";
import {
  createDashboardAnalytics,
  presentAverageMinor,
  type DashboardAnalyticsResult,
} from "./dashboard-analytics";
import type {
  AnalyticsRepository,
  CategoryExpenseTotal,
  DateRangeQuery,
  MonthlyTotalsQuery,
  RecentTransactionsQuery,
  TagExpenseBreakdown,
  TypeTotals,
  WorkspaceScope,
} from "./ports/analytics-repository";
import { failed, succeeded } from "./ports/analytics-repository";
import type { UnitOfWork } from "./ports/unit-of-work";

const TODAY = date("2026-05-15");
const WORKSPACE = "workspace-1";
const transactional: UnitOfWork = { isTransactional: true };

function date(text: string): LocalDate {
  const result = parseLocalDate(text);

  if (!result.ok) {
    throw new Error(`Expected a date: ${result.error}`);
  }

  return result.value;
}

function month(text: string): MonthKey {
  const result = parseMonthKey(text);

  if (!result.ok) {
    throw new Error(`Expected a month: ${result.error}`);
  }

  return result.value;
}

function minor(value: number): MoneyMinor {
  const result = toMoneyMinor(value);

  if (!result.ok) {
    throw new Error(`Expected exact minor units: ${result.error}`);
  }

  return result.value;
}

function okValue<TValue>(result: DashboardAnalyticsResult<TValue>): TValue {
  if (!result.ok) {
    throw new Error(`Expected success: ${JSON.stringify(result.error)}`);
  }

  return result.value;
}

function unused(): never {
  throw new Error("Unexpected repository method");
}

function zeros(): TypeTotals {
  return {
    incomeMinor: minor(0),
    expenseMinor: minor(0),
    incomeCount: 0,
    expenseCount: 0,
  };
}

function types(
  incomeMinor: number,
  expenseMinor: number,
  incomeCount = 1,
  expenseCount = 1,
): TypeTotals {
  return {
    incomeMinor: minor(incomeMinor),
    expenseMinor: minor(expenseMinor),
    incomeCount: incomeMinor === 0 ? 0 : incomeCount,
    expenseCount: expenseMinor === 0 ? 0 : expenseCount,
  };
}

function category(
  id: string,
  name: string,
  amountMinor: number,
  archived = false,
): CategoryExpenseTotal {
  const built = createCategory({
    id,
    name,
    type: "expense",
    sortOrder: 0,
    archivedAt: archived ? 1_746_268_800_000 : null,
  });

  if (!built.ok) {
    throw new Error(`Expected a category: ${JSON.stringify(built)}`);
  }

  return {
    category: built.value,
    totalMinor: minor(amountMinor),
    transactionCount: 1,
  };
}

function tagBreakdown(): TagExpenseBreakdown {
  const built = createTag({
    id: "tag-travel",
    name: "viajes",
    archivedAt: null,
  });

  if (!built.ok) {
    throw new Error(`Expected a tag: ${JSON.stringify(built)}`);
  }

  return {
    tags: [
      {
        tag: built.value,
        totalMinor: minor(8_500),
        transactionCount: 2,
      },
    ],
    untaggedMinor: minor(10_001),
    untaggedCount: 2,
  };
}

interface RecordedQuery {
  readonly method: string;
  readonly range?: string;
  readonly months?: readonly string[];
  readonly limit?: number;
  readonly transactional: boolean;
}

function rangeKey(query: DateRangeQuery): string {
  return `${query.range.start}:${query.range.end}`;
}

function repository(
  overrides: Partial<AnalyticsRepository> = {},
  record: RecordedQuery[] = [],
): AnalyticsRepository {
  return {
    readTypeTotals(unit, query) {
      record.push({
        method: "readTypeTotals",
        range: rangeKey(query),
        transactional: unit.isTransactional,
      });
      return succeeded(zeros());
    },
    readMonthlyTotals(unit, query) {
      record.push({
        method: "readMonthlyTotals",
        months: [...query.months],
        transactional: unit.isTransactional,
      });
      return succeeded(
        query.months.map((entry) => ({
          month: entry,
          ...zeros(),
        })),
      );
    },
    readExpenseByCategory(unit, query) {
      record.push({
        method: "readExpenseByCategory",
        range: rangeKey(query),
        transactional: unit.isTransactional,
      });
      return succeeded([]);
    },
    readExpenseByTag(unit, query) {
      record.push({
        method: "readExpenseByTag",
        range: rangeKey(query),
        transactional: unit.isTransactional,
      });
      return succeeded({
        tags: [],
        untaggedMinor: minor(0),
        untaggedCount: 0,
      });
    },
    findFirstTransactionDate(unit, scope: WorkspaceScope) {
      record.push({
        method: "findFirstTransactionDate",
        transactional: unit.isTransactional,
      });
      void scope;
      return succeeded(date("2026-01-15"));
    },
    readRecentTransactions(unit, query: RecentTransactionsQuery) {
      record.push({
        method: "readRecentTransactions",
        limit: query.limit,
        transactional: unit.isTransactional,
      });
      return succeeded([]);
    },
    ...overrides,
  };
}

function services(analytics: AnalyticsRepository, today: LocalDate = TODAY) {
  return createDashboardAnalytics({
    analytics,
    clock: new FixedClock(today),
    snapshots: {
      runInSnapshot(work) {
        return work(transactional);
      },
    },
  });
}

describe("readSummary", () => {
  it("refuses a custom range given in reverse order before reading storage", () => {
    const record: RecordedQuery[] = [];
    const analytics = createDashboardAnalytics({
      analytics: repository({}, record),
      clock: new FixedClock(TODAY),
      snapshots: {
        runInSnapshot() {
          throw new Error("A refused period must not open a snapshot");
        },
      },
    });

    expect(
      analytics.readSummary({
        workspaceId: WORKSPACE,
        period: {
          kind: "customMonthRange",
          from: month("2026-05"),
          to: month("2026-01"),
        },
      }),
    ).toEqual({ ok: false, error: { code: "invalidMonthRange" } });
    expect(record).toEqual([]);
  });

  it("refuses a previous month that would leave the supported calendar", () => {
    expect(
      services(repository(), date("0001-01-15")).readSummary({
        workspaceId: WORKSPACE,
        period: { kind: "previousMonth" },
      }),
    ).toEqual({ ok: false, error: { code: "monthOutOfRange" } });
  });

  it("contrasts the selected period with the equivalent previous interval", () => {
    const record: RecordedQuery[] = [];
    const totalsByRange = new Map<string, TypeTotals>([
      ["2026-05-01:2026-05-15", types(0, 1, 0, 1)],
      ["2026-04-01:2026-04-15", zeros()],
    ]);
    const home = category("category-home", "Casa", 1);

    const result = okValue(
      services(
        repository(
          {
            readTypeTotals(_unit, query) {
              record.push({
                method: "readTypeTotals",
                range: rangeKey(query),
                transactional: true,
              });
              return succeeded(totalsByRange.get(rangeKey(query)) ?? zeros());
            },
            readExpenseByCategory() {
              return succeeded([home]);
            },
            readExpenseByTag() {
              return succeeded({
                tags: [],
                untaggedMinor: minor(1),
                untaggedCount: 1,
              });
            },
            readRecentTransactions(_unit, query) {
              record.push({
                method: "readRecentTransactions",
                limit: query.limit,
                transactional: true,
              });
              return succeeded([{ id: "recent" } as unknown as Transaction]);
            },
          },
          record,
        ),
      ).readSummary({
        workspaceId: WORKSPACE,
        period: { kind: "currentMonth" },
      }),
    );

    expect(result.range).toEqual({
      start: date("2026-05-01"),
      end: date("2026-05-15"),
    });
    expect(result.comparison.previous).toEqual({
      start: date("2026-04-01"),
      end: date("2026-04-15"),
    });
    expect(result.totals.current).toEqual({
      incomeMinor: 0,
      expenseMinor: 1,
      netMinor: -1,
      incomeCount: 0,
      expenseCount: 1,
    });
    expect(result.totals.income).toEqual({
      currentMinor: 0,
      previousMinor: 0,
      deltaMinor: 0,
      deltaPercent: 0,
      reason: null,
    });
    expect(result.totals.expense.deltaPercent).toBeNull();
    expect(result.totals.expense.reason).toBe(NO_COMPARISON_BASE);
    expect(result.totals.net.deltaPercent).toBeNull();
    expect(result.totals.net.reason).toBe(NO_COMPARISON_BASE);
    expect(result.recentTransactions).toHaveLength(1);
    expect(record.map((entry) => entry.limit).filter(Boolean)).toEqual([5]);
  });

  it("takes net from the type totals, not from overlapping tag groups", () => {
    const home = category("category-home", "Casa", 10_000);
    const leisure = category("category-leisure", "Ocio", 6_000);
    const overlapping = tagBreakdown();

    const result = okValue(
      services(
        repository({
          readTypeTotals() {
            return succeeded(types(200_000, 16_000));
          },
          readExpenseByCategory() {
            return succeeded([home, leisure]);
          },
          readExpenseByTag() {
            return succeeded(overlapping);
          },
        }),
      ).readSummary({
        workspaceId: WORKSPACE,
        period: { kind: "previousMonth" },
      }),
    );

    expect(result.totals.current.netMinor).toBe(184_000);
    expect(result.totals.current.netMinor).toBe(
      result.totals.current.incomeMinor - result.totals.current.expenseMinor,
    );
    expect(
      result.expenseByCategory.reduce(
        (sum, entry) => sum + entry.totalMinor,
        0,
      ),
    ).toBe(result.totals.current.expenseMinor);
    expect(
      result.expenseByTag.tags.reduce(
        (sum, entry) => sum + entry.totalMinor,
        0,
      ),
    ).not.toBe(result.totals.current.expenseMinor);
    expect(
      result.expenseByTag.tags.reduce(
        (sum, entry) => sum + entry.totalMinor,
        0,
      ) + result.expenseByTag.untaggedMinor,
    ).not.toBe(result.totals.current.expenseMinor);
  });

  it("keeps global totals when a UI series selection hides archived groups", () => {
    const gym = category("category-gym", "Gimnasio", 12_000, true);
    const leisure = category("category-leisure", "Ocio", 2_500);

    const result = okValue(
      services(
        repository({
          readTypeTotals() {
            return succeeded(types(250_000, 14_500));
          },
          readExpenseByCategory() {
            return succeeded([gym, leisure]);
          },
        }),
      ).readSummary({
        workspaceId: WORKSPACE,
        period: { kind: "lastThreeMonths" },
      }),
    );

    const selected = result.expenseByCategory.filter(
      (entry) => entry.category.archivedAt === null,
    );

    expect(result.totals.current.expenseMinor).toBe(14_500);
    expect(selected.reduce((sum, entry) => sum + entry.totalMinor, 0)).toBe(
      2_500,
    );
    expect(selected.reduce((sum, entry) => sum + entry.totalMinor, 0)).not.toBe(
      result.totals.current.expenseMinor,
    );
  });

  it("propagates a refusal of the current totals", () => {
    expect(
      services(
        repository({
          readTypeTotals: () => failed("storageFailure", "totals"),
        }),
      ).readSummary({
        workspaceId: WORKSPACE,
        period: { kind: "currentMonth" },
      }),
    ).toEqual({
      ok: false,
      error: { code: "storageFailure", cause: "totals" },
    });
  });

  it("propagates a refusal of the previous totals", () => {
    let calls = 0;

    expect(
      services(
        repository({
          readTypeTotals() {
            calls += 1;
            return calls === 1
              ? succeeded(zeros())
              : failed("invalidStoredRow");
          },
        }),
      ).readSummary({
        workspaceId: WORKSPACE,
        period: { kind: "currentMonth" },
      }),
    ).toEqual({ ok: false, error: { code: "invalidStoredRow" } });
  });

  it("refuses a net that no longer fits an exact integer", () => {
    expect(
      services(
        repository({
          readTypeTotals() {
            return succeeded({
              incomeMinor: minor(-Number.MAX_SAFE_INTEGER),
              expenseMinor: minor(1),
              incomeCount: 0,
              expenseCount: 1,
            });
          },
        }),
      ).readSummary({
        workspaceId: WORKSPACE,
        period: { kind: "currentMonth" },
      }),
    ).toEqual({ ok: false, error: { code: "amountOverflow" } });
  });

  it("refuses the previous net when only that interval overflows", () => {
    let calls = 0;

    expect(
      services(
        repository({
          readTypeTotals() {
            calls += 1;
            return succeeded(
              calls === 1
                ? zeros()
                : {
                    incomeMinor: minor(-Number.MAX_SAFE_INTEGER),
                    expenseMinor: minor(1),
                    incomeCount: 0,
                    expenseCount: 1,
                  },
            );
          },
        }),
      ).readSummary({
        workspaceId: WORKSPACE,
        period: { kind: "currentMonth" },
      }),
    ).toEqual({ ok: false, error: { code: "amountOverflow" } });
  });

  it("refuses a comparison whose percentage leaves the exact range", () => {
    let calls = 0;

    expect(
      services(
        repository({
          readTypeTotals() {
            calls += 1;
            return succeeded(
              calls === 1
                ? types(Number.MAX_SAFE_INTEGER, 0, 1, 0)
                : types(1, 0, 1, 0),
            );
          },
        }),
      ).readSummary({
        workspaceId: WORKSPACE,
        period: { kind: "currentMonth" },
      }),
    ).toEqual({
      ok: false,
      error: { code: "amountOverflow", cause: "overflow" },
    });
  });

  it("refuses an expense comparison whose percentage leaves the exact range", () => {
    let calls = 0;

    expect(
      services(
        repository({
          readTypeTotals() {
            calls += 1;
            return succeeded(
              calls === 1
                ? types(0, Number.MAX_SAFE_INTEGER, 0, 1)
                : types(0, 1, 0, 1),
            );
          },
        }),
      ).readSummary({
        workspaceId: WORKSPACE,
        period: { kind: "currentMonth" },
      }),
    ).toEqual({
      ok: false,
      error: { code: "amountOverflow", cause: "overflow" },
    });
  });

  it("refuses a net comparison whose difference leaves the exact range", () => {
    let calls = 0;

    expect(
      services(
        repository({
          readTypeTotals() {
            calls += 1;
            return succeeded(
              calls === 1
                ? types(Number.MAX_SAFE_INTEGER, 0, 1, 0)
                : types(0, 1, 0, 1),
            );
          },
        }),
      ).readSummary({
        workspaceId: WORKSPACE,
        period: { kind: "currentMonth" },
      }),
    ).toEqual({
      ok: false,
      error: { code: "amountOverflow", cause: "overflow" },
    });
  });

  it("propagates a refusal of the category breakdown", () => {
    expect(
      services(
        repository({
          readExpenseByCategory: () => failed("amountOverflow"),
        }),
      ).readSummary({
        workspaceId: WORKSPACE,
        period: { kind: "currentMonth" },
      }),
    ).toEqual({ ok: false, error: { code: "amountOverflow" } });
  });

  it("propagates a refusal of the tag breakdown", () => {
    expect(
      services(
        repository({
          readExpenseByTag: () => failed("storageFailure", "tags"),
        }),
      ).readSummary({
        workspaceId: WORKSPACE,
        period: { kind: "currentMonth" },
      }),
    ).toEqual({
      ok: false,
      error: { code: "storageFailure", cause: "tags" },
    });
  });

  it("propagates a refusal of the recent movements", () => {
    expect(
      services(
        repository({
          readRecentTransactions: () => failed("invalidStoredRow"),
        }),
      ).readSummary({
        workspaceId: WORKSPACE,
        period: { kind: "currentMonth" },
      }),
    ).toEqual({ ok: false, error: { code: "invalidStoredRow" } });
  });
});

describe("readEvolution", () => {
  it("returns an empty series when the workspace has no movement", () => {
    const record: RecordedQuery[] = [];

    expect(
      services(
        repository(
          {
            findFirstTransactionDate(unit) {
              record.push({
                method: "findFirstTransactionDate",
                transactional: unit.isTransactional,
              });
              return succeeded(null);
            },
            readMonthlyTotals: unused,
          },
          record,
        ),
      ).readEvolution({ workspaceId: WORKSPACE }),
    ).toEqual({ ok: true, value: { kind: "empty" } });
    expect(record.map((entry) => entry.method)).toEqual([
      "findFirstTransactionDate",
    ]);
  });

  it("returns an empty series when the first movement is after today", () => {
    expect(
      services(
        repository({
          findFirstTransactionDate: () => succeeded(date("2026-06-01")),
          readMonthlyTotals: unused,
        }),
      ).readEvolution({ workspaceId: WORKSPACE }),
    ).toEqual({ ok: true, value: { kind: "empty" } });
  });

  it("keeps an interior month of zeroes instead of compressing the series", () => {
    const result = okValue(
      services(
        repository({
          readMonthlyTotals(_unit, query: MonthlyTotalsQuery) {
            return succeeded(
              query.months.map((entry) => ({
                month: entry,
                ...(entry === month("2026-04") ? zeros() : types(0, 1, 0, 1)),
              })),
            );
          },
        }),
      ).readEvolution({ workspaceId: WORKSPACE }),
    );

    expect(result.kind).toBe("months");
    if (result.kind !== "months") {
      return;
    }

    expect(result.window.months).toEqual([
      month("2026-01"),
      month("2026-02"),
      month("2026-03"),
      month("2026-04"),
      month("2026-05"),
    ]);
    expect(
      result.months.find((entry) => entry.month === month("2026-04")),
    ).toEqual({
      month: month("2026-04"),
      ...zeros(),
    });
  });

  it("does not follow the period selected for the summary cards", () => {
    const record: RecordedQuery[] = [];
    const analytics = services(repository({}, record));

    okValue(
      analytics.readSummary({
        workspaceId: WORKSPACE,
        period: { kind: "previousMonth" },
      }),
    );
    const evolution = okValue(
      analytics.readEvolution({ workspaceId: WORKSPACE }),
    );

    expect(evolution.kind).toBe("months");
    if (evolution.kind !== "months") {
      return;
    }

    expect(evolution.window.end).toBe(month("2026-05"));
    expect(record.some((entry) => entry.months?.includes("2026-04"))).toBe(
      true,
    );
  });

  it("propagates a refusal of the first movement date", () => {
    expect(
      services(
        repository({
          findFirstTransactionDate: () => failed("storageFailure", "first"),
        }),
      ).readEvolution({ workspaceId: WORKSPACE }),
    ).toEqual({
      ok: false,
      error: { code: "storageFailure", cause: "first" },
    });
  });

  it("propagates a refusal of the monthly series", () => {
    expect(
      services(
        repository({
          readMonthlyTotals: () => failed("amountOverflow"),
        }),
      ).readEvolution({ workspaceId: WORKSPACE }),
    ).toEqual({ ok: false, error: { code: "amountOverflow" } });
  });
});

describe("readAverages", () => {
  it("reports insufficient history when no natural month has closed", () => {
    expect(
      services(
        repository({
          findFirstTransactionDate: () => succeeded(date("2026-05-02")),
          readTypeTotals: unused,
        }),
        TODAY,
      ).readAverages({ workspaceId: WORKSPACE }),
    ).toEqual({ ok: true, value: { kind: "insufficientHistory" } });
  });

  it("keeps the exact numerator and divisor, including a month of zeroes", () => {
    const gym = category("category-gym", "Gimnasio", 12_000, true);
    const leisure = category("category-leisure", "Ocio", 2_500);
    const travel = createTag({
      id: "tag-travel",
      name: "viajes",
      archivedAt: null,
    });

    if (!travel.ok) {
      throw new Error("Expected a tag");
    }

    const result = okValue(
      services(
        repository({
          readTypeTotals() {
            return succeeded(types(250_000, 14_500));
          },
          readExpenseByCategory() {
            return succeeded([gym, leisure]);
          },
          readExpenseByTag() {
            return succeeded({
              tags: [
                {
                  tag: travel.value,
                  totalMinor: minor(2_500),
                  transactionCount: 1,
                },
              ],
              untaggedMinor: minor(12_000),
              untaggedCount: 1,
            });
          },
        }),
      ).readAverages({ workspaceId: WORKSPACE }),
    );

    expect(result.kind).toBe("months");
    if (result.kind !== "months") {
      return;
    }

    expect(result.window.months).toEqual([
      month("2026-02"),
      month("2026-03"),
      month("2026-04"),
    ]);
    expect(result.totalExpense).toEqual({
      totalMinor: 14_500,
      monthCount: 3,
    });
    expect(result.net).toEqual({
      totalMinor: 235_500,
      monthCount: 3,
    });
    expect(presentAverageMinor(result.totalExpense.totalMinor, 3)).toEqual({
      ok: true,
      value: 4_833,
    });
    expect(presentAverageMinor(minor(-100_001), 2)).toEqual({
      ok: true,
      value: -50_001,
    });
  });

  it("does not change global averages when only active series remain selected", () => {
    const gym = category("category-gym", "Gimnasio", 12_000, true);
    const leisure = category("category-leisure", "Ocio", 2_500);

    const result = okValue(
      services(
        repository({
          readTypeTotals: () => succeeded(types(250_000, 14_500)),
          readExpenseByCategory: () => succeeded([gym, leisure]),
        }),
      ).readAverages({ workspaceId: WORKSPACE }),
    );

    expect(result.kind).toBe("months");
    if (result.kind !== "months") {
      return;
    }

    const selected = result.byCategory.filter(
      (entry) => entry.category.archivedAt === null,
    );

    expect(result.totalExpense.totalMinor).toBe(14_500);
    expect(selected.reduce((sum, entry) => sum + entry.totalMinor, 0)).toBe(
      2_500,
    );
  });

  it("propagates a refusal of the first movement date", () => {
    expect(
      services(
        repository({
          findFirstTransactionDate: () => failed("invalidStoredRow"),
        }),
      ).readAverages({ workspaceId: WORKSPACE }),
    ).toEqual({ ok: false, error: { code: "invalidStoredRow" } });
  });

  it("propagates a refusal of the window totals", () => {
    expect(
      services(
        repository({
          readTypeTotals: () => failed("storageFailure", "averages"),
        }),
      ).readAverages({ workspaceId: WORKSPACE }),
    ).toEqual({
      ok: false,
      error: { code: "storageFailure", cause: "averages" },
    });
  });

  it("refuses a net numerator that overflows", () => {
    expect(
      services(
        repository({
          readTypeTotals: () =>
            succeeded({
              incomeMinor: minor(-Number.MAX_SAFE_INTEGER),
              expenseMinor: minor(1),
              incomeCount: 0,
              expenseCount: 1,
            }),
        }),
      ).readAverages({ workspaceId: WORKSPACE }),
    ).toEqual({ ok: false, error: { code: "amountOverflow" } });
  });

  it("propagates a refusal of the category averages", () => {
    expect(
      services(
        repository({
          readExpenseByCategory: () => failed("amountOverflow"),
        }),
      ).readAverages({ workspaceId: WORKSPACE }),
    ).toEqual({ ok: false, error: { code: "amountOverflow" } });
  });

  it("propagates a refusal of the tag averages", () => {
    expect(
      services(
        repository({
          readExpenseByTag: () => failed("storageFailure"),
        }),
      ).readAverages({ workspaceId: WORKSPACE }),
    ).toEqual({ ok: false, error: { code: "storageFailure" } });
  });
});
