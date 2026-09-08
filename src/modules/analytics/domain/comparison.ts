/**
 * Comparison change of two exact amounts.
 *
 * The percentage is `(current − previous) ÷ abs(previous)`. Both amounts at
 * zero yield 0 %. Previous zero and current different from zero yield no
 * percentage at all: the figure is `null` and the reason travels with it so
 * the interface can say there is no comparison base instead of drawing 0 %.
 *
 * The percentage that leaves this module is already the presentation input:
 * hundredths of a percent, rounded half away from zero with integer
 * arithmetic. 25,00 % is `2500`; −25,00 % is `-2500`.
 */

import type { MoneyMinor } from "../../../shared/domain/money";
import {
  type MoneyResult,
  roundDivisionHalfAwayFromZero,
  subtractMoneyMinor,
} from "../../../shared/domain/money";

/** Hundredths of one percent, so 25.00 % is stored as `2500`. */
export const PERCENT_HUNDREDTHS_SCALE = 10_000;

/** Reason attached to a missing percentage when the previous amount is zero. */
export const NO_COMPARISON_BASE = "noComparisonBase";

/** Reason why {@link ComparisonDelta.deltaPercent} is null. */
export type ComparisonPercentReason = typeof NO_COMPARISON_BASE;

/**
 * Change between the current interval and the equivalent previous one.
 *
 * `deltaPercent` is null only when there is no base; `reason` is then
 * {@link NO_COMPARISON_BASE}. The two fields travel together so a missing
 * percentage is never mistaken for a 0 % change.
 */
export interface ComparisonDelta {
  readonly currentMinor: MoneyMinor;
  readonly previousMinor: MoneyMinor;
  readonly deltaMinor: MoneyMinor;
  readonly deltaPercent: number | null;
  readonly reason: ComparisonPercentReason | null;
}

/** Builds the comparison of two exact amounts of the same kind. */
export function comparisonDelta(
  currentMinor: MoneyMinor,
  previousMinor: MoneyMinor,
): MoneyResult<ComparisonDelta> {
  const delta = subtractMoneyMinor(currentMinor, previousMinor);

  if (!delta.ok) {
    return delta;
  }

  if (previousMinor === 0) {
    if (currentMinor === 0) {
      return {
        ok: true,
        value: {
          currentMinor,
          previousMinor,
          deltaMinor: delta.value,
          deltaPercent: 0,
          reason: null,
        },
      };
    }

    return {
      ok: true,
      value: {
        currentMinor,
        previousMinor,
        deltaMinor: delta.value,
        deltaPercent: null,
        reason: NO_COMPARISON_BASE,
      },
    };
  }

  const percent = scaledPercent(delta.value, previousMinor);

  if (!percent.ok) {
    return percent;
  }

  return {
    ok: true,
    value: {
      currentMinor,
      previousMinor,
      deltaMinor: delta.value,
      deltaPercent: percent.value,
      reason: null,
    },
  };
}

/**
 * Percentage change in hundredths of a percent.
 *
 * `delta * 10000 / abs(previous)` is computed with integers and rounded half
 * away from zero, including when the change itself is negative.
 */
function scaledPercent(
  deltaMinor: MoneyMinor,
  previousMinor: MoneyMinor,
): MoneyResult<number> {
  const scaled = BigInt(deltaMinor) * BigInt(PERCENT_HUNDREDTHS_SCALE);

  if (
    scaled > BigInt(Number.MAX_SAFE_INTEGER) ||
    scaled < BigInt(Number.MIN_SAFE_INTEGER)
  ) {
    return roundOverflowingPercent(scaled, previousMinor);
  }

  return roundDivisionHalfAwayFromZero(Number(scaled), Math.abs(previousMinor));
}

/**
 * Percentage whose scaled numerator no longer fits a safe integer.
 *
 * The rounding still uses exact integers; only the final hundredths value is
 * refused when it itself would no longer be serializable.
 */
function roundOverflowingPercent(
  scaled: bigint,
  previousMinor: MoneyMinor,
): MoneyResult<number> {
  const divisor = BigInt(Math.abs(previousMinor));
  const sign = scaled < BigInt(0) ? BigInt(-1) : BigInt(1);
  const absolute = scaled < BigInt(0) ? -scaled : scaled;
  const quotient = absolute / divisor;
  const remainder = absolute % divisor;
  const rounded =
    remainder * BigInt(2) >= divisor ? quotient + BigInt(1) : quotient;
  const value = sign * rounded;

  if (
    value > BigInt(Number.MAX_SAFE_INTEGER) ||
    value < BigInt(Number.MIN_SAFE_INTEGER)
  ) {
    return { ok: false, error: "overflow" };
  }

  return { ok: true, value: Number(value) };
}
