/**
 * Monetary domain rules.
 *
 * Amounts are exact integers of EUR minor units (cents). Text entered with the
 * Spanish convention is converted digit by digit: this module never uses
 * `parseFloat`, never rounds silently, and never accumulates cents as
 * floating-point values.
 */

declare const moneyMinorBrand: unique symbol;

/** Exact amount expressed in EUR minor units (cents). */
export type MoneyMinor = number & { readonly [moneyMinorBrand]: true };

/** Smallest amount accepted for a single transaction: 0,01 €. */
export const MIN_TRANSACTION_MINOR = 1;

/** Largest amount accepted for a single transaction: 999.999.999,99 €. */
export const MAX_TRANSACTION_MINOR = 99999999999;

/** Number of digits of {@link MAX_TRANSACTION_MINOR}. */
const MAX_TRANSACTION_MINOR_DIGITS = 11;

/** Reason why a monetary value was rejected. */
export type MoneyErrorCode =
  | "invalidFormat"
  | "belowMinimum"
  | "aboveMaximum"
  | "notSafeInteger"
  | "overflow";

/** Outcome of a monetary operation that can fail with a controlled error. */
export type MoneyResult<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly error: MoneyErrorCode };

/**
 * Spanish amount text: either plain digits or complete thousand groups, with an
 * optional decimal comma followed by one or two digits.
 */
const SPANISH_AMOUNT_PATTERN = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/;

function ok<TValue>(value: TValue): MoneyResult<TValue> {
  return { ok: true, value };
}

function failed<TValue>(error: MoneyErrorCode): MoneyResult<TValue> {
  return { ok: false, error };
}

/** Tells whether a number can represent an exact amount of minor units. */
export function isMoneyMinor(value: number): value is MoneyMinor {
  return Number.isSafeInteger(value);
}

/** Converts a number into {@link MoneyMinor}, rejecting inexact values. */
export function toMoneyMinor(value: number): MoneyResult<MoneyMinor> {
  if (!isMoneyMinor(value)) {
    return failed("notSafeInteger");
  }

  return ok(value);
}

/**
 * Converts Spanish amount text into minor units.
 *
 * Accepts surrounding whitespace, the decimal comma and complete thousand
 * groups. Rejects ambiguous separators, signs, currency symbols, internal
 * spaces, more than two decimals, zero and amounts outside the accepted
 * transaction limits.
 */
export function parseTransactionAmountText(
  text: string,
): MoneyResult<MoneyMinor> {
  const matched = SPANISH_AMOUNT_PATTERN.exec(text.trim());

  if (matched === null) {
    return failed("invalidFormat");
  }

  const [, integerPart, decimalPart = ""] = matched;
  const minorDigits = `${integerPart.replaceAll(".", "")}${decimalPart.padEnd(2, "0")}`;
  const significantDigits = minorDigits.replace(/^0+/, "");

  if (significantDigits.length > MAX_TRANSACTION_MINOR_DIGITS) {
    return failed("aboveMaximum");
  }

  const minor = Number(significantDigits === "" ? "0" : significantDigits);

  if (minor < MIN_TRANSACTION_MINOR) {
    return failed("belowMinimum");
  }

  return ok(minor as MoneyMinor);
}

/** Adds two amounts, reporting overflow instead of an imprecise total. */
export function addMoneyMinor(
  augend: MoneyMinor,
  addend: MoneyMinor,
): MoneyResult<MoneyMinor> {
  const total = augend + addend;

  if (!isMoneyMinor(total)) {
    return failed("overflow");
  }

  return ok(total);
}

/** Subtracts two amounts, reporting overflow instead of an imprecise result. */
export function subtractMoneyMinor(
  minuend: MoneyMinor,
  subtrahend: MoneyMinor,
): MoneyResult<MoneyMinor> {
  const difference = minuend - subtrahend;

  if (!isMoneyMinor(difference)) {
    return failed("overflow");
  }

  return ok(difference);
}

/**
 * Divides two exact integers and rounds to the nearest integer, with a tie
 * moving away from zero.
 *
 * This is the presentation rounding of a monthly average and of a percentage
 * change: the exact numerator and divisor stay elsewhere, and only the figure
 * that will be painted is rounded. Half of a cent of a negative average still
 * moves away from zero, so −500,005 € becomes −500,01 € rather than −500,00 €.
 */
export function roundDivisionHalfAwayFromZero(
  numerator: number,
  divisor: number,
): MoneyResult<number> {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(divisor)) {
    return failed("notSafeInteger");
  }

  if (divisor === 0) {
    return failed("overflow");
  }

  const sign =
    (numerator < 0 ? BigInt(-1) : BigInt(1)) *
    (divisor < 0 ? BigInt(-1) : BigInt(1));
  const quotient = absBigInt(numerator) / absBigInt(divisor);
  const remainder = absBigInt(numerator) % absBigInt(divisor);
  const rounded =
    remainder * BigInt(2) >= absBigInt(divisor)
      ? quotient + BigInt(1)
      : quotient;

  return ok(Number(sign * rounded));
}

/**
 * Presentation of an exact average: the total of minor units divided by the
 * month count, rounded to the nearest cent with halves away from zero.
 */
export function presentAverageMinor(
  totalMinor: MoneyMinor,
  monthCount: number,
): MoneyResult<MoneyMinor> {
  const rounded = roundDivisionHalfAwayFromZero(totalMinor, monthCount);

  if (!rounded.ok) {
    return rounded;
  }

  return toMoneyMinor(rounded.value);
}

function absBigInt(value: number): bigint {
  return BigInt(Math.abs(value));
}

/**
 * Formats an exact amount of minor units with a locale-aware formatter.
 *
 * The amount is split into whole units and cents from its digits, so no
 * floating-point division ever touches the value: only the whole units, always
 * an exact safe integer, reach `Intl`. The formatter renders them with two
 * fraction digits and the exact cents replace that fraction, which keeps the
 * locale grouping, decimal separator, sign and currency placement intact for
 * every representable amount.
 */
function formatExactMinor(
  formatter: Intl.NumberFormat,
  minor: MoneyMinor,
): string {
  const digits = Math.abs(minor).toString().padStart(3, "0");
  const unitDigits = digits.slice(0, -2);
  const centDigits = digits.slice(-2);
  const units = Number(unitDigits);
  const signedUnits = minor < 0 ? -units : units;

  return formatter
    .formatToParts(signedUnits)
    .map((part) => (part.type === "fraction" ? centDigits : part.value))
    .join("");
}

const eurFormatter = new Intl.NumberFormat("es-ES", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const amountTextFormatter = new Intl.NumberFormat("es-ES", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Formats an amount as Spanish EUR currency copy, for example `1.234,56 €`. */
export function formatMoneyMinorAsEur(minor: MoneyMinor): string {
  return formatExactMinor(eurFormatter, minor);
}

/**
 * Formats an amount as Spanish amount text without the currency symbol, in the
 * same shape accepted by {@link parseTransactionAmountText}.
 */
export function formatMoneyMinorAsAmountText(minor: MoneyMinor): string {
  return formatExactMinor(amountTextFormatter, minor);
}
