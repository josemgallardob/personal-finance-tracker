/**
 * Options each series selector offers.
 *
 * A selector lists every active classification of its dimension plus the
 * archived ones that really have an amount in one of the two windows it
 * controls, marked as archived. An archived classification without any amount
 * would be a name the owner can select to see nothing, so it is not offered at
 * all; one with an amount is offered because its money is already inside the
 * totals and the averages, and the owner must be able to see the bar it forms.
 *
 * The category selector offers expense categories only. Both breakdowns it
 * controls are made of expense, so an income category could never draw a bar
 * and would only make the list longer.
 *
 * The tag selector also offers the computed untagged group, which is not a
 * stored tag: it is listed only when the window really contains expense without
 * tags, and it is never archived.
 */

import type { CategoryDto } from "../../../classification/contracts/category";
import type { TagDto } from "../../../classification/contracts/tag";
import type { MultiSelectOption } from "../../../../shared/ui/multi-select";
import { dashboardCopy } from "../dashboard-copy";
import { UNTAGGED_SERIES_ID } from "./series-selection";

function offered<
  TItem extends { readonly id: string; readonly isArchived: boolean },
>(items: readonly TItem[], idsWithData: ReadonlySet<string>): readonly TItem[] {
  return items.filter((item) => !item.isArchived || idsWithData.has(item.id));
}

/** Options of the category selector, in the order of the catalog. */
export function categorySeriesOptions(
  categories: readonly CategoryDto[],
  idsWithData: ReadonlySet<string>,
): readonly MultiSelectOption[] {
  const expense = categories.filter((category) => category.type === "expense");

  return offered(expense, idsWithData).map((category) => ({
    id: category.id,
    label: category.name,
    archived: category.isArchived,
  }));
}

/** Options of the tag selector, plus the computed untagged group. */
export function tagSeriesOptions(
  tags: readonly TagDto[],
  idsWithData: ReadonlySet<string>,
  untaggedHasData: boolean,
): readonly MultiSelectOption[] {
  const options: MultiSelectOption[] = offered(tags, idsWithData).map(
    (tag) => ({
      id: tag.id,
      label: tag.name,
      archived: tag.isArchived,
    }),
  );

  if (!untaggedHasData) {
    return options;
  }

  return [
    ...options,
    { id: UNTAGGED_SERIES_ID, label: dashboardCopy.untagged, archived: false },
  ];
}

/** Identifiers that carry an amount in at least one of the given breakdowns. */
export function idsWithAmount(
  ...groups: readonly (readonly {
    readonly id: string;
    readonly totalMinor: number;
  }[])[]
): ReadonlySet<string> {
  const ids = new Set<string>();

  for (const group of groups) {
    for (const entry of group) {
      if (entry.totalMinor !== 0) {
        ids.add(entry.id);
      }
    }
  }

  return ids;
}
