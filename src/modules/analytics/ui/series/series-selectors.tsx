"use client";

/**
 * Compact selectors of the drawn series.
 *
 * Each dimension has one selector, and it is the same control in the
 * distribution of the period and in the monthly average of that dimension:
 * choosing there changes only which bars of both blocks are drawn, never a
 * total, an average or the history a figure opens.
 *
 * Archived classifications are offered as archived and selectable, because
 * their amounts already count in the figures and the owner must be able to see
 * the bar they form. The panel applies on demand, so browsing a long list never
 * repaints the charts under the reader.
 */

import {
  MultiSelect,
  type MultiSelectOption,
} from "../../../../shared/ui/multi-select";
import { dashboardCopy } from "../dashboard-copy";

export interface SeriesSelectorProps {
  readonly onChange: (selectedIds: readonly string[]) => void;
  readonly options: readonly MultiSelectOption[];
  readonly value: readonly string[];
}

/** Selector shared by the category distribution and the category average. */
export function CategorySeriesSelector({
  onChange,
  options,
  value,
}: SeriesSelectorProps) {
  return (
    <MultiSelect
      archivedBehavior="selectable"
      mode="apply"
      onChange={onChange}
      options={options}
      title={dashboardCopy.categorySelectorTitle}
      triggerLabel={dashboardCopy.categorySelectorTrigger}
      value={value}
    />
  );
}

/** Selector shared by the tag distribution and the tag average. */
export function TagSeriesSelector({
  onChange,
  options,
  value,
}: SeriesSelectorProps) {
  return (
    <MultiSelect
      archivedBehavior="selectable"
      mode="apply"
      onChange={onChange}
      options={options}
      title={dashboardCopy.tagSelectorTitle}
      triggerLabel={dashboardCopy.tagSelectorTrigger}
      value={value}
    />
  );
}
