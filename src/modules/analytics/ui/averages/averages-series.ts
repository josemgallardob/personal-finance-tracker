/**
 * Monthly averages, turned into the figures the interface paints.
 *
 * An average arrives as its exact sum in minor units and the month divisor it
 * belongs to. The division happens here, once, at presentation time, rounding
 * to the nearest cent with halves moving away from zero — negative balances
 * included. Nothing in the interface adds up averages that have already been
 * rounded: every figure comes from its own exact sum, which is why the two
 * category averages of the accepted example may add up to one cent more than
 * the total average without either of them being wrong.
 */

import {
  presentAverageMinor,
  type MoneyMinor,
} from "../../../../shared/domain/money";
import type {
  CategoryAverageDto,
  ExactAverageDto,
  TagAverageDto,
} from "../../contracts/averages";
import type { MonthWindowDto } from "../../contracts/evolution";
import type { BreakdownBar } from "../charts/chart-series";
import { dashboardCopy } from "../dashboard-copy";
import { formatMonthKeyAsSpanish } from "../dashboard-period";
import {
  drillDownHistoryHref,
  signedSummaryAmount,
  summaryAmount,
} from "../summary-presentation";
import { UNTAGGED_SERIES_ID } from "../series/series-selection";

/** Widest bar of a breakdown, as a percentage of its own track. */
const FULL_BAR_WIDTH = 100;

/**
 * Exact average rounded to the cent, or null when it cannot be represented.
 *
 * A divisor of zero never reaches this from a window of closed months, and a
 * sum too large to divide exactly is a broken contract rather than a figure to
 * approximate, so both report that there is no average to paint.
 */
export function presentedAverageMinor(average: ExactAverageDto): number | null {
  const presented = presentAverageMinor(
    average.totalMinor as MoneyMinor,
    average.monthCount,
  );

  return presented.ok ? presented.value : null;
}

/** EUR copy of one average, unsigned, or the unavailable copy. */
export function averageAmountLabel(average: ExactAverageDto): string {
  const minor = presentedAverageMinor(average);

  return minor === null
    ? dashboardCopy.unavailableAverage
    : summaryAmount(minor);
}

/** EUR copy of one average that may be negative, with a visible sign. */
export function signedAverageAmountLabel(average: ExactAverageDto): string {
  const minor = presentedAverageMinor(average);

  return minor === null
    ? dashboardCopy.unavailableAverage
    : signedSummaryAmount(minor);
}

/** Window copy of the averages: its months and how many they are. */
export function averagesWindowLabel(window: MonthWindowDto): string {
  return dashboardCopy.averagesWindow(
    formatMonthKeyAsSpanish(window.start),
    formatMonthKeyAsSpanish(window.end),
    window.monthCount,
  );
}

function barWidth(minor: number, largest: number): number {
  if (largest <= 0) {
    return 0;
  }

  return Math.min(
    FULL_BAR_WIDTH,
    Math.round((minor * FULL_BAR_WIDTH) / largest),
  );
}

interface AverageEntry {
  readonly id: string;
  readonly label: string;
  readonly archived: boolean;
  /** Movements behind the average, or null when the group does not count them. */
  readonly transactionCount: number | null;
  readonly average: ExactAverageDto;
}

/**
 * Bars of one averaged breakdown.
 *
 * A group whose average rounds to nothing draws no bar: the window contains no
 * money for it, and an empty bar would say less than its absence.
 */
function averageBars(
  entries: readonly AverageEntry[],
): readonly BreakdownBar[] {
  const drawn: { readonly entry: AverageEntry; readonly minor: number }[] = [];

  for (const entry of entries) {
    const minor = presentedAverageMinor(entry.average);

    if (minor === null || minor === 0) {
      continue;
    }

    drawn.push({ entry, minor });
  }

  const largest = drawn.reduce(
    (widest, item) => Math.max(widest, item.minor),
    0,
  );

  return drawn.map(({ entry, minor }) => ({
    id: entry.id,
    label: entry.label,
    totalMinor: minor,
    amountLabel: summaryAmount(minor),
    transactionCount: entry.transactionCount ?? 0,
    countLabel:
      entry.transactionCount === null
        ? ""
        : dashboardCopy.movementCount(entry.transactionCount),
    shareLabel: null,
    widthPercent: barWidth(minor, largest),
    archived: entry.archived,
    href: drillDownHistoryHref(entry.average.drillDown),
  }));
}

/** Bars of the monthly average of expense by category. */
export function categoryAverageBars(
  entries: readonly CategoryAverageDto[],
): readonly BreakdownBar[] {
  return averageBars(
    entries.map((entry) => ({
      id: entry.category.id,
      label: entry.category.name,
      archived: entry.category.isArchived,
      transactionCount: entry.transactionCount,
      average: entry,
    })),
  );
}

/**
 * Bars of the monthly average of expense by tag, plus the untagged group.
 *
 * The tag groups overlap, so their averages do not add up to the average of the
 * total expense, and no bar states a percentage.
 */
export function tagAverageBars(
  entries: readonly TagAverageDto[],
  untagged: ExactAverageDto,
): readonly BreakdownBar[] {
  return averageBars([
    ...entries.map((entry) => ({
      id: entry.tag.id,
      label: entry.tag.name,
      archived: entry.tag.isArchived,
      transactionCount: entry.transactionCount,
      average: entry,
    })),
    {
      id: UNTAGGED_SERIES_ID,
      label: dashboardCopy.untagged,
      archived: false,
      transactionCount: null,
      average: untagged,
    },
  ]);
}
