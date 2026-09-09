/**
 * Presentation of the dashboard summary from the public analytics DTOs.
 *
 * Every figure arrives as an exact integer: minor units for money and
 * hundredths of a percent for a change. Nothing is divided as a floating-point
 * value here either; the digits are split and handed to the locale formatter,
 * which is what keeps 0,01 € and 25,00 % exact.
 *
 * Sign, word and colour always travel together. `+` and `−` are visible on
 * every signed figure and each amount is named by its concept, so a reader who
 * does not perceive the semantic green and red loses no meaning.
 */

import { historyPageHref } from "../../transactions/client/history-query-state";
import { HISTORY_ALL_TAB } from "../../transactions/ui/history-copy";
import { formatLocalDateAsSpanish } from "../../transactions/ui/transaction-form-schema";
import { parseLocalDate } from "../../../shared/domain/dates";
import {
  formatMoneyMinorAsEur,
  type MoneyMinor,
} from "../../../shared/domain/money";
import type { ComparisonDeltaDto, DateRangeDto } from "../contracts/summary";
import type { DrillDownDto } from "../contracts/drill-down";
import { dashboardCopy } from "./dashboard-copy";

/** Financial meaning of a figure, which drives colour and never replaces text. */
export type SummaryTone = "income" | "expense" | "neutral";

const percentFormatter = new Intl.NumberFormat("es-ES", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function asMoneyMinor(minor: number): MoneyMinor {
  return minor as MoneyMinor;
}

/** EUR copy of an exact amount of minor units. */
export function summaryAmount(minor: number): string {
  return formatMoneyMinorAsEur(asMoneyMinor(minor));
}

/**
 * EUR copy of a signed amount, with a visible `+` or `−`.
 *
 * Zero carries no sign: a balance of exactly zero is neither a gain nor a loss
 * and is reported as the neutral figure it is.
 */
export function signedSummaryAmount(minor: number): string {
  const amount = summaryAmount(asMoneyMinor(Math.abs(minor)));

  if (minor > 0) {
    return `+${amount}`;
  }

  if (minor < 0) {
    return `−${amount}`;
  }

  return amount;
}

/** Tone of a net balance: positive is income, negative expense, zero neutral. */
export function netTone(netMinor: number): SummaryTone {
  if (netMinor > 0) {
    return "income";
  }

  if (netMinor < 0) {
    return "expense";
  }

  return "neutral";
}

const TONE_CLASS_NAMES: Record<SummaryTone, string> = {
  income: "text-income",
  expense: "text-expense",
  neutral: "text-text",
};

/** Class that colours a figure according to its financial meaning. */
export function summaryToneClassName(tone: SummaryTone): string {
  return TONE_CLASS_NAMES[tone];
}

/**
 * Percentage copy of an exact value in hundredths of a percent.
 *
 * The integer is split into whole percent and hundredths, so `2500` is exactly
 * `+25,00 %` and `-50` is exactly `−0,50 %`. Zero keeps no sign.
 */
export function formatPercentHundredths(hundredths: number): string {
  const digits = Math.abs(hundredths).toString().padStart(3, "0");
  const units = Number(digits.slice(0, -2));
  const fraction = digits.slice(-2);
  const magnitude = percentFormatter
    .formatToParts(units)
    .map((part) => (part.type === "fraction" ? fraction : part.value))
    .join("");
  const sign = hundredths > 0 ? "+" : hundredths < 0 ? "−" : "";

  return `${sign}${magnitude} %`;
}

/**
 * Change copy of one figure.
 *
 * A missing percentage is never drawn as 0 %: without a previous amount to
 * divide by, the block says there is no comparison base.
 */
export function comparisonChangeLabel(delta: ComparisonDeltaDto): string {
  if (delta.deltaPercent === null) {
    return dashboardCopy.noComparisonBase;
  }

  return formatPercentHundredths(delta.deltaPercent);
}

/** Spanish `dd/mm/aaaa – dd/mm/aaaa` copy of an inclusive interval. */
export function formatDateRangeLabel(range: DateRangeDto): string {
  return dashboardCopy.rangeLabel(
    formatLocalDateAsSpanish(range.start),
    formatLocalDateAsSpanish(range.end),
  );
}

/**
 * History URL that reproduces one figure, or null when it cannot be navigated.
 *
 * The history filters movements by interval, type, category and tags. It has no
 * filter for the computed group of expense without tags, and a descriptor whose
 * interval is not a real civil date is a broken contract, so both cases report
 * that the figure is not navigable instead of opening a history that would show
 * a wider set of movements than the figure was made of.
 */
export function drillDownHistoryHref(drillDown: DrillDownDto): string | null {
  if (drillDown.untagged) {
    return null;
  }

  const dateFrom = parseLocalDate(drillDown.dateFrom);
  const dateTo = parseLocalDate(drillDown.dateTo);

  if (!dateFrom.ok || !dateTo.ok) {
    return null;
  }

  return historyPageHref(HISTORY_ALL_TAB, {
    q: "",
    dateFrom: dateFrom.value,
    dateTo: dateTo.value,
    type: drillDown.type,
    categoryId: drillDown.categoryId,
    tagIds: drillDown.tagIds,
  });
}
