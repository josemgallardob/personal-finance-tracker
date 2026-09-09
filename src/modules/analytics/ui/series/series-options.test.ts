/**
 * Options each series selector offers.
 *
 * The suite pins that an active classification is always offered, that an
 * archived one is offered only when it really has an amount in one of the two
 * windows, and that the computed untagged group appears only when there is
 * untagged expense to draw.
 */

import { describe, expect, it } from "vitest";

import {
  categories,
  tags,
} from "../../../transactions/ui/transaction-dialog-fixtures";
import { dashboardCopy } from "../dashboard-copy";
import {
  categorySeriesOptions,
  idsWithAmount,
  tagSeriesOptions,
} from "./series-options";

describe("categorySeriesOptions", () => {
  it("offers the active expense categories, and no income category", () => {
    const options = categorySeriesOptions(categories, new Set());

    expect(options.map((option) => option.id)).toEqual(["cat-food"]);
    expect(options.every((option) => option.archived === false)).toBe(true);
  });

  it("offers an archived category only when it has an amount to draw", () => {
    const options = categorySeriesOptions(categories, new Set(["cat-old"]));

    expect(options.map((option) => option.id)).toEqual(["cat-food", "cat-old"]);
    expect(options[1]).toMatchObject({ label: "Antigua", archived: true });
  });
});

describe("tagSeriesOptions", () => {
  it("offers active tags and the archived ones that have an amount", () => {
    const options = tagSeriesOptions(tags, new Set(["tag-old"]), false);

    expect(options.map((option) => option.id)).toEqual([
      "tag-trips",
      "tag-old",
    ]);
    expect(options[1]).toMatchObject({ archived: true });
  });

  it("offers the untagged group only when there is untagged expense", () => {
    expect(
      tagSeriesOptions(tags, new Set(), false).map((option) => option.id),
    ).toEqual(["tag-trips"]);

    const withUntagged = tagSeriesOptions(tags, new Set(), true);
    expect(withUntagged.at(-1)).toMatchObject({
      id: "untagged",
      label: dashboardCopy.untagged,
      archived: false,
    });
  });
});

describe("idsWithAmount", () => {
  it("collects the identifiers that carry money in any of the windows", () => {
    const ids = idsWithAmount(
      [
        { id: "cat-food", totalMinor: 100 },
        { id: "cat-empty", totalMinor: 0 },
      ],
      [{ id: "cat-old", totalMinor: 5 }],
    );

    expect([...ids].sort()).toEqual(["cat-food", "cat-old"]);
  });
});
