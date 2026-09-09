/**
 * Period selection of the dashboard cards.
 *
 * The selection lives in the interface, never in the URL: the history owns the
 * query string, so filtering movements between two arbitrary days cannot move
 * the monthly period the cards are aggregated over, and returning from the
 * history leaves the dashboard exactly as it was.
 *
 * The four presets carry no month at all. A custom range carries two natural
 * months, both of them complete and inclusive, and is rejected here before it
 * can become a request the server would refuse.
 */

import { encodeApiQuery } from "../../../shared/client/query";
import { compareMonthKeys, parseMonthKey } from "../../../shared/domain/dates";
import type { MonthKey } from "../../../shared/domain/dates";
import { summaryQueryParams } from "../client/analytics-api";
import type { DashboardSummaryQuery } from "../contracts/http";
import type { DashboardPeriod } from "../domain/periods";
import { dashboardCopy } from "./dashboard-copy";

/** Period the dashboard opens on, as the accepted design fixes it. */
export const DEFAULT_DASHBOARD_PERIOD: DashboardPeriod = {
  kind: "currentMonth",
};

/** Periods offered as a single control, in the documented order. */
export const DASHBOARD_PERIOD_PRESETS = [
  "currentMonth",
  "previousMonth",
  "lastThreeMonths",
  "currentYear",
] as const;

/** Identifier of a preset period. */
export type DashboardPeriodPreset = (typeof DASHBOARD_PERIOD_PRESETS)[number];

const PRESET_LABELS: Record<DashboardPeriodPreset, string> = {
  currentMonth: dashboardCopy.currentMonth,
  previousMonth: dashboardCopy.previousMonth,
  lastThreeMonths: dashboardCopy.lastThreeMonths,
  currentYear: dashboardCopy.currentYear,
};

/** Spanish label of one preset. */
export function dashboardPresetLabel(preset: DashboardPeriodPreset): string {
  return PRESET_LABELS[preset];
}

/** Spanish `mm/aaaa` text of a natural month, or the raw value if unparsable. */
export function formatMonthKeyAsSpanish(month: string): string {
  const parsed = parseMonthKey(month);

  if (!parsed.ok) {
    return month;
  }

  const [year, monthDigits] = parsed.value.split("-");
  return `${monthDigits}/${year}`;
}

/** Visible label of the selected period, months included for a custom range. */
export function dashboardPeriodLabel(period: DashboardPeriod): string {
  if (period.kind === "customMonthRange") {
    return dashboardCopy.rangeLabel(
      formatMonthKeyAsSpanish(period.from),
      formatMonthKeyAsSpanish(period.to),
    );
  }

  return dashboardPresetLabel(period.kind);
}

/** Documented query of the summary endpoint for the selected period. */
export function toDashboardSummaryQuery(
  period: DashboardPeriod,
): DashboardSummaryQuery {
  if (period.kind === "customMonthRange") {
    return { period: period.kind, from: period.from, to: period.to };
  }

  return { period: period.kind };
}

/**
 * Identity of the summary request.
 *
 * Changing it aborts the in-flight call and drops the representation of the
 * previous period, so a slower answer cannot paint over the current cards.
 */
export function dashboardPeriodRequestKey(period: DashboardPeriod): string {
  return `analytics:summary${encodeApiQuery(
    summaryQueryParams(toDashboardSummaryQuery(period)),
  )}`;
}

/** Month input values that pre-fill the range dialog for the current period. */
export function monthRangeInputValues(period: DashboardPeriod): {
  readonly from: string;
  readonly to: string;
} {
  if (period.kind === "customMonthRange") {
    return { from: period.from, to: period.to };
  }

  return { from: "", to: "" };
}

/** Accepted months of a custom range, or the message of each rejected bound. */
export type MonthRangeValidation =
  | {
      readonly ok: true;
      readonly from: MonthKey;
      readonly to: MonthKey;
    }
  | {
      readonly ok: false;
      readonly fromError: string | null;
      readonly toError: string | null;
    };

/** One bound of a range: the month it names, or why it was rejected. */
type MonthOutcome =
  | { readonly ok: true; readonly value: MonthKey }
  | { readonly ok: false; readonly error: string };

function readMonth(text: string): MonthOutcome {
  const trimmed = text.trim();

  if (trimmed === "") {
    return { ok: false, error: dashboardCopy.monthRequired };
  }

  const parsed = parseMonthKey(trimmed);

  if (!parsed.ok) {
    return { ok: false, error: dashboardCopy.monthInvalid };
  }

  return { ok: true, value: parsed.value };
}

/**
 * Validates the two bounds of a custom range.
 *
 * Both months are required and must be real natural months; when both are
 * wrong they are reported together so the form can mark both at once. A
 * reversed range is reported on the final month, which is the one the owner
 * just chose in the reading order of the dialog.
 */
export function validateMonthRange(
  fromText: string,
  toText: string,
): MonthRangeValidation {
  const from = readMonth(fromText);
  const to = readMonth(toText);

  if (!from.ok || !to.ok) {
    return {
      ok: false,
      fromError: from.ok ? null : from.error,
      toError: to.ok ? null : to.error,
    };
  }

  if (compareMonthKeys(from.value, to.value) > 0) {
    return { ok: false, fromError: null, toError: dashboardCopy.monthInverted };
  }

  return { ok: true, from: from.value, to: to.value };
}
