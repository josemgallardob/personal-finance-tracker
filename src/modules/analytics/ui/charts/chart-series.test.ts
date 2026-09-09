/**
 * Series behind the dashboard charts and their tables.
 *
 * The suite pins the rules the drawings must not be able to break: the
 * evolution series depends only on its own window, the category groups add up
 * to the expense of the period and may state a share of it, the tag groups
 * overlap and therefore may not, and the computed untagged group appears only
 * when the period really contains expense without tags.
 */

import { describe, expect, it } from "vitest";

import type { MonthlyEvolutionDto } from "../../contracts/evolution";
import type { TagExpenseBreakdownDto } from "../../contracts/summary";
import { dashboardCopy } from "../dashboard-copy";
import {
  evolution,
  expenseByCategory,
  expenseByTag,
  summary,
  totals,
} from "../dashboard-fixtures";
import {
  UNTAGGED_BAR_ID,
  expenseCategoryBars,
  expenseTagBars,
  incomeExpenseBars,
  monthlyTrendPoints,
  monthlyTrendWindowLabel,
} from "./chart-series";

/** Replaces the narrow no-break spaces produced by Intl with plain spaces. */
function withPlainSpaces(text: string | null): string {
  return (text ?? "").replace(/[\u202f\u00a0]/g, " ");
}

const emptyEvolution: MonthlyEvolutionDto = { kind: "empty" };

describe("monthlyTrendPoints", () => {
  it("maps every month of the window, keeping an empty month at zero", () => {
    const points = monthlyTrendPoints(evolution);

    expect(points).toHaveLength(3);
    expect(points.map((point) => point.label)).toEqual([
      "07/2026",
      "08/2026",
      "09/2026",
    ]);
    expect(withPlainSpaces(points[1].incomeLabel)).toBe("0,00 €");
    expect(withPlainSpaces(points[1].expenseLabel)).toBe("0,00 €");
    expect(withPlainSpaces(points[2].expenseLabel)).toBe("1200,50 €");
  });

  it("opens the history of the month and of each of its two series", () => {
    const [july] = monthlyTrendPoints(evolution);

    expect(july.href).toBe(
      "/transactions?dateFrom=2026-07-01&dateTo=2026-07-31&tab=all",
    );
    expect(july.incomeHref).toContain("type=income");
    expect(july.expenseHref).toContain("type=expense");
  });

  it("produces no point at all when the workspace has no movement", () => {
    expect(monthlyTrendPoints(emptyEvolution)).toEqual([]);
  });

  it("states the window of the series, which the period cannot change", () => {
    expect(
      monthlyTrendWindowLabel(
        evolution.kind === "months"
          ? evolution.window
          : {
              start: "",
              end: "",
              months: [],
              monthCount: 0,
              range: { start: "", end: "" },
            },
      ),
    ).toBe("07/2026–09/2026 · 3 meses");
  });

  it("names a window of a single month in the singular", () => {
    expect(
      monthlyTrendWindowLabel({
        start: "2026-09",
        end: "2026-09",
        months: ["2026-09"],
        monthCount: 1,
        range: { start: "2026-09-01", end: "2026-09-30" },
      }),
    ).toBe("09/2026–09/2026 · 1 mes");
  });
});

describe("incomeExpenseBars", () => {
  it("names both intervals and carries their exact figures", () => {
    const bars = incomeExpenseBars(totals, summary.comparison);

    expect(bars.map((bar) => bar.key)).toEqual(["current", "previous"]);
    expect(bars[0].rangeLabel).toBe("01/09/2026 – 08/09/2026");
    expect(withPlainSpaces(bars[0].incomeLabel)).toBe("2500,00 €");
    expect(withPlainSpaces(bars[1].expenseLabel)).toBe("1500,00 €");
    expect(bars[1].incomeMinor).toBe(200000);
  });
});

describe("expenseCategoryBars", () => {
  it("states the share of the period expense of every disjoint group", () => {
    const bars = expenseCategoryBars(expenseByCategory, 120050);

    expect(withPlainSpaces(bars[0].shareLabel)).toBe("74,97 % del gasto");
    expect(withPlainSpaces(bars[1].shareLabel)).toBe("25,03 % del gasto");
    expect(bars[0].countLabel).toBe(dashboardCopy.movementCount(2));
  });

  it("scales every bar against the largest amount of the breakdown", () => {
    const bars = expenseCategoryBars(expenseByCategory, 120050);

    expect(bars[0].widthPercent).toBe(100);
    expect(bars[1].widthPercent).toBe(33);
  });

  it("keeps an archived category that still has an amount in the window", () => {
    const bars = expenseCategoryBars(expenseByCategory, 120050);

    expect(bars[1]).toMatchObject({ label: "Antigua", archived: true });
    expect(bars[1].href).toContain("categoryId=cat-old");
  });

  it("draws no bar for a category without any amount in the period", () => {
    const bars = expenseCategoryBars(
      [
        { ...expenseByCategory[0], totalMinor: 0, transactionCount: 0 },
        expenseByCategory[1],
      ],
      30050,
    );

    expect(bars.map((bar) => bar.id)).toEqual(["cat-old"]);
  });

  it("states no share when the period has no expense to divide by", () => {
    const bars = expenseCategoryBars([expenseByCategory[0]], 0);

    expect(bars[0].shareLabel).toBeNull();
    expect(bars[0].widthPercent).toBe(100);
  });

  it("states no share and no width when the exact percentage is not representable", () => {
    const bars = expenseCategoryBars(
      [{ ...expenseByCategory[0], totalMinor: Number.MAX_SAFE_INTEGER }],
      120050,
    );

    expect(bars[0].shareLabel).toBeNull();
    expect(bars[0].widthPercent).toBe(0);
  });

  it("draws no width for an amount the contract should never have sent", () => {
    const bars = expenseCategoryBars(
      [{ ...expenseByCategory[0], totalMinor: -100 }],
      120050,
    );

    expect(bars[0].widthPercent).toBe(0);
  });

  it("keeps a long category name whole instead of shortening it", () => {
    const name =
      "Suscripciones, planes de ocio y otros gastos recurrentes del hogar";
    const bars = expenseCategoryBars(
      [
        {
          ...expenseByCategory[0],
          category: { ...expenseByCategory[0].category, name },
        },
      ],
      120050,
    );

    expect(bars[0].label).toBe(name);
  });
});

describe("expenseTagBars", () => {
  it("never states a percentage, because the groups overlap", () => {
    const bars = expenseTagBars(expenseByTag);

    expect(bars.every((bar) => bar.shareLabel === null)).toBe(true);
    expect(
      bars.reduce((total, bar) => total + bar.totalMinor, 0),
    ).toBeGreaterThan(120050);
  });

  it("adds the computed untagged group when the period has untagged expense", () => {
    const bars = expenseTagBars(expenseByTag);
    const untagged = bars.at(-1);

    expect(bars).toHaveLength(3);
    expect(untagged).toMatchObject({
      id: UNTAGGED_BAR_ID,
      label: dashboardCopy.untagged,
      archived: false,
    });
    expect(withPlainSpaces(untagged?.amountLabel ?? null)).toBe("400,50 €");
    // The group opens the history on its own mutually exclusive filter.
    expect(untagged?.href).toContain("untagged=true");
    expect(untagged?.href).not.toContain("tagId=");
  });

  it("omits the untagged group when every expense of the period is tagged", () => {
    const breakdown: TagExpenseBreakdownDto = {
      ...expenseByTag,
      untagged: {
        totalMinor: 0,
        transactionCount: 0,
        drillDown: expenseByTag.untagged.drillDown,
      },
    };

    const bars = expenseTagBars(breakdown);

    expect(bars.map((bar) => bar.id)).toEqual(["tag-trips", "tag-old"]);
  });

  it("marks an archived tag and scales the bars against the largest group", () => {
    const bars = expenseTagBars(expenseByTag);

    expect(bars[1]).toMatchObject({ label: "Vieja", archived: true });
    expect(bars.map((bar) => bar.widthPercent)).toEqual([100, 25, 50]);
  });

  it("produces nothing when the period has no expense by tag at all", () => {
    expect(
      expenseTagBars({
        tags: [],
        untagged: {
          totalMinor: 0,
          transactionCount: 0,
          drillDown: expenseByTag.untagged.drillDown,
        },
        overlapping: true,
      }),
    ).toEqual([]);
  });
});
