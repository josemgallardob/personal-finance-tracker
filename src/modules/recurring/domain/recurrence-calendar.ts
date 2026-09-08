/**
 * Monthly recurrence calendar.
 *
 * A rule fires once a month on a chosen ordinal day between 1 and 31. When a
 * month does not contain that day the due date clamps to the last day of that
 * month, and the chosen day is preserved for later months: a rule on day 31
 * falls on 28 or 29 February and returns to 31 March. Every rule here is pure
 * calendar text: no instant is built, so the result never drifts with the time
 * zone of the process that evaluates it.
 *
 * The first due date is strictly after the activation day, so marking a
 * transaction as recurring never generates a copy for the same day. Recovery
 * after a pause walks the same rule forward, one month at a time, until the
 * next due date is strictly after today.
 */

import {
  type DateResult,
  type LocalDate,
  MAX_SUPPORTED_YEAR,
  compareLocalDates,
  createLocalDate,
  daysInMonth,
  localDateParts,
} from "../../../shared/domain/dates";

const MONTHS_PER_YEAR = 12;

/** First ordinal day of the month a monthly rule accepts. */
export const MIN_MONTHLY_DAY = 1;

/** Last ordinal day of the month a monthly rule accepts. */
export const MAX_MONTHLY_DAY = 31;

declare const monthlyDayBrand: unique symbol;

/** Ordinal day of the month a monthly rule fires on. */
export type MonthlyDay = number & { readonly [monthlyDayBrand]: true };

/** Tells whether a number is an accepted ordinal day of the month. */
export function isMonthlyDay(value: number): value is MonthlyDay {
  return (
    Number.isInteger(value) &&
    value >= MIN_MONTHLY_DAY &&
    value <= MAX_MONTHLY_DAY
  );
}

/**
 * Due date of a rule inside one specific month.
 *
 * The ordinal day is clamped to the last day the month really has, so day 31
 * resolves to 28 February in a common year and to 29 in a leap one.
 */
export function monthlyDueDate(
  year: number,
  month: number,
  monthlyDay: MonthlyDay,
): DateResult<LocalDate> {
  if (year > MAX_SUPPORTED_YEAR) {
    return { ok: false, error: "yearOutOfRange" };
  }

  if (month < 1 || month > MONTHS_PER_YEAR) {
    return { ok: false, error: "monthOutOfRange" };
  }

  return createLocalDate(
    year,
    month,
    Math.min(monthlyDay, daysInMonth(year, month)),
  );
}

/**
 * Next due date strictly after the given day.
 *
 * The candidate is first looked for in the month of `date`; when that candidate
 * is not strictly later the rule moves to the following month. Passing the
 * activation day yields the first due date, and passing the previous due date
 * yields the following one, always from the original ordinal day and never from
 * the clamped one.
 */
export function nextDueDateAfter(
  date: LocalDate,
  monthlyDay: MonthlyDay,
): DateResult<LocalDate> {
  const { year, month, day } = localDateParts(date);

  if (Math.min(monthlyDay, daysInMonth(year, month)) > day) {
    return monthlyDueDate(year, month, monthlyDay);
  }

  return month === MONTHS_PER_YEAR
    ? monthlyDueDate(year + 1, 1, monthlyDay)
    : monthlyDueDate(year, month + 1, monthlyDay);
}

/** Pending due dates of a rule and the future date it continues from. */
export interface DueSchedule {
  /** Due dates up to and including today, in chronological order. */
  readonly pending: readonly LocalDate[];
  /** Next due date, always strictly after today. */
  readonly nextDueDate: LocalDate;
}

/**
 * Resolves everything a rule owes up to today plus the date it continues from.
 *
 * A rule whose next due date is already in the future owes nothing and keeps
 * that date. A rule that was not run for several months yields one entry per
 * missed date, exactly once each, and ends on a strictly future date, which is
 * what makes a restart recover the omitted months without repeating any.
 */
export function resolveDueSchedule(
  nextDueDate: LocalDate,
  monthlyDay: MonthlyDay,
  today: LocalDate,
): DateResult<DueSchedule> {
  const pending: LocalDate[] = [];
  let cursor = nextDueDate;

  while (compareLocalDates(cursor, today) <= 0) {
    pending.push(cursor);

    const following = nextDueDateAfter(cursor, monthlyDay);

    if (!following.ok) {
      return following;
    }

    cursor = following.value;
  }

  return { ok: true, value: { pending, nextDueDate: cursor } };
}
