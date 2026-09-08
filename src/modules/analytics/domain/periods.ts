/**
 * Temporal windows of the dashboard.
 *
 * Every dashboard figure is read over one of three independent windows: the
 * selected period and its equivalent previous interval, the monthly evolution
 * series, and the rolling window used by the monthly averages. They are pure
 * calendar rules over civil dates, so they never build an instant and never
 * depend on the time zone of the process that evaluates them.
 *
 * The month is the smallest unit: every window starts on the first day of a
 * natural month. A period that reaches the current day is partial, and only a
 * partial interval clamps its previous end to the same ordinal day. A period
 * made of closed months compares against whole months.
 */

import {
  type LocalDate,
  type MonthKey,
  daysInMonth,
  localDateParts,
  monthKeyOf,
  monthKeyParts,
  MAX_SUPPORTED_YEAR,
  MIN_SUPPORTED_YEAR,
} from "../../../shared/domain/dates";

const MONTHS_PER_YEAR = 12;

/** Closed months the monthly evolution series spans, including the current one. */
export const EVOLUTION_WINDOW_MONTHS = 12;

/** Closed months the monthly averages span at most. */
export const AVERAGE_WINDOW_MONTHS = 12;

/** Closed months the "last three months" preset spans. */
export const LAST_MONTHS_PRESET_MONTHS = 3;

/** Reason why a temporal window could not be resolved. */
export type PeriodErrorCode = "invalidMonthRange" | "monthOutOfRange";

/** Outcome of a window rule that can reject its input. */
export type PeriodResult<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly error: PeriodErrorCode };

/** Period presets the dashboard selector offers, plus the custom month range. */
export const DASHBOARD_PERIOD_KINDS = [
  "currentMonth",
  "previousMonth",
  "lastThreeMonths",
  "currentYear",
  "customMonthRange",
] as const;

/** Identifier of a dashboard period. */
export type DashboardPeriodKind = (typeof DASHBOARD_PERIOD_KINDS)[number];

/**
 * Temporal selection of the dashboard cards.
 *
 * `currentMonth` and `currentYear` run up to today and are therefore partial.
 * The remaining members span only closed natural months.
 */
export type DashboardPeriod =
  | { readonly kind: "currentMonth" }
  | { readonly kind: "previousMonth" }
  | { readonly kind: "lastThreeMonths" }
  | { readonly kind: "currentYear" }
  | {
      readonly kind: "customMonthRange";
      readonly from: MonthKey;
      readonly to: MonthKey;
    };

/** Inclusive interval of civil dates. */
export interface DateRange {
  readonly start: LocalDate;
  readonly end: LocalDate;
}

/**
 * The two intervals a comparison really contrasts.
 *
 * Both ends of both intervals travel to the interface, which labels them so a
 * percentage change is never read against an interval the user cannot see.
 */
export interface ComparisonWindow {
  readonly current: DateRange;
  readonly previous: DateRange;
}

/** Consecutive months of a window, from {@link start} to {@link end}. */
export interface MonthWindow {
  readonly start: MonthKey;
  readonly end: MonthKey;
  readonly months: readonly MonthKey[];
  readonly monthCount: number;
}

/**
 * Window of the monthly evolution series.
 *
 * `empty` means no movement exists at all: the chart shows an empty state
 * instead of a run of zeroed months.
 */
export type EvolutionWindow =
  { readonly kind: "empty" } | ({ readonly kind: "months" } & MonthWindow);

/**
 * Window of the monthly averages.
 *
 * `insufficientHistory` means no natural month has closed since the first
 * movement, so the averages have no divisor and must not be shown as zero.
 */
export type AverageWindow =
  | { readonly kind: "insufficientHistory" }
  | ({ readonly kind: "months" } & MonthWindow);

/**
 * Resolved shape of a period before it becomes dates.
 *
 * Keeping the end day apart from the end month is what lets a comparison shift
 * the whole block backwards and decide whether that end has to be clamped.
 */
interface PeriodBlock {
  readonly startMonth: number;
  readonly endMonth: number;
  readonly endDay: number;
  readonly partial: boolean;
  readonly comparisonShiftMonths: number;
}

function ok<TValue>(value: TValue): PeriodResult<TValue> {
  return { ok: true, value };
}

function failed<TValue>(error: PeriodErrorCode): PeriodResult<TValue> {
  return { ok: false, error };
}

/** Months elapsed since year 1 January, the ordering key of a natural month. */
function monthIndex(year: number, month: number): number {
  return year * MONTHS_PER_YEAR + (month - 1);
}

function yearOfIndex(index: number): number {
  return Math.floor(index / MONTHS_PER_YEAR);
}

function monthOfIndex(index: number): number {
  return (index % MONTHS_PER_YEAR) + 1;
}

/** Tells whether a month index still falls inside the representable calendar. */
function isSupportedMonth(index: number): boolean {
  const year = yearOfIndex(index);

  return year >= MIN_SUPPORTED_YEAR && year <= MAX_SUPPORTED_YEAR;
}

function pad(value: number, length: number): string {
  return String(value).padStart(length, "0");
}

/**
 * Month text of a supported index.
 *
 * The caller has already checked the index with {@link isSupportedMonth}, so
 * the four digits of the year and two of the month are always available.
 */
function monthKeyAt(index: number): MonthKey {
  return `${pad(yearOfIndex(index), 4)}-${pad(monthOfIndex(index), 2)}` as MonthKey;
}

/** Days the month of a supported index really has. */
function daysInMonthAt(index: number): number {
  return daysInMonth(yearOfIndex(index), monthOfIndex(index));
}

/**
 * Date text of a supported index and a day the month contains.
 *
 * Every day handed here is either the first of the month or a day already
 * clamped with {@link daysInMonthAt}, so the result is always a real date.
 */
function localDateAt(index: number, day: number): LocalDate {
  return `${monthKeyAt(index)}-${pad(day, 2)}` as LocalDate;
}

function monthIndexOfDate(date: LocalDate): number {
  const { year, month } = localDateParts(date);

  return monthIndex(year, month);
}

function monthIndexOfMonth(month: MonthKey): number {
  const parts = monthKeyParts(month);

  return monthIndex(parts.year, parts.month);
}

/** Turns a resolved block into the interval it covers. */
function blockRange(block: PeriodBlock): DateRange {
  return {
    start: localDateAt(block.startMonth, 1),
    end: localDateAt(block.endMonth, block.endDay),
  };
}

/**
 * Resolves the shape of a period against the current day.
 *
 * A period is rejected when it would reach outside the representable calendar,
 * and a custom range is rejected when its months are given in reverse order.
 */
function resolveBlock(
  period: DashboardPeriod,
  today: LocalDate,
): PeriodResult<PeriodBlock> {
  const currentMonth = monthIndexOfDate(today);
  const { day } = localDateParts(today);

  switch (period.kind) {
    case "currentMonth":
      return ok({
        startMonth: currentMonth,
        endMonth: currentMonth,
        endDay: day,
        partial: true,
        comparisonShiftMonths: 1,
      });

    case "previousMonth": {
      const month = currentMonth - 1;

      if (!isSupportedMonth(month)) {
        return failed("monthOutOfRange");
      }

      return ok({
        startMonth: month,
        endMonth: month,
        endDay: daysInMonthAt(month),
        partial: false,
        comparisonShiftMonths: 1,
      });
    }

    case "lastThreeMonths": {
      const endMonth = currentMonth - 1;
      const startMonth = currentMonth - LAST_MONTHS_PRESET_MONTHS;

      if (!isSupportedMonth(startMonth)) {
        return failed("monthOutOfRange");
      }

      return ok({
        startMonth,
        endMonth,
        endDay: daysInMonthAt(endMonth),
        partial: false,
        comparisonShiftMonths: LAST_MONTHS_PRESET_MONTHS,
      });
    }

    case "currentYear": {
      const january = monthIndex(localDateParts(today).year, 1);

      return ok({
        startMonth: january,
        endMonth: currentMonth,
        endDay: day,
        partial: true,
        comparisonShiftMonths: MONTHS_PER_YEAR,
      });
    }

    case "customMonthRange": {
      const startMonth = monthIndexOfMonth(period.from);
      const endMonth = monthIndexOfMonth(period.to);

      if (startMonth > endMonth) {
        return failed("invalidMonthRange");
      }

      return ok({
        startMonth,
        endMonth,
        endDay: daysInMonthAt(endMonth),
        partial: false,
        comparisonShiftMonths: endMonth - startMonth + 1,
      });
    }
  }
}

/**
 * Interval the dashboard cards aggregate for the selected period.
 *
 * The current month and the current year stop at today; every other period
 * covers whole natural months and stops at the last day of its final month.
 */
export function resolvePeriod(
  period: DashboardPeriod,
  today: LocalDate,
): PeriodResult<DateRange> {
  const block = resolveBlock(period, today);

  if (!block.ok) {
    return failed(block.error);
  }

  return ok(blockRange(block.value));
}

/**
 * The selected interval and the equivalent previous one.
 *
 * The previous block is the same number of months immediately before the
 * current one, except for the current year, which is compared against the same
 * interval of the year before. A partial interval reaches the same ordinal day
 * in both blocks and only shortens the previous end when that day does not
 * exist there; the current interval is never shortened. A block of closed
 * months is compared against closed months.
 */
export function resolveComparisonWindow(
  period: DashboardPeriod,
  today: LocalDate,
): PeriodResult<ComparisonWindow> {
  const resolved = resolveBlock(period, today);

  if (!resolved.ok) {
    return failed(resolved.error);
  }

  const block = resolved.value;
  const startMonth = block.startMonth - block.comparisonShiftMonths;
  const endMonth = block.endMonth - block.comparisonShiftMonths;

  if (!isSupportedMonth(startMonth)) {
    return failed("monthOutOfRange");
  }

  const lastDay = daysInMonthAt(endMonth);
  const endDay = block.partial ? Math.min(block.endDay, lastDay) : lastDay;

  return ok({
    current: blockRange(block),
    previous: blockRange({
      ...block,
      startMonth,
      endMonth,
      endDay,
    }),
  });
}

/** Every month from `startMonth` to `endMonth`, both included. */
function monthWindow(startMonth: number, endMonth: number): MonthWindow {
  const months: MonthKey[] = [];

  for (let index = startMonth; index <= endMonth; index += 1) {
    months.push(monthKeyAt(index));
  }

  return {
    start: monthKeyAt(startMonth),
    end: monthKeyAt(endMonth),
    months,
    monthCount: months.length,
  };
}

/**
 * Months the evolution chart draws.
 *
 * The series ends in the current month and reaches at most eleven months back,
 * or the month of the first movement when the history is shorter. Months
 * without movements stay in the window so the axis is not compressed. Without
 * any movement the series is empty rather than a run of zeroes.
 */
export function evolutionWindow(
  today: LocalDate,
  firstMovementDate: LocalDate | null,
): EvolutionWindow {
  if (firstMovementDate === null) {
    return { kind: "empty" };
  }

  const endMonth = monthIndexOfDate(today);
  const firstMonth = monthIndexOfMonth(monthKeyOf(firstMovementDate));

  // A movement cannot be dated after today; a clock moved backwards could still
  // produce this, and an empty series is safer than an inverted window.
  if (firstMonth > endMonth) {
    return { kind: "empty" };
  }

  const earliest = endMonth - (EVOLUTION_WINDOW_MONTHS - 1);

  return {
    kind: "months",
    ...monthWindow(Math.max(earliest, firstMonth), endMonth),
  };
}

/**
 * Months the monthly averages divide by.
 *
 * The window ends in the last closed natural month and spans at most twelve
 * months. It starts no earlier than the first natural month fully after the
 * first movement, so the month that movement fell in is always excluded, even
 * when it was recorded on day one: that month was not observed from its own
 * first day. Months without movements stay in the divisor. When no month has
 * closed inside that history the averages report insufficient history instead
 * of dividing by zero.
 */
export function averageWindow(
  today: LocalDate,
  firstMovementDate: LocalDate | null,
): AverageWindow {
  if (firstMovementDate === null) {
    return { kind: "insufficientHistory" };
  }

  const endMonth = monthIndexOfDate(today) - 1;
  const firstClosedMonth = monthIndexOfMonth(monthKeyOf(firstMovementDate)) + 1;

  if (!isSupportedMonth(endMonth) || firstClosedMonth > endMonth) {
    return { kind: "insufficientHistory" };
  }

  const earliest = endMonth - (AVERAGE_WINDOW_MONTHS - 1);

  return {
    kind: "months",
    ...monthWindow(Math.max(earliest, firstClosedMonth), endMonth),
  };
}

/**
 * Inclusive civil-date interval covered by a window of natural months.
 *
 * The averages read the whole closed months of their window, so the interval
 * always starts on the first day of {@link MonthWindow.start} and always ends
 * on the last day of {@link MonthWindow.end}.
 */
export function dateRangeOfMonthWindow(window: MonthWindow): DateRange {
  const startMonth = monthIndexOfMonth(window.start);
  const endMonth = monthIndexOfMonth(window.end);

  return {
    start: localDateAt(startMonth, 1),
    end: localDateAt(endMonth, daysInMonthAt(endMonth)),
  };
}
