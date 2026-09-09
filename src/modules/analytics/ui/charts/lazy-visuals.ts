"use client";

/**
 * Lazy access to the chart library.
 *
 * The drawings are loaded in the browser only, and only once the section that
 * uses one is on screen, so the first load of the dashboard carries the cards,
 * the comparison and the tables without the chart library behind them. Server
 * rendering is disabled because the drawings measure their container before
 * they can size themselves, and nothing is lost: every value they show is
 * already published as a table or a list in the same section.
 */

import dynamic from "next/dynamic";

/** Line series of the monthly evolution. */
export const LazyMonthlyTrendVisual = dynamic(
  () => import("./chart-visuals").then((module) => module.MonthlyTrendVisual),
  { ssr: false },
);

/** Grouped bars of income against expense in the compared intervals. */
export const LazyIncomeExpenseComparisonVisual = dynamic(
  () =>
    import("./chart-visuals").then(
      (module) => module.IncomeExpenseComparisonVisual,
    ),
  { ssr: false },
);

/** Horizontal bars of one expense breakdown. */
export const LazyBreakdownBarsVisual = dynamic(
  () => import("./chart-visuals").then((module) => module.BreakdownBarsVisual),
  { ssr: false },
);
