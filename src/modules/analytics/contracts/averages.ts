/**
 * Public monthly averages representation of the dashboard API.
 *
 * An average never travels as a figure that has already been rounded: it
 * carries its exact sum in minor units and the month divisor it must be divided
 * by, so no client ever adds up rounded averages to obtain a total. Rounding to
 * the nearest cent, with halves moving away from zero, happens only when a
 * figure is painted.
 *
 * The window is the context of every divisor and travels with the response —
 * its months, how many they are and the interval they cover — because the
 * averages use a window of closed months that is independent of the period
 * selected on the dashboard. When no natural month has closed since the first
 * movement the response is `insufficientHistory`, which is not the same as a
 * window whose months are all zero: the former has no divisor at all.
 */

import {
  toCategoryDto,
  toTagDto,
  type CategoryDto,
  type TagDto,
} from "../../classification/contracts";
import type {
  CategoryExactAverage,
  ExactAverage,
  MonthlyAverages,
  TagExactAverage,
} from "../application/dashboard-analytics";
import { dateRangeOfMonthWindow, type MonthWindow } from "../domain/periods";
import { toDrillDownDto, type DrillDownDto } from "./drill-down";
import { toMonthWindowDto, type MonthWindowDto } from "./evolution";

/**
 * Context every average of the response was computed in.
 *
 * `monthCount` is repeated here on purpose: it is the divisor shared by the
 * global averages and by every group, and a client must be able to state it
 * without walking into one of the groups.
 */
export interface AveragesContextDto {
  readonly window: MonthWindowDto;
  readonly monthCount: number;
}

/** Exact average: the numerator and the divisor, never a rounded figure. */
export interface ExactAverageDto {
  readonly totalMinor: number;
  readonly monthCount: number;
  readonly drillDown: DrillDownDto;
}

/** Average of one category over the window, still carrying its identity. */
export interface CategoryAverageDto extends ExactAverageDto {
  readonly category: CategoryDto;
  readonly transactionCount: number;
}

/** Average of one overlapping tag group over the window. */
export interface TagAverageDto extends ExactAverageDto {
  readonly tag: TagDto;
  readonly transactionCount: number;
}

/**
 * Monthly averages as the API returns them.
 *
 * `overlapping` states that the tag groups intersect: the whole amount of a
 * movement is attributed to each of its tags, so their averages do not add up
 * to the average of the total expense.
 */
export type MonthlyAveragesDto =
  | { readonly kind: "insufficientHistory" }
  | {
      readonly kind: "months";
      readonly context: AveragesContextDto;
      readonly totalExpense: ExactAverageDto;
      readonly net: ExactAverageDto;
      readonly byCategory: readonly CategoryAverageDto[];
      readonly byTag: readonly TagAverageDto[];
      readonly untagged: ExactAverageDto;
      readonly overlapping: true;
    };

/** Maps the shared context of the averages of one response. */
export function toAveragesContextDto(window: MonthWindow): AveragesContextDto {
  return {
    window: toMonthWindowDto(window),
    monthCount: window.monthCount,
  };
}

function toExactAverageDto(
  average: ExactAverage,
  drillDown: DrillDownDto,
): ExactAverageDto {
  return {
    totalMinor: average.totalMinor,
    monthCount: average.monthCount,
    drillDown,
  };
}

function toCategoryAverageDto(
  average: CategoryExactAverage,
  drillDown: DrillDownDto,
): CategoryAverageDto {
  return {
    ...toExactAverageDto(average, drillDown),
    category: toCategoryDto(average.category),
    transactionCount: average.transactionCount,
  };
}

function toTagAverageDto(
  average: TagExactAverage,
  drillDown: DrillDownDto,
): TagAverageDto {
  return {
    ...toExactAverageDto(average, drillDown),
    tag: toTagDto(average.tag),
    transactionCount: average.transactionCount,
  };
}

/** Maps the monthly averages to the documented HTTP representation. */
export function toMonthlyAveragesDto(
  averages: MonthlyAverages,
): MonthlyAveragesDto {
  if (averages.kind === "insufficientHistory") {
    return { kind: "insufficientHistory" };
  }

  const range = dateRangeOfMonthWindow(averages.window);

  return {
    kind: "months",
    context: toAveragesContextDto(averages.window),
    totalExpense: toExactAverageDto(
      averages.totalExpense,
      toDrillDownDto(range, { type: "expense" }),
    ),
    net: toExactAverageDto(averages.net, toDrillDownDto(range)),
    byCategory: averages.byCategory.map((entry) =>
      toCategoryAverageDto(
        entry,
        toDrillDownDto(range, {
          type: "expense",
          categoryId: entry.category.id,
        }),
      ),
    ),
    byTag: averages.byTag.map((entry) =>
      toTagAverageDto(
        entry,
        toDrillDownDto(range, {
          type: "expense",
          tags: { kind: "tag", tagId: entry.tag.id },
        }),
      ),
    ),
    untagged: toExactAverageDto(
      averages.untagged,
      toDrillDownDto(range, { type: "expense", tags: { kind: "untagged" } }),
    ),
    overlapping: true,
  };
}
