/**
 * Dashboard analytics services against a real, migrated SQLite file.
 *
 * Figures are asserted in exact minor units against a known dataset: net comes
 * from the type totals, category groups do not overlap, tag groups do, April
 * is a zero month rather than an empty series, and a workspace with no
 * movement is insufficient history rather than a zero average. The UI series
 * selection is applied only after the response, so globals do not move. One
 * snapshot is opened per response, so a writer that commits mid-read cannot
 * appear in only some of the figures.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createDashboardAnalytics,
  presentAverageMinor,
  type DashboardAnalytics,
  type DashboardAnalyticsResult,
} from "../../../src/modules/analytics/application/dashboard-analytics";
import { sqliteAnalyticsRepository } from "../../../src/modules/analytics/infrastructure/sqlite-analytics-repository";
import { sqliteAnalyticsSnapshotRunner } from "../../../src/modules/analytics/infrastructure/sqlite-unit-of-work";
import type { Category } from "../../../src/modules/classification/domain/category";
import type { Tag } from "../../../src/modules/classification/domain/tag";
import { FixedClock } from "../../../src/shared/domain/clock";
import type { LocalDate, MonthKey } from "../../../src/shared/domain/dates";
import { parseMonthKey } from "../../../src/shared/domain/dates";
import { loadAppConfig } from "../../../src/shared/server/config";
import { openSqliteConnection } from "../../../src/shared/server/database";
import { createValidAppEnv } from "../helpers/sqlite";
import {
  type AnalyticsFixture,
  archiveCategory,
  archiveTag,
  createAnalyticsFixture,
  storeCategory,
  storeTag,
  storeTransaction,
} from "./helpers";

function okValue<TValue>(result: DashboardAnalyticsResult<TValue>): TValue {
  if (!result.ok) {
    throw new Error(`Expected success: ${JSON.stringify(result.error)}`);
  }

  return result.value;
}

function errorCode(result: DashboardAnalyticsResult<unknown>): string {
  return result.ok ? "ok" : result.error.code;
}

function month(text: string): MonthKey {
  const result = parseMonthKey(text);

  if (!result.ok) {
    throw new Error(`Expected a month: ${result.error}`);
  }

  return result.value;
}

const TODAY = "2026-05-15" as LocalDate;

let fixture: AnalyticsFixture;
let workspaceId: string;
let home: Category;
let leisure: Category;
let gym: Category;
let salary: Category;
let travel: Tag;
let withFriends: Tag;
let retired: Tag;
let analytics: DashboardAnalytics;

function seedKnownDataset(): void {
  home = storeCategory(fixture, "Casa", "expense", 0);
  leisure = storeCategory(fixture, "Ocio", "expense", 1);
  gym = storeCategory(fixture, "Gimnasio", "expense", 2);
  salary = storeCategory(fixture, "Nómina", "income", 0);
  travel = storeTag(fixture, "viajes");
  withFriends = storeTag(fixture, "con amigos");
  retired = storeTag(fixture, "temporada");

  storeTransaction(fixture, {
    category: home,
    amountMinor: 10_000,
    date: "2026-01-15",
    createdAt: 1_800_000_001_000,
    updatedAt: 1_800_000_001_000,
  });
  storeTransaction(fixture, {
    category: leisure,
    amountMinor: 6_000,
    date: "2026-01-20",
    tagIds: [travel.id, withFriends.id],
    createdAt: 1_800_000_002_000,
    updatedAt: 1_800_000_002_000,
  });
  storeTransaction(fixture, {
    category: gym,
    amountMinor: 12_000,
    date: "2026-02-10",
    tagIds: [retired.id],
    createdAt: 1_800_000_003_000,
    updatedAt: 1_800_000_003_000,
  });
  storeTransaction(fixture, {
    category: salary,
    amountMinor: 200_000,
    date: "2026-02-28",
    createdAt: 1_800_000_004_000,
    updatedAt: 1_800_000_004_000,
  });
  storeTransaction(fixture, {
    category: leisure,
    amountMinor: 2_500,
    date: "2026-03-05",
    tagIds: [travel.id],
    createdAt: 1_800_000_005_000,
    updatedAt: 1_800_000_005_000,
  });
  storeTransaction(fixture, {
    category: salary,
    amountMinor: 50_000,
    date: "2026-03-31",
    createdAt: 1_800_000_006_000,
    updatedAt: 1_800_000_006_000,
  });
  storeTransaction(fixture, {
    category: home,
    amountMinor: 1,
    date: "2026-05-02",
    createdAt: 1_800_000_007_000,
    updatedAt: 1_800_000_007_000,
  });

  gym = archiveCategory(fixture, gym);
  retired = archiveTag(fixture, retired);
}

function createServices(clockDate: LocalDate = TODAY) {
  return createDashboardAnalytics({
    analytics: sqliteAnalyticsRepository,
    clock: new FixedClock(clockDate),
    snapshots: sqliteAnalyticsSnapshotRunner(fixture.connection),
  });
}

beforeEach(() => {
  fixture = createAnalyticsFixture();
  workspaceId = fixture.workspaceId;
  seedKnownDataset();
  analytics = createServices();
});

afterEach(() => {
  fixture.cleanup();
});

describe("summary figures", () => {
  it("matches the manual totals of the current month against the labelled previous interval", () => {
    const summary = okValue(
      analytics.readSummary({
        workspaceId,
        period: { kind: "currentMonth" },
      }),
    );

    expect(summary.range).toEqual({
      start: "2026-05-01",
      end: "2026-05-15",
    });
    expect(summary.comparison.previous).toEqual({
      start: "2026-04-01",
      end: "2026-04-15",
    });
    expect(summary.totals.current).toEqual({
      incomeMinor: 0,
      expenseMinor: 1,
      netMinor: -1,
      incomeCount: 0,
      expenseCount: 1,
    });
    expect(summary.totals.current.netMinor).toBe(
      summary.totals.current.incomeMinor - summary.totals.current.expenseMinor,
    );
    expect(summary.totals.income.deltaPercent).toBe(0);
    expect(summary.totals.expense.deltaPercent).toBeNull();
    expect(summary.totals.expense.reason).toBe("noComparisonBase");
    expect(summary.recentTransactions.map((movement) => movement.date)).toEqual(
      ["2026-05-02", "2026-03-31", "2026-03-05", "2026-02-28", "2026-02-10"],
    );
  });

  it("keeps category groups disjoint and tag groups overlapping on the known dataset", () => {
    const summary = okValue(
      analytics.readSummary({
        workspaceId,
        period: {
          kind: "customMonthRange",
          from: month("2026-01"),
          to: month("2026-05"),
        },
      }),
    );

    const categorySum = summary.expenseByCategory.reduce(
      (sum, entry) => sum + entry.totalMinor,
      0,
    );
    const tagSum = summary.expenseByTag.tags.reduce(
      (sum, entry) => sum + entry.totalMinor,
      0,
    );

    expect(summary.totals.current).toEqual({
      incomeMinor: 250_000,
      expenseMinor: 30_501,
      netMinor: 219_499,
      incomeCount: 2,
      expenseCount: 5,
    });
    expect(categorySum).toBe(summary.totals.current.expenseMinor);
    expect(tagSum).not.toBe(summary.totals.current.expenseMinor);
    expect(tagSum + summary.expenseByTag.untaggedMinor).not.toBe(
      summary.totals.current.expenseMinor,
    );
    expect(summary.expenseByTag.untaggedMinor).toBe(10_001);
    expect(
      summary.expenseByCategory.map((entry) => entry.category.name),
    ).toEqual(["Gimnasio", "Casa", "Ocio"]);
  });

  it("does not change globals when archived series are left out of a selection", () => {
    const summary = okValue(
      analytics.readSummary({
        workspaceId,
        period: { kind: "lastThreeMonths" },
      }),
    );
    const selected = summary.expenseByCategory.filter(
      (entry) => entry.category.archivedAt === null,
    );

    expect(summary.totals.current.expenseMinor).toBe(14_500);
    expect(selected.reduce((sum, entry) => sum + entry.totalMinor, 0)).toBe(
      2_500,
    );
    expect(selected.map((entry) => entry.category.id)).not.toContain(gym.id);
  });
});

describe("evolution figures", () => {
  it("materializes April as a zero month of a non-empty series", () => {
    const evolution = okValue(analytics.readEvolution({ workspaceId }));

    expect(evolution.kind).toBe("months");
    if (evolution.kind !== "months") {
      return;
    }

    expect(evolution.window.months).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
    ]);
    expect(evolution.months.find((entry) => entry.month === "2026-04")).toEqual(
      {
        month: "2026-04",
        incomeMinor: 0,
        expenseMinor: 0,
        incomeCount: 0,
        expenseCount: 0,
      },
    );
  });

  it("does not follow the period of the summary cards", () => {
    okValue(
      analytics.readSummary({
        workspaceId,
        period: { kind: "previousMonth" },
      }),
    );
    const evolution = okValue(analytics.readEvolution({ workspaceId }));

    expect(evolution.kind).toBe("months");
    if (evolution.kind !== "months") {
      return;
    }

    expect(evolution.window.end).toBe("2026-05");
  });
});

describe("average figures", () => {
  it("divides the exact window totals, including the empty April, by three months", () => {
    const averages = okValue(analytics.readAverages({ workspaceId }));

    expect(averages.kind).toBe("months");
    if (averages.kind !== "months") {
      return;
    }

    expect(averages.window.months).toEqual(["2026-02", "2026-03", "2026-04"]);
    expect(averages.totalExpense).toEqual({
      totalMinor: 14_500,
      monthCount: 3,
    });
    expect(averages.net).toEqual({
      totalMinor: 235_500,
      monthCount: 3,
    });
    expect(averages.net.totalMinor).toBe(
      250_000 - averages.totalExpense.totalMinor,
    );
    expect(
      presentAverageMinor(
        averages.totalExpense.totalMinor,
        averages.totalExpense.monthCount,
      ),
    ).toEqual({ ok: true, value: 4_833 });
  });

  it("keeps global averages when only active category series remain selected", () => {
    const averages = okValue(analytics.readAverages({ workspaceId }));

    expect(averages.kind).toBe("months");
    if (averages.kind !== "months") {
      return;
    }

    const selected = averages.byCategory.filter(
      (entry) => entry.category.archivedAt === null,
    );

    expect(averages.totalExpense.totalMinor).toBe(14_500);
    expect(selected.reduce((sum, entry) => sum + entry.totalMinor, 0)).toBe(
      2_500,
    );
  });
});

describe("empty history versus a zero month", () => {
  it("distinguishes a workspace with no movement from a month of zeroes", () => {
    const empty = createAnalyticsFixture();

    try {
      const emptyAnalytics = createDashboardAnalytics({
        analytics: sqliteAnalyticsRepository,
        clock: new FixedClock(TODAY),
        snapshots: sqliteAnalyticsSnapshotRunner(empty.connection),
      });

      expect(
        okValue(
          emptyAnalytics.readEvolution({ workspaceId: empty.workspaceId }),
        ),
      ).toEqual({ kind: "empty" });
      expect(
        okValue(
          emptyAnalytics.readAverages({ workspaceId: empty.workspaceId }),
        ),
      ).toEqual({ kind: "insufficientHistory" });
    } finally {
      empty.cleanup();
    }

    const evolution = okValue(analytics.readEvolution({ workspaceId }));
    expect(evolution.kind).toBe("months");
  });

  it("reports insufficient averages when the only movement is in the current month", () => {
    const isolated = createAnalyticsFixture();

    try {
      const category = storeCategory(isolated, "Casa", "expense", 0);
      storeTransaction(isolated, {
        category,
        amountMinor: 100,
        date: "2026-05-02",
        createdAt: 1_800_000_001_000,
        updatedAt: 1_800_000_001_000,
      });
      const isolatedAnalytics = createDashboardAnalytics({
        analytics: sqliteAnalyticsRepository,
        clock: new FixedClock(TODAY),
        snapshots: sqliteAnalyticsSnapshotRunner(isolated.connection),
      });

      expect(
        okValue(
          isolatedAnalytics.readAverages({ workspaceId: isolated.workspaceId }),
        ),
      ).toEqual({ kind: "insufficientHistory" });

      const evolution = okValue(
        isolatedAnalytics.readEvolution({ workspaceId: isolated.workspaceId }),
      );
      expect(evolution.kind).toBe("months");
      if (evolution.kind === "months") {
        expect(evolution.window.months).toEqual(["2026-05"]);
        expect(evolution.months[0].expenseMinor).toBe(100);
      }
    } finally {
      isolated.cleanup();
    }
  });
});

describe("negative presentation inputs", () => {
  it("feeds a negative half-cent average to presentation without rounding the stored total", () => {
    const isolated = createAnalyticsFixture();

    try {
      const expense = storeCategory(isolated, "Casa", "expense", 0);
      storeTransaction(isolated, {
        category: expense,
        amountMinor: 1,
        date: "2026-01-15",
        createdAt: 1_800_000_000_000,
        updatedAt: 1_800_000_000_000,
      });
      storeTransaction(isolated, {
        category: expense,
        amountMinor: 50_000,
        date: "2026-02-10",
        createdAt: 1_800_000_001_000,
        updatedAt: 1_800_000_001_000,
      });
      storeTransaction(isolated, {
        category: expense,
        amountMinor: 50_001,
        date: "2026-03-10",
        createdAt: 1_800_000_002_000,
        updatedAt: 1_800_000_002_000,
      });
      const isolatedAnalytics = createDashboardAnalytics({
        analytics: sqliteAnalyticsRepository,
        clock: new FixedClock("2026-04-15" as LocalDate),
        snapshots: sqliteAnalyticsSnapshotRunner(isolated.connection),
      });
      const averages = okValue(
        isolatedAnalytics.readAverages({ workspaceId: isolated.workspaceId }),
      );

      expect(averages.kind).toBe("months");
      if (averages.kind !== "months") {
        return;
      }

      expect(averages.net).toEqual({
        totalMinor: -100_001,
        monthCount: 2,
      });
      expect(
        presentAverageMinor(averages.net.totalMinor, averages.net.monthCount),
      ).toEqual({ ok: true, value: -50_001 });
    } finally {
      isolated.cleanup();
    }
  });
});

describe("read snapshot", () => {
  it("does not observe a movement another connection commits while the summary is open", () => {
    const config = loadAppConfig(
      createValidAppEnv(fixture.connection.filePath),
    );

    if (!config.ok) {
      throw new Error(
        `Expected valid configuration: ${JSON.stringify(config)}`,
      );
    }

    const writer = openSqliteConnection(config.value);

    if (!writer.ok) {
      throw new Error(
        `Expected a second connection: ${JSON.stringify(writer)}`,
      );
    }

    try {
      const snapshots = sqliteAnalyticsSnapshotRunner(fixture.connection);
      const observed = snapshots.runInSnapshot((unit) => {
        const first = sqliteAnalyticsRepository.readTypeTotals(unit, {
          workspaceId,
          range: { start: "2026-05-01" as LocalDate, end: TODAY },
        });

        writer.value.sqlite
          .prepare(
            'insert into "transaction" (id, workspace_id, type, amount_minor, date, category_id, concept, note, created_at, updated_at) values (?, ?, ?, ?, ?, ?, null, null, ?, ?)',
          )
          .run(
            "written-mid-snapshot",
            workspaceId,
            "expense",
            999,
            "2026-05-10",
            home.id,
            1_800_000_009_000,
            1_800_000_009_000,
          );

        const second = sqliteAnalyticsRepository.readRecentTransactions(unit, {
          workspaceId,
          limit: 5,
        });

        if (!first.ok || !second.ok) {
          throw new Error("Expected two accepted reads");
        }

        return {
          ok: true,
          value: {
            expenseMinor: first.value.expenseMinor,
            recentDates: second.value.map((movement) => movement.date),
          },
        };
      });

      const snapshot = okValue(observed);

      expect(snapshot.expenseMinor).toBe(1);
      expect(snapshot.recentDates).not.toContain("2026-05-10");
      expect(
        okValue(
          analytics.readSummary({
            workspaceId,
            period: { kind: "currentMonth" },
          }),
        ).totals.current.expenseMinor,
      ).toBe(1_000);
    } finally {
      writer.value.close();
    }
  });

  it("reports a storage failure when the snapshot cannot be opened", () => {
    const closed = createAnalyticsFixture();
    closed.connection.close();

    expect(
      errorCode(
        createDashboardAnalytics({
          analytics: sqliteAnalyticsRepository,
          clock: new FixedClock(TODAY),
          snapshots: sqliteAnalyticsSnapshotRunner(closed.connection),
        }).readEvolution({ workspaceId: closed.workspaceId }),
      ),
    ).toBe("storageFailure");

    closed.cleanup();
  });
});
