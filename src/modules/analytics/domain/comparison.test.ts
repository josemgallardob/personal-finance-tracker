import { describe, expect, it } from "vitest";

import { type MoneyMinor, toMoneyMinor } from "../../../shared/domain/money";
import {
  NO_COMPARISON_BASE,
  PERCENT_HUNDREDTHS_SCALE,
  comparisonDelta,
} from "./comparison";

function minor(value: number): MoneyMinor {
  const result = toMoneyMinor(value);

  if (!result.ok) {
    throw new Error(`Expected ${value} to be exact, got ${result.error}`);
  }

  return result.value;
}

describe("comparisonDelta", () => {
  it("computes a positive percentage against the absolute previous amount", () => {
    expect(comparisonDelta(minor(50_000), minor(40_000))).toEqual({
      ok: true,
      value: {
        currentMinor: 50_000,
        previousMinor: 40_000,
        deltaMinor: 10_000,
        deltaPercent: 2_500,
        reason: null,
      },
    });
  });

  it("computes a negative percentage", () => {
    expect(comparisonDelta(minor(15_000), minor(20_000))).toEqual({
      ok: true,
      value: {
        currentMinor: 15_000,
        previousMinor: 20_000,
        deltaMinor: -5_000,
        deltaPercent: -2_500,
        reason: null,
      },
    });
  });

  it("uses the absolute previous amount when that amount is negative", () => {
    expect(comparisonDelta(minor(-5_000), minor(-10_000))).toEqual({
      ok: true,
      value: {
        currentMinor: -5_000,
        previousMinor: -10_000,
        deltaMinor: 5_000,
        deltaPercent: 5_000,
        reason: null,
      },
    });
  });

  it("returns a zero percentage when both amounts are zero", () => {
    expect(comparisonDelta(minor(0), minor(0))).toEqual({
      ok: true,
      value: {
        currentMinor: 0,
        previousMinor: 0,
        deltaMinor: 0,
        deltaPercent: 0,
        reason: null,
      },
    });
  });

  it("returns a null percentage and a reason when the previous amount is zero", () => {
    expect(comparisonDelta(minor(25_000), minor(0))).toEqual({
      ok: true,
      value: {
        currentMinor: 25_000,
        previousMinor: 0,
        deltaMinor: 25_000,
        deltaPercent: null,
        reason: NO_COMPARISON_BASE,
      },
    });
  });

  it("keeps the presentation scale of hundredths of a percent", () => {
    expect(PERCENT_HUNDREDTHS_SCALE).toBe(10_000);
  });

  it("refuses a difference that leaves the exact range", () => {
    expect(comparisonDelta(minor(Number.MAX_SAFE_INTEGER), minor(-1))).toEqual({
      ok: false,
      error: "overflow",
    });
  });

  it("computes a percentage whose scaled numerator no longer fits a number", () => {
    const current = Number.MAX_SAFE_INTEGER;
    const previous = 10_000;
    const result = comparisonDelta(minor(current), minor(previous));

    expect(result).toEqual({
      ok: true,
      value: {
        currentMinor: current,
        previousMinor: previous,
        deltaMinor: current - previous,
        deltaPercent: current - previous,
        reason: null,
      },
    });
  });

  it("computes a negative percentage whose scaled numerator no longer fits a number", () => {
    const previous = 10_000;
    const current = -(Number.MAX_SAFE_INTEGER - 20_000);
    const result = comparisonDelta(minor(current), minor(previous));

    expect(result).toEqual({
      ok: true,
      value: {
        currentMinor: current,
        previousMinor: previous,
        deltaMinor: current - previous,
        deltaPercent: current - previous,
        reason: null,
      },
    });
  });

  it("rounds an overflowing scaled percentage half away from zero", () => {
    const delta = 900_719_925_476;
    const previous = 3;
    const result = comparisonDelta(minor(delta + previous), minor(previous));

    expect(result).toEqual({
      ok: true,
      value: {
        currentMinor: delta + previous,
        previousMinor: previous,
        deltaMinor: delta,
        deltaPercent: 3_002_399_751_586_667,
        reason: null,
      },
    });
  });

  it("keeps an overflowing scaled percentage whose remainder is below half", () => {
    const delta = 900_719_925_475;
    const previous = 3;
    const result = comparisonDelta(minor(delta + previous), minor(previous));

    expect(result).toEqual({
      ok: true,
      value: {
        currentMinor: delta + previous,
        previousMinor: previous,
        deltaMinor: delta,
        deltaPercent: 3_002_399_751_583_333,
        reason: null,
      },
    });
  });

  it("refuses a percentage that itself leaves the exact range", () => {
    expect(comparisonDelta(minor(Number.MAX_SAFE_INTEGER), minor(1))).toEqual({
      ok: false,
      error: "overflow",
    });
  });
});
