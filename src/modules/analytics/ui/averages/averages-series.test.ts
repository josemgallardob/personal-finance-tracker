/**
 * Presentation of the monthly averages.
 *
 * The suite pins the rounding rule of the accepted design — nearest cent, half
 * away from zero, negatives included — and the rule that no figure is ever
 * obtained by adding averages that were already rounded: the two category
 * averages of the documented example add up to one cent more than the total
 * average, and both are right because each comes from its own exact sum.
 */

import { describe, expect, it } from "vitest";

import type {
  CategoryAverageDto,
  ExactAverageDto,
} from "../../contracts/averages";
import { dashboardCopy } from "../dashboard-copy";
import { averages } from "../dashboard-fixtures";
import {
  averageAmountLabel,
  averagesWindowLabel,
  categoryAverageBars,
  presentedAverageMinor,
  signedAverageAmountLabel,
  tagAverageBars,
} from "./averages-series";

/** Replaces the narrow no-break spaces produced by Intl with plain spaces. */
function withPlainSpaces(text: string): string {
  return text.replace(/[\u202f\u00a0]/g, " ");
}

const monthsAverages = averages.kind === "months" ? averages : null;

function exact(totalMinor: number, monthCount: number): ExactAverageDto {
  return {
    totalMinor,
    monthCount,
    drillDown: {
      dateFrom: "2025-09-01",
      dateTo: "2026-08-31",
      type: "expense",
      categoryId: null,
      tagIds: [],
      untagged: false,
    },
  };
}

describe("presentedAverageMinor", () => {
  it("rounds to the nearest cent, with halves moving away from zero", () => {
    expect(presentedAverageMinor(exact(100000, 3))).toBe(33333);
    expect(presentedAverageMinor(exact(100001, 2))).toBe(50001);
    expect(presentedAverageMinor(exact(-100001, 2))).toBe(-50001);
  });

  it("never derives a total by adding averages that were already rounded", () => {
    const house = presentedAverageMinor(exact(10001, 2));
    const leisure = presentedAverageMinor(exact(10001, 2));
    const both = presentedAverageMinor(exact(20002, 2));

    expect([house, leisure, both]).toEqual([5001, 5001, 10001]);
    expect((house ?? 0) + (leisure ?? 0)).not.toBe(both);
  });

  it("reports no average when there is no divisor to use", () => {
    expect(presentedAverageMinor(exact(10000, 0))).toBeNull();
    expect(averageAmountLabel(exact(10000, 0))).toBe(
      dashboardCopy.unavailableAverage,
    );
    expect(signedAverageAmountLabel(exact(10000, 0))).toBe(
      dashboardCopy.unavailableAverage,
    );
  });
});

describe("average labels", () => {
  it("formats an average as exact EUR", () => {
    expect(withPlainSpaces(averageAmountLabel(exact(120050, 12)))).toBe(
      "100,04 €",
    );
  });

  it("keeps the sign of a negative monthly balance visible", () => {
    // −600,06 € over twelve months is exactly −50,005 €, which rounds away
    // from zero to −50,01 €.
    expect(withPlainSpaces(signedAverageAmountLabel(exact(-60006, 12)))).toBe(
      "−50,01 €",
    );
    expect(withPlainSpaces(signedAverageAmountLabel(exact(0, 12)))).toBe(
      "0,00 €",
    );
  });

  it("states the window and how many complete months divide it", () => {
    expect(
      averagesWindowLabel(
        monthsAverages?.context.window ?? {
          start: "",
          end: "",
          months: [],
          monthCount: 0,
          range: { start: "", end: "" },
        },
      ),
    ).toBe("09/2025–08/2026 · 12 meses completos");
  });

  it("names a window of a single closed month in the singular", () => {
    expect(
      averagesWindowLabel({
        start: "2026-08",
        end: "2026-08",
        months: ["2026-08"],
        monthCount: 1,
        range: { start: "2026-08-01", end: "2026-08-31" },
      }),
    ).toBe("08/2026–08/2026 · 1 mes completo");
  });
});

describe("categoryAverageBars", () => {
  it("divides every group by its own divisor and keeps its identity", () => {
    const bars = categoryAverageBars(monthsAverages?.byCategory ?? []);

    expect(bars.map((bar) => bar.id)).toEqual(["cat-food", "cat-old"]);
    expect(withPlainSpaces(bars[0].amountLabel)).toBe("75,00 €");
    expect(withPlainSpaces(bars[1].amountLabel)).toBe("25,04 €");
    expect(bars[1]).toMatchObject({ archived: true, shareLabel: null });
    expect(bars[0].href).toContain("categoryId=cat-food");
  });

  it("draws no bar for a group whose average rounds to nothing", () => {
    const entry = (monthsAverages?.byCategory ?? [])[0] as CategoryAverageDto;
    const bars = categoryAverageBars([{ ...entry, totalMinor: 0 }]);

    expect(bars).toEqual([]);
  });

  it("draws no width for an average the contract should never have sent", () => {
    const entry = (monthsAverages?.byCategory ?? [])[0] as CategoryAverageDto;
    const bars = categoryAverageBars([{ ...entry, totalMinor: -1200 }]);

    expect(bars[0].widthPercent).toBe(0);
  });

  it("scales the bars against the widest average of the breakdown", () => {
    const bars = categoryAverageBars(monthsAverages?.byCategory ?? []);

    expect(bars.map((bar) => bar.widthPercent)).toEqual([100, 33]);
  });
});

describe("tagAverageBars", () => {
  it("adds the untagged group and states no percentage anywhere", () => {
    const bars = tagAverageBars(
      monthsAverages?.byTag ?? [],
      monthsAverages?.untagged ?? exact(0, 12),
    );

    expect(bars.map((bar) => bar.id)).toEqual(["tag-trips", "untagged"]);
    expect(withPlainSpaces(bars[1].amountLabel)).toBe("33,38 €");
    expect(bars[1].countLabel).toBe("");
    expect(bars.every((bar) => bar.shareLabel === null)).toBe(true);
  });

  it("omits the untagged group when the window has no untagged expense", () => {
    const bars = tagAverageBars(monthsAverages?.byTag ?? [], exact(0, 12));

    expect(bars.map((bar) => bar.id)).toEqual(["tag-trips"]);
  });
});
