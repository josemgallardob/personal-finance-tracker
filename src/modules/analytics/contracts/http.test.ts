/**
 * Public analytics schemas.
 *
 * The schemas are the gate a browser response has to pass, so the suite pins
 * that a documented DTO survives untouched and that the three contract
 * violations a dashboard must never render are refused: an unknown member, an
 * amount that is not an exact integer of minor units, and a discriminated
 * union answered with a shape that belongs to the other member.
 */

import { describe, expect, it } from "vitest";

import type { MonthlyAveragesDto } from "./averages";
import type { MonthlyEvolutionDto } from "./evolution";
import type { DashboardSummaryDto } from "./summary";
import {
  dashboardSummaryDtoSchema,
  drillDownDtoSchema,
  monthlyAveragesDtoSchema,
  monthlyEvolutionDtoSchema,
} from "./http";
import { summary } from "../ui/dashboard-fixtures";

const monthWindow = {
  start: "2025-10",
  end: "2026-09",
  months: ["2025-10", "2026-09"],
  monthCount: 12,
  range: { start: "2025-10-01", end: "2026-09-30" },
};

const drillDown = {
  dateFrom: "2026-09-01",
  dateTo: "2026-09-30",
  type: null,
  categoryId: null,
  tagIds: [],
  untagged: false,
};

const evolution: MonthlyEvolutionDto = {
  kind: "months",
  window: monthWindow,
  months: [
    {
      month: "2026-09",
      incomeMinor: 250000,
      expenseMinor: 120050,
      incomeCount: 1,
      expenseCount: 3,
      drillDown,
      incomeDrillDown: { ...drillDown, type: "income" },
      expenseDrillDown: { ...drillDown, type: "expense" },
    },
  ],
};

const averages: MonthlyAveragesDto = {
  kind: "months",
  context: { window: monthWindow, monthCount: 12 },
  totalExpense: { totalMinor: 120050, monthCount: 12, drillDown },
  net: { totalMinor: 129950, monthCount: 12, drillDown },
  byCategory: [
    {
      totalMinor: 60000,
      monthCount: 12,
      drillDown,
      category: {
        id: "cat-food",
        name: "Alimentación",
        type: "expense",
        isArchived: false,
      },
      transactionCount: 24,
    },
  ],
  byTag: [
    {
      totalMinor: 30000,
      monthCount: 12,
      drillDown,
      tag: { id: "tag-trips", name: "Viajes", isArchived: false },
      transactionCount: 6,
    },
  ],
  untagged: { totalMinor: 1000, monthCount: 12, drillDown },
  overlapping: true,
};

describe("dashboardSummaryDtoSchema", () => {
  it("keeps a documented summary exactly as the API returned it", () => {
    const parsed: DashboardSummaryDto =
      dashboardSummaryDtoSchema.parse(summary);

    expect(parsed).toEqual(summary);
  });

  it("refuses a summary that carries a member the contract does not document", () => {
    const result = dashboardSummaryDtoSchema.safeParse({
      ...summary,
      averageMinor: 1000,
    });

    expect(result.success).toBe(false);
  });

  it("refuses an amount that is not an exact integer of minor units", () => {
    const result = dashboardSummaryDtoSchema.safeParse({
      ...summary,
      totals: {
        ...summary.totals,
        current: { ...summary.totals.current, expenseMinor: 1200.5 },
      },
    });

    expect(result.success).toBe(false);
  });

  it("accepts a change without comparison base and its stated reason", () => {
    const parsed = dashboardSummaryDtoSchema.parse({
      ...summary,
      totals: {
        ...summary.totals,
        income: {
          currentMinor: 250000,
          previousMinor: 0,
          deltaMinor: 250000,
          deltaPercent: null,
          reason: "noComparisonBase",
        },
      },
    });

    expect(parsed.totals.income).toEqual({
      currentMinor: 250000,
      previousMinor: 0,
      deltaMinor: 250000,
      deltaPercent: null,
      reason: "noComparisonBase",
    });
  });

  it("refuses a tag breakdown that denies the overlapping contract", () => {
    const result = dashboardSummaryDtoSchema.safeParse({
      ...summary,
      expenseByTag: { ...summary.expenseByTag, overlapping: false },
    });

    expect(result.success).toBe(false);
  });
});

describe("drillDownDtoSchema", () => {
  it("accepts the descriptor of the computed untagged group", () => {
    expect(drillDownDtoSchema.parse({ ...drillDown, untagged: true })).toEqual({
      ...drillDown,
      untagged: true,
    });
  });

  it("refuses a tag filter that is not a list of identifiers", () => {
    const result = drillDownDtoSchema.safeParse({
      ...drillDown,
      tagIds: "tag-trips",
    });

    expect(result.success).toBe(false);
  });
});

describe("monthlyEvolutionDtoSchema", () => {
  it("accepts an empty series and a series of months", () => {
    expect(monthlyEvolutionDtoSchema.parse({ kind: "empty" })).toEqual({
      kind: "empty",
    });
    expect(monthlyEvolutionDtoSchema.parse(evolution)).toEqual(evolution);
  });

  it("refuses an empty series that still carries months", () => {
    const result = monthlyEvolutionDtoSchema.safeParse({
      kind: "empty",
      months: [],
    });

    expect(result.success).toBe(false);
  });
});

describe("monthlyAveragesDtoSchema", () => {
  it("accepts insufficient history and a window of closed months", () => {
    expect(
      monthlyAveragesDtoSchema.parse({ kind: "insufficientHistory" }),
    ).toEqual({ kind: "insufficientHistory" });
    expect(monthlyAveragesDtoSchema.parse(averages)).toEqual(averages);
  });

  it("refuses a window whose month count is not an integer", () => {
    const result = monthlyAveragesDtoSchema.safeParse({
      ...averages,
      context: { window: monthWindow, monthCount: 11.5 },
    });

    expect(result.success).toBe(false);
  });
});
