/**
 * Local calendar rules.
 *
 * A transaction date is a civil date without time. It is represented as ISO
 * `YYYY-MM-DD` text and is never converted into an instant or a UTC timestamp,
 * so it cannot drift to the previous or next day depending on the time zone of
 * the process that reads it.
 */

declare const localDateBrand: unique symbol;
declare const monthKeyBrand: unique symbol;

/** Civil date without time, as ISO `YYYY-MM-DD` text. */
export type LocalDate = string & { readonly [localDateBrand]: true };

/** Natural month, as ISO `YYYY-MM` text. */
export type MonthKey = string & { readonly [monthKeyBrand]: true };

/**
 * First supported year. The four-digit ISO representation also caps the upper
 * bound at {@link MAX_SUPPORTED_YEAR}: a longer year is not representable and
 * is rejected as an invalid format.
 */
export const MIN_SUPPORTED_YEAR = 1;

/** Last year representable with four ISO digits. */
export const MAX_SUPPORTED_YEAR = 9999;

/** Reason why a calendar value was rejected. */
export type DateErrorCode =
  "invalidFormat" | "yearOutOfRange" | "monthOutOfRange" | "dayOutOfRange";

/** Outcome of a calendar operation that can fail with a controlled error. */
export type DateResult<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly error: DateErrorCode };

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_KEY_PATTERN = /^(\d{4})-(\d{2})$/;

const MONTHS_PER_YEAR = 12;
const DAYS_PER_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function ok<TValue>(value: TValue): DateResult<TValue> {
  return { ok: true, value };
}

function failed<TValue>(error: DateErrorCode): DateResult<TValue> {
  return { ok: false, error };
}

/** Tells whether a year has a 29 February in the proleptic Gregorian calendar. */
function isLeapYear(year: number): boolean {
  if (year % 4 !== 0) {
    return false;
  }

  if (year % 100 !== 0) {
    return true;
  }

  return year % 400 === 0;
}

/**
 * Number of days the given month really has.
 *
 * Callers outside this module use it to clamp an ordinal day to a month that
 * does not contain it, which is how period comparisons keep both intervals
 * equivalent across a shorter February.
 */
export function daysInMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) {
    return 29;
  }

  return DAYS_PER_MONTH[month - 1];
}

function padYear(year: number): string {
  return String(year).padStart(4, "0");
}

function padMonthOrDay(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Validates ISO `YYYY-MM-DD` text against the real calendar.
 *
 * Rejects anything that is not exactly four, two and two digits, the year zero,
 * a month outside 1-12 and a day that the month does not have, including
 * 29 February of a common year.
 */
export function parseLocalDate(text: string): DateResult<LocalDate> {
  const matched = LOCAL_DATE_PATTERN.exec(text);

  if (matched === null) {
    return failed("invalidFormat");
  }

  const [, yearDigits, monthDigits, dayDigits] = matched;
  const year = Number(yearDigits);
  const month = Number(monthDigits);
  const day = Number(dayDigits);

  if (year < MIN_SUPPORTED_YEAR) {
    return failed("yearOutOfRange");
  }

  if (month < 1 || month > MONTHS_PER_YEAR) {
    return failed("monthOutOfRange");
  }

  if (day < 1 || day > daysInMonth(year, month)) {
    return failed("dayOutOfRange");
  }

  return ok(text as LocalDate);
}

/**
 * Builds a date from calendar numbers, applying the same real-calendar rules as
 * {@link parseLocalDate}. Values that cannot be written as ISO digits, such as
 * a fractional or negative number, are rejected as an invalid format.
 */
export function createLocalDate(
  year: number,
  month: number,
  day: number,
): DateResult<LocalDate> {
  return parseLocalDate(
    `${padYear(year)}-${padMonthOrDay(month)}-${padMonthOrDay(day)}`,
  );
}

/** Validates ISO `YYYY-MM` text as a natural month. */
export function parseMonthKey(text: string): DateResult<MonthKey> {
  const matched = MONTH_KEY_PATTERN.exec(text);

  if (matched === null) {
    return failed("invalidFormat");
  }

  const [, yearDigits, monthDigits] = matched;
  const year = Number(yearDigits);
  const month = Number(monthDigits);

  if (year < MIN_SUPPORTED_YEAR) {
    return failed("yearOutOfRange");
  }

  if (month < 1 || month > MONTHS_PER_YEAR) {
    return failed("monthOutOfRange");
  }

  return ok(text as MonthKey);
}

/** Builds a month from calendar numbers, with the rules of {@link parseMonthKey}. */
export function createMonthKey(
  year: number,
  month: number,
): DateResult<MonthKey> {
  return parseMonthKey(`${padYear(year)}-${padMonthOrDay(month)}`);
}

/** Calendar numbers of a validated date. */
export function localDateParts(date: LocalDate): {
  readonly year: number;
  readonly month: number;
  readonly day: number;
} {
  return {
    year: Number(date.slice(0, 4)),
    month: Number(date.slice(5, 7)),
    day: Number(date.slice(8, 10)),
  };
}

/** Calendar numbers of a validated month. */
export function monthKeyParts(month: MonthKey): {
  readonly year: number;
  readonly month: number;
} {
  return {
    year: Number(month.slice(0, 4)),
    month: Number(month.slice(5, 7)),
  };
}

/** Natural month a date belongs to. */
export function monthKeyOf(date: LocalDate): MonthKey {
  return date.slice(0, 7) as MonthKey;
}

/**
 * Orders two dates chronologically: a negative number when the first is
 * earlier, zero when both are the same day and a positive number otherwise.
 * Fixed-width ISO text orders lexicographically, so no instant is built.
 */
export function compareLocalDates(left: LocalDate, right: LocalDate): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

/** Orders two months chronologically, like {@link compareLocalDates}. */
export function compareMonthKeys(left: MonthKey, right: MonthKey): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}
