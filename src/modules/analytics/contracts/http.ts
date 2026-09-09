/**
 * Public HTTP schemas of the dashboard analytics.
 *
 * The response shapes live here so the browser client validates exactly the
 * representation the route handlers document. The module imports the calendar
 * vocabulary of the module and nothing else: no application service, no SQLite
 * and no `server-only` code, so a client that reads these schemas cannot pull
 * persistence into the bundle.
 *
 * Every amount stays an exact integer of minor units and every percentage stays
 * in hundredths of a percent. Nothing is rounded, formatted or turned into a
 * string here; the presentation layer owns that.
 */

import { z } from "zod";

import {
  transactionDtoSchema,
  transactionTypeSchema,
} from "../../transactions/contracts/http";
import {
  categoryDtoSchema,
  tagDtoSchema,
} from "../../classification/contracts/http";
import { DASHBOARD_PERIOD_KINDS } from "../domain/periods";

/** Period identifier, as the wire contract names it. */
export const dashboardPeriodKindSchema = z.enum(DASHBOARD_PERIOD_KINDS);

/**
 * Query of GET /api/analytics/summary.
 *
 * `period` is always sent: the server refuses a missing selection instead of
 * defaulting, so the cards can never disagree with the selector that produced
 * them. `from` and `to` are natural months and belong to `customMonthRange`
 * alone; the server refuses them for any other period.
 */
export interface DashboardSummaryQuery {
  readonly period: z.infer<typeof dashboardPeriodKindSchema>;
  readonly from?: string;
  readonly to?: string;
}

/** History filter that reproduces one dashboard figure. */
export const drillDownDtoSchema = z.strictObject({
  dateFrom: z.string(),
  dateTo: z.string(),
  type: transactionTypeSchema.nullable(),
  categoryId: z.string().nullable(),
  tagIds: z.array(z.string()),
  untagged: z.boolean(),
});

/** Inclusive interval of civil dates. */
export const dateRangeDtoSchema = z.strictObject({
  start: z.string(),
  end: z.string(),
});

/** The two intervals a comparison really contrasts. */
export const comparisonWindowDtoSchema = z.strictObject({
  current: dateRangeDtoSchema,
  previous: dateRangeDtoSchema,
});

/** Period the response was aggregated over, echoed back to the client. */
export const dashboardPeriodDtoSchema = z.strictObject({
  kind: dashboardPeriodKindSchema,
  from: z.string().nullable(),
  to: z.string().nullable(),
});

/** Income, expense and net of one interval. */
export const periodTotalsDtoSchema = z.strictObject({
  incomeMinor: z.number().int(),
  expenseMinor: z.number().int(),
  netMinor: z.number().int(),
  incomeCount: z.number().int(),
  expenseCount: z.number().int(),
});

/**
 * Change of one figure against the equivalent previous interval.
 *
 * `deltaPercent` is hundredths of a percent and is null only when there is no
 * comparison base; `reason` then says so.
 */
export const comparisonDeltaDtoSchema = z.strictObject({
  currentMinor: z.number().int(),
  previousMinor: z.number().int(),
  deltaMinor: z.number().int(),
  deltaPercent: z.number().int().nullable(),
  reason: z.string().nullable(),
});

/** Totals of the selected interval contrasted with the previous one. */
export const comparedPeriodTotalsDtoSchema = z.strictObject({
  current: periodTotalsDtoSchema,
  previous: periodTotalsDtoSchema,
  income: comparisonDeltaDtoSchema,
  expense: comparisonDeltaDtoSchema,
  net: comparisonDeltaDtoSchema,
});

/** History filters of the three cards of the selected period. */
export const summaryDrillDownsDtoSchema = z.strictObject({
  income: drillDownDtoSchema,
  expense: drillDownDtoSchema,
  net: drillDownDtoSchema,
});

/** Expense one category accumulated over the interval. */
export const categoryExpenseDtoSchema = z.strictObject({
  category: categoryDtoSchema,
  totalMinor: z.number().int(),
  transactionCount: z.number().int(),
  drillDown: drillDownDtoSchema,
});

/** Expense one tag accumulated over the interval. */
export const tagExpenseDtoSchema = z.strictObject({
  tag: tagDtoSchema,
  totalMinor: z.number().int(),
  transactionCount: z.number().int(),
  drillDown: drillDownDtoSchema,
});

/** Expense of the interval that carries no tag at all. */
export const untaggedExpenseDtoSchema = z.strictObject({
  totalMinor: z.number().int(),
  transactionCount: z.number().int(),
  drillDown: drillDownDtoSchema,
});

/**
 * Expense by tag, plus the computed untagged group.
 *
 * `overlapping` is always true and states the contract: the whole amount of a
 * movement is attributed to each of its tags, so the groups intersect.
 */
export const tagExpenseBreakdownDtoSchema = z.strictObject({
  tags: z.array(tagExpenseDtoSchema),
  untagged: untaggedExpenseDtoSchema,
  overlapping: z.literal(true),
});

/** Summary as GET /api/analytics/summary returns it. */
export const dashboardSummaryDtoSchema = z.strictObject({
  period: dashboardPeriodDtoSchema,
  range: dateRangeDtoSchema,
  comparison: comparisonWindowDtoSchema,
  totals: comparedPeriodTotalsDtoSchema,
  drillDowns: summaryDrillDownsDtoSchema,
  expenseByCategory: z.array(categoryExpenseDtoSchema),
  expenseByTag: tagExpenseBreakdownDtoSchema,
  recentTransactions: z.array(transactionDtoSchema),
});

/** Consecutive natural months of a window. */
export const monthWindowDtoSchema = z.strictObject({
  start: z.string(),
  end: z.string(),
  months: z.array(z.string()),
  monthCount: z.number().int(),
  range: dateRangeDtoSchema,
});

/** Totals of one natural month of the evolution series. */
export const monthlyTotalsDtoSchema = z.strictObject({
  month: z.string(),
  incomeMinor: z.number().int(),
  expenseMinor: z.number().int(),
  incomeCount: z.number().int(),
  expenseCount: z.number().int(),
  drillDown: drillDownDtoSchema,
  incomeDrillDown: drillDownDtoSchema,
  expenseDrillDown: drillDownDtoSchema,
});

/** Monthly evolution as GET /api/analytics/evolution returns it. */
export const monthlyEvolutionDtoSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("empty") }),
  z.strictObject({
    kind: z.literal("months"),
    window: monthWindowDtoSchema,
    months: z.array(monthlyTotalsDtoSchema),
  }),
]);

/** Window the averages divide by, with its real interval. */
export const averagesContextDtoSchema = z.strictObject({
  window: monthWindowDtoSchema,
  monthCount: z.number().int(),
});

/** One average, kept as its exact sum and its divisor. */
export const exactAverageDtoSchema = z.strictObject({
  totalMinor: z.number().int(),
  monthCount: z.number().int(),
  drillDown: drillDownDtoSchema,
});

/** Average expense of one category over the window. */
export const categoryAverageDtoSchema = z.strictObject({
  totalMinor: z.number().int(),
  monthCount: z.number().int(),
  drillDown: drillDownDtoSchema,
  category: categoryDtoSchema,
  transactionCount: z.number().int(),
});

/** Average expense of one tag over the window. */
export const tagAverageDtoSchema = z.strictObject({
  totalMinor: z.number().int(),
  monthCount: z.number().int(),
  drillDown: drillDownDtoSchema,
  tag: tagDtoSchema,
  transactionCount: z.number().int(),
});

/** Monthly averages as GET /api/analytics/averages returns them. */
export const monthlyAveragesDtoSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("insufficientHistory") }),
  z.strictObject({
    kind: z.literal("months"),
    context: averagesContextDtoSchema,
    totalExpense: exactAverageDtoSchema,
    net: exactAverageDtoSchema,
    byCategory: z.array(categoryAverageDtoSchema),
    byTag: z.array(tagAverageDtoSchema),
    untagged: exactAverageDtoSchema,
    overlapping: z.literal(true),
  }),
]);
