import { describe, expect, it } from "vitest";

import {
  MAX_TRANSACTION_MINOR,
  MIN_TRANSACTION_MINOR,
  type MoneyMinor,
  addMoneyMinor,
  formatMoneyMinorAsAmountText,
  formatMoneyMinorAsEur,
  isMoneyMinor,
  parseTransactionAmountText,
  presentAverageMinor,
  roundDivisionHalfAwayFromZero,
  subtractMoneyMinor,
  toMoneyMinor,
} from "./money";

function parsedMinor(text: string): MoneyMinor {
  const result = parseTransactionAmountText(text);

  if (!result.ok) {
    throw new Error(`Expected "${text}" to be accepted, got ${result.error}`);
  }

  return result.value;
}

function checkedMinor(value: number): MoneyMinor {
  const result = toMoneyMinor(value);

  if (!result.ok) {
    throw new Error(`Expected ${value} to be exact, got ${result.error}`);
  }

  return result.value;
}

/** Replaces the narrow no-break spaces produced by Intl with plain spaces. */
function withPlainSpaces(text: string): string {
  return text.replace(/[  ]/g, " ");
}

describe("transaction amount limits", () => {
  it("keeps the accepted limits of one cent and 999.999.999,99 EUR", () => {
    expect(MIN_TRANSACTION_MINOR).toBe(1);
    expect(MAX_TRANSACTION_MINOR).toBe(99999999999);
    expect(MAX_TRANSACTION_MINOR).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });
});

describe("parseTransactionAmountText", () => {
  it.each([
    ["0,01", 1],
    ["0,1", 10],
    ["1", 100],
    ["12,5", 1250],
    ["12,50", 1250],
    ["1234,5", 123450],
    ["1.234,56", 123456],
    ["999.999.999,99", 99999999999],
    ["999999999,99", 99999999999],
    ["0000001,00", 100],
    ["123.456.789", 12345678900],
  ])("converts %s into %i minor units", (text, expected) => {
    expect(parseTransactionAmountText(text)).toEqual({
      ok: true,
      value: expected,
    });
  });

  it("accepts surrounding whitespace without altering the amount", () => {
    expect(parseTransactionAmountText("  1.234,56 \n")).toEqual({
      ok: true,
      value: 123456,
    });
  });

  it("converts the smallest and largest accepted amounts", () => {
    expect(parsedMinor("0,01")).toBe(MIN_TRANSACTION_MINOR);
    expect(parsedMinor("999.999.999,99")).toBe(MAX_TRANSACTION_MINOR);
  });

  it.each([
    ["", "empty text"],
    ["   ", "blank text"],
    ["12.50", "ambiguous decimal point"],
    ["1.23", "incomplete thousand group"],
    ["1.2345,00", "oversized thousand group"],
    ["1234.567", "trailing group without decimal comma"],
    ["12,345", "more than two decimals"],
    ["12,", "decimal comma without decimals"],
    [",50", "decimal comma without integer part"],
    ["1,2,3", "several decimal commas"],
    ["-5,00", "explicit sign"],
    ["+5,00", "explicit sign"],
    ["12,5 €", "currency symbol"],
    ["1 234,56", "internal space"],
    ["1.234.56", "thousand separator used as decimal"],
    ["abc", "free text"],
    ["1e3", "exponent notation"],
    ["NaN", "non numeric literal"],
    ["Infinity", "non numeric literal"],
  ])("rejects %s because of %s", (text) => {
    expect(parseTransactionAmountText(text)).toEqual({
      ok: false,
      error: "invalidFormat",
    });
  });

  it.each(["0", "0,0", "0,00", "0.000,00", "00000"])(
    "rejects %s because the amount must be greater than zero",
    (text) => {
      expect(parseTransactionAmountText(text)).toEqual({
        ok: false,
        error: "belowMinimum",
      });
    },
  );

  it.each([
    "1.000.000.000,00",
    "1000000000",
    "999.999.999.999.999.999,99",
    "0000001000000000,00",
  ])("rejects %s because it exceeds the accepted maximum", (text) => {
    expect(parseTransactionAmountText(text)).toEqual({
      ok: false,
      error: "aboveMaximum",
    });
  });

  it("rejects an amount one cent above the maximum", () => {
    expect(parseTransactionAmountText("1.000.000.000,00")).toEqual({
      ok: false,
      error: "aboveMaximum",
    });
    expect(parsedMinor("999.999.999,99") + 1).toBe(MAX_TRANSACTION_MINOR + 1);
  });

  it("does not lose precision on amounts a float would round", () => {
    expect(parsedMinor("0,07")).toBe(7);
    expect(parsedMinor("1,10")).toBe(110);
    expect(parsedMinor("8.014,20")).toBe(801420);
  });
});

describe("toMoneyMinor", () => {
  it.each([0, 1, -1, 123456, Number.MAX_SAFE_INTEGER])(
    "accepts the exact integer %i",
    (value) => {
      expect(toMoneyMinor(value)).toEqual({ ok: true, value });
      expect(isMoneyMinor(value)).toBe(true);
    },
  );

  it.each([0.5, -0.01, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])(
    "rejects %p because it cannot represent exact minor units",
    (value) => {
      expect(toMoneyMinor(value)).toEqual({
        ok: false,
        error: "notSafeInteger",
      });
      expect(isMoneyMinor(value)).toBe(false);
    },
  );
});

describe("addMoneyMinor", () => {
  it("adds amounts exactly, without floating-point drift", () => {
    const total = [
      "0,07",
      "0,1",
      "0,2",
      "1.234,56",
      "999.999.999,99",
    ].reduce<MoneyMinor>((accumulated, text) => {
      const result = addMoneyMinor(accumulated, parsedMinor(text));

      if (!result.ok) {
        throw new Error(`Unexpected overflow: ${result.error}`);
      }

      return result.value;
    }, checkedMinor(0));

    expect(total).toBe(7 + 10 + 20 + 123456 + 99999999999);
  });

  it("adds a negative balance component", () => {
    expect(addMoneyMinor(checkedMinor(120000), checkedMinor(-45000))).toEqual({
      ok: true,
      value: 75000,
    });
  });

  it("reports overflow instead of an imprecise positive total", () => {
    expect(
      addMoneyMinor(checkedMinor(Number.MAX_SAFE_INTEGER), checkedMinor(1)),
    ).toEqual({ ok: false, error: "overflow" });
  });

  it("reports overflow instead of an imprecise negative total", () => {
    expect(
      addMoneyMinor(checkedMinor(-Number.MAX_SAFE_INTEGER), checkedMinor(-1)),
    ).toEqual({ ok: false, error: "overflow" });
  });

  it("keeps the largest exact total available", () => {
    expect(
      addMoneyMinor(checkedMinor(Number.MAX_SAFE_INTEGER - 1), checkedMinor(1)),
    ).toEqual({ ok: true, value: Number.MAX_SAFE_INTEGER });
  });
});

describe("subtractMoneyMinor", () => {
  it("computes a balance as income minus expenses", () => {
    const income = parsedMinor("2.500,00");
    const expenses = parsedMinor("1.834,27");

    expect(subtractMoneyMinor(income, expenses)).toEqual({
      ok: true,
      value: 66573,
    });
  });

  it("returns a negative balance when expenses exceed income", () => {
    expect(
      subtractMoneyMinor(parsedMinor("100,00"), parsedMinor("150,50")),
    ).toEqual({ ok: true, value: -5050 });
  });

  it("returns zero when income equals expenses", () => {
    expect(
      subtractMoneyMinor(parsedMinor("999,99"), parsedMinor("999,99")),
    ).toEqual({ ok: true, value: 0 });
  });

  it("reports overflow instead of an imprecise difference", () => {
    expect(
      subtractMoneyMinor(
        checkedMinor(-Number.MAX_SAFE_INTEGER),
        checkedMinor(1),
      ),
    ).toEqual({ ok: false, error: "overflow" });
  });

  it("reports overflow when the difference grows past the exact range", () => {
    expect(
      subtractMoneyMinor(
        checkedMinor(Number.MAX_SAFE_INTEGER),
        checkedMinor(-1),
      ),
    ).toEqual({ ok: false, error: "overflow" });
  });
});

describe("roundDivisionHalfAwayFromZero", () => {
  it("keeps an exact quotient", () => {
    expect(roundDivisionHalfAwayFromZero(100_000, 2)).toEqual({
      ok: true,
      value: 50_000,
    });
  });

  it("rounds a positive remainder below half toward zero", () => {
    expect(roundDivisionHalfAwayFromZero(100_000, 3)).toEqual({
      ok: true,
      value: 33_333,
    });
  });

  it("rounds a positive half away from zero", () => {
    expect(roundDivisionHalfAwayFromZero(100_001, 2)).toEqual({
      ok: true,
      value: 50_001,
    });
  });

  it("rounds a negative half away from zero", () => {
    expect(roundDivisionHalfAwayFromZero(-100_001, 2)).toEqual({
      ok: true,
      value: -50_001,
    });
  });

  it("rounds a negative remainder below half toward zero", () => {
    expect(roundDivisionHalfAwayFromZero(-10, 3)).toEqual({
      ok: true,
      value: -3,
    });
  });

  it("applies the sign of a negative divisor", () => {
    expect(roundDivisionHalfAwayFromZero(100_001, -2)).toEqual({
      ok: true,
      value: -50_001,
    });
  });

  it("refuses a divisor of zero instead of inventing a quotient", () => {
    expect(roundDivisionHalfAwayFromZero(1, 0)).toEqual({
      ok: false,
      error: "overflow",
    });
  });

  it("refuses a numerator that is not an exact integer", () => {
    expect(roundDivisionHalfAwayFromZero(1.5, 2)).toEqual({
      ok: false,
      error: "notSafeInteger",
    });
  });

  it("refuses a divisor that is not an exact integer", () => {
    expect(roundDivisionHalfAwayFromZero(2, 1.5)).toEqual({
      ok: false,
      error: "notSafeInteger",
    });
  });
});

describe("presentAverageMinor", () => {
  it("presents the accepted monthly-average examples before display", () => {
    expect(presentAverageMinor(checkedMinor(100_000), 3)).toEqual({
      ok: true,
      value: 33_333,
    });
    expect(presentAverageMinor(checkedMinor(100_001), 2)).toEqual({
      ok: true,
      value: 50_001,
    });
    expect(presentAverageMinor(checkedMinor(-100_001), 2)).toEqual({
      ok: true,
      value: -50_001,
    });
  });

  it("refuses a zero divisor instead of presenting a zero average", () => {
    expect(presentAverageMinor(checkedMinor(100), 0)).toEqual({
      ok: false,
      error: "overflow",
    });
  });
});

describe("formatMoneyMinorAsEur", () => {
  it.each([
    [1, "0,01 €"],
    [1250, "12,50 €"],
    [123456, "1234,56 €"],
    [12345678, "123.456,78 €"],
    [99999999999, "999.999.999,99 €"],
    [0, "0,00 €"],
    [-5050, "-50,50 €"],
  ])("formats %i minor units as %s", (minor, expected) => {
    expect(withPlainSpaces(formatMoneyMinorAsEur(checkedMinor(minor)))).toBe(
      expected,
    );
  });

  it.each([
    [Number.MAX_SAFE_INTEGER, "90.071.992.547.409,91 €"],
    [Number.MAX_SAFE_INTEGER - 1, "90.071.992.547.409,90 €"],
    [-Number.MAX_SAFE_INTEGER, "-90.071.992.547.409,91 €"],
    [-(Number.MAX_SAFE_INTEGER - 1), "-90.071.992.547.409,90 €"],
    [-1, "-0,01 €"],
    [-100, "-1,00 €"],
  ])(
    "formats the exact cents of %i at the safe-integer boundary",
    (minor, expected) => {
      expect(withPlainSpaces(formatMoneyMinorAsEur(checkedMinor(minor)))).toBe(
        expected,
      );
    },
  );

  it("distinguishes adjacent amounts at both safe-integer boundaries", () => {
    const positives = [
      Number.MAX_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER - 1,
      Number.MAX_SAFE_INTEGER - 2,
    ].map((minor) => formatMoneyMinorAsEur(checkedMinor(minor)));
    const negatives = positives.map((_, index) =>
      formatMoneyMinorAsEur(checkedMinor(-(Number.MAX_SAFE_INTEGER - index))),
    );

    expect(new Set(positives).size).toBe(3);
    expect(new Set(negatives).size).toBe(3);
    expect(new Set([...positives, ...negatives]).size).toBe(6);
  });

  it("formats the accepted maximum without losing a cent", () => {
    expect(
      withPlainSpaces(formatMoneyMinorAsEur(parsedMinor("999.999.999,99"))),
    ).toBe("999.999.999,99 €");
  });
});

describe("formatMoneyMinorAsAmountText", () => {
  it.each([
    [1, "0,01"],
    [1250, "12,50"],
    [123456, "1234,56"],
    [12345678, "123.456,78"],
    [99999999999, "999.999.999,99"],
  ])("formats %i minor units as %s", (minor, expected) => {
    expect(
      withPlainSpaces(formatMoneyMinorAsAmountText(checkedMinor(minor))),
    ).toBe(expected);
  });

  it.each([
    [Number.MAX_SAFE_INTEGER, "90.071.992.547.409,91"],
    [Number.MAX_SAFE_INTEGER - 1, "90.071.992.547.409,90"],
    [9007199254740901, "90.071.992.547.409,01"],
    [-Number.MAX_SAFE_INTEGER, "-90.071.992.547.409,91"],
    [-1, "-0,01"],
    [-10, "-0,10"],
  ])(
    "formats the exact cents of %i at the safe-integer boundary",
    (minor, expected) => {
      expect(
        withPlainSpaces(formatMoneyMinorAsAmountText(checkedMinor(minor))),
      ).toBe(expected);
    },
  );

  it("keeps the exact cents that a major-unit division would round away", () => {
    expect(
      formatMoneyMinorAsAmountText(checkedMinor(Number.MAX_SAFE_INTEGER)),
    ).not.toBe(
      formatMoneyMinorAsAmountText(checkedMinor(Number.MAX_SAFE_INTEGER - 1)),
    );
    expect(
      formatMoneyMinorAsAmountText(checkedMinor(Number.MAX_SAFE_INTEGER)),
    ).toMatch(/,91$/);
    expect(
      formatMoneyMinorAsAmountText(checkedMinor(Number.MAX_SAFE_INTEGER - 1)),
    ).toMatch(/,90$/);
  });

  it.each([1, 10, 999, 1250, 123456, 12345678, 99999999999])(
    "round-trips %i minor units through its Spanish text",
    (minor) => {
      const text = formatMoneyMinorAsAmountText(checkedMinor(minor));

      expect(parseTransactionAmountText(text)).toEqual({
        ok: true,
        value: minor,
      });
    },
  );

  it("round-trips every accepted text back to the same text", () => {
    for (const text of ["0,01", "12,50", "1.234,56", "999.999.999,99"]) {
      expect(formatMoneyMinorAsAmountText(parsedMinor(text))).toBe(
        text.replace("1.234,56", "1234,56"),
      );
    }
  });
});
