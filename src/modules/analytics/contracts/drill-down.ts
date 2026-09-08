/**
 * History filter that explains one dashboard figure.
 *
 * Every card, bar, month and average of the dashboard must be explainable by
 * the history it is made of, so each figure travels with the exact filter that
 * reproduces it. The descriptor uses the vocabulary of `GET /api/transactions`
 * and nothing else: an inclusive civil interval, an optional movement type, an
 * optional category, the tags of an OR filter and the untagged flag.
 *
 * The untagged group and a tag filter are mutually exclusive in the history, so
 * the tag part of a descriptor is a closed union instead of two independent
 * fields: a descriptor that asks for both cannot be built at all.
 */

import type { MonthKey } from "../../../shared/domain/dates";
import type { TransactionType } from "../../transactions/domain/transaction-type";
import { type DateRange, dateRangeOfMonthWindow } from "../domain/periods";

/** Tag part of a descriptor, mutually exclusive by construction. */
export type DrillDownTags =
  /** No tag condition at all. */
  | { readonly kind: "any" }
  /** Movements associated with one tag. */
  | { readonly kind: "tag"; readonly tagId: string }
  /** Movements with no tag association. */
  | { readonly kind: "untagged" };

/** Conditions a descriptor adds to its interval. */
export interface DrillDownSelection {
  readonly type?: TransactionType;
  readonly categoryId?: string;
  readonly tags?: DrillDownTags;
}

/**
 * History filter as the API returns it.
 *
 * `dateFrom` and `dateTo` are inclusive ISO civil dates, `tagIds` carries the
 * OR filter and is empty when there is none, and `untagged` is true only for
 * the computed group of expense without tags. A client turns the descriptor
 * into the query string of the history without adding or dropping conditions.
 */
export interface DrillDownDto {
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly type: TransactionType | null;
  readonly categoryId: string | null;
  readonly tagIds: readonly string[];
  readonly untagged: boolean;
}

function tagIdsOf(tags: DrillDownTags): readonly string[] {
  return tags.kind === "tag" ? [tags.tagId] : [];
}

/** Builds the descriptor of an interval with the conditions of one figure. */
export function toDrillDownDto(
  range: DateRange,
  selection: DrillDownSelection = {},
): DrillDownDto {
  const tags: DrillDownTags = selection.tags ?? { kind: "any" };

  return {
    dateFrom: range.start,
    dateTo: range.end,
    type: selection.type ?? null,
    categoryId: selection.categoryId ?? null,
    tagIds: tagIdsOf(tags),
    untagged: tags.kind === "untagged",
  };
}

/** Builds the descriptor of one natural month of a series. */
export function toMonthDrillDownDto(
  month: MonthKey,
  selection: DrillDownSelection = {},
): DrillDownDto {
  return toDrillDownDto(
    dateRangeOfMonthWindow({
      start: month,
      end: month,
      months: [month],
      monthCount: 1,
    }),
    selection,
  );
}
