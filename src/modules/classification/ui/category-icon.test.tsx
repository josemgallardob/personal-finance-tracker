/**
 * Automatic category badge.
 *
 * The catalog promises a stable icon and color per identifier. These tests
 * pin that every seeded category has its own drawing, that a category created
 * by the owner still gets one, and that the badge stays decorative so the row
 * name remains the only accessible name.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  INITIAL_CATEGORY_CATALOG,
  categoryPresentation,
} from "../domain/initial-category-catalog";
import {
  CategoryIcon,
  FALLBACK_CATEGORY_ICON_PATH,
  categoryIconPath,
} from "./category-icon";

describe("categoryIconPath", () => {
  it("draws every icon key of the accepted catalog without falling back", () => {
    const seededKeys = INITIAL_CATEGORY_CATALOG.map((seed) => seed.iconKey);
    const drawn = seededKeys.map((key) => categoryIconPath(key));

    expect(seededKeys).toHaveLength(28);
    expect(
      drawn.filter((path) => path === FALLBACK_CATEGORY_ICON_PATH),
    ).toHaveLength(1);
    expect(new Set(drawn).size).toBe(new Set(seededKeys).size);
  });

  it("uses the neutral drawing for an unknown key", () => {
    expect(categoryIconPath("unknown-key")).toBe(FALLBACK_CATEGORY_ICON_PATH);
  });
});

describe("CategoryIcon", () => {
  it("keeps the seeded combination of a catalog category", () => {
    render(<CategoryIcon categoryId="seed-exp-alquiler" />);

    const badge = screen.getByTestId("category-icon-seed-exp-alquiler");

    expect(badge).toHaveAttribute("data-icon-key", "rent");
    expect(badge).toHaveAttribute("aria-hidden", "true");
    expect(badge.querySelector("path")).toHaveAttribute(
      "d",
      categoryIconPath("rent"),
    );
  });

  it("gives a category created by the owner a stable drawing and color", () => {
    const { unmount } = render(<CategoryIcon categoryId="cat-custom-1" />);
    const first = screen.getByTestId("category-icon-cat-custom-1");
    const firstKey = first.getAttribute("data-icon-key");
    const firstColor = first.getAttribute("style");

    unmount();
    render(<CategoryIcon categoryId="cat-custom-1" />);
    const second = screen.getByTestId("category-icon-cat-custom-1");

    expect(firstKey).toBe(categoryPresentation("cat-custom-1").iconKey);
    expect(second.getAttribute("data-icon-key")).toBe(firstKey);
    expect(second.getAttribute("style")).toBe(firstColor);
  });

  it("stays out of the accessibility tree so the name is not repeated", () => {
    render(
      <p>
        <CategoryIcon categoryId="seed-inc-sueldo" />
        Sueldo
      </p>,
    );

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("Sueldo")).toBeVisible();
  });
});
