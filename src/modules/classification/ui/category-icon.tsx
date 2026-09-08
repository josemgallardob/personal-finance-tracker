/**
 * Automatic icon of a category.
 *
 * The catalog already assigns every category a stable icon key and color
 * derived from its identifier, so a rename or a reorder never changes how a
 * category looks. This module is the only place that turns that key into a
 * drawing: the badge is decorative and always accompanied by the written name,
 * because a colored glyph alone would make income and expense depend on color.
 */

import { categoryPresentation } from "../domain/initial-category-catalog";

/** Path data of every icon key the catalog can assign, in a 24x24 viewBox. */
const CATEGORY_ICON_PATHS: Readonly<Record<string, string>> = Object.freeze({
  rent: "M3 12 12 4l9 8M6 10v10h12V10M10 20v-6h4v6",
  utilities: "M13 3 5 14h6l-2 7 8-11h-6z",
  groceries: "M4 8h16l-2 11H6zM9 8l3-5 3 5",
  car: "M4 16v-3l2-5h12l2 5v3zM7 16v2M17 16v2",
  transit: "M6 4h12v11H6zM6 9h12M6 15l-2 4M18 15l2 4",
  education: "M2 9l10-4 10 4-10 4zM6 11v5c0 1 12 1 12 0v-5",
  gym: "M3 9v6M6 7v10M18 7v10M21 9v6M6 12h12",
  sports:
    "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M3 12h18M12 3c4 5 4 13 0 18M12 3c-4 5-4 13 0 18",
  salon:
    "M7 4l10 14M17 4 7 18M6 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4M18 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4",
  subscriptions: "M20 12a8 8 0 1 1-3-6M20 4v5h-5",
  takeaway: "M5 8h14l-1.5 12h-11zM8 8l1-4h6l1 4",
  tobacco: "M3 15h14v4H3zM19 15h2v4h-2M17 5v4M20 5v4",
  fashion: "M8 4 4 7l2 3 2-1v10h8V9l2 1 2-3-4-3-4 2z",
  sportswear: "M3 12h4l3 4h6l4 2v2H3zM3 12v6",
  books: "M4 5h7v15H4zM13 5h7v15h-7z",
  tech: "M5 6h14v9H5zM3 18h18",
  games:
    "M7 9h10a4 4 0 0 1 0 8H7a4 4 0 0 1 0-8M9 11v3M7.5 12.5h3M15.5 12h.01M17.5 14h.01",
  health: "M12 20S5 15.5 5 11a4 4 0 0 1 7-2.5A4 4 0 0 1 19 11c0 4.5-7 9-7 9",
  "personal-care": "M12 3s6 6.5 6 10a6 6 0 0 1-12 0c0-3.5 6-10 6-10",
  home: "M3 12l9-8 9 8M6 10v10h12V10",
  gifts:
    "M3 9h18v4H3zM5 13h14v8H5zM12 9v12M12 9C9 9 8 8 8 6.5S9 4 12 9M12 9c3 0 4-1 4-2.5S15 4 12 9",
  travel: "M22 3 11 14M22 3l-7 19-4-8-8-4z",
  leisure: "M12 3l2.7 5.5 6 .9-4.3 4.2 1 6-5.4-2.8L6.6 19.6l1-6L3.3 9.4l6-.9z",
  other: "M6 12h.01M12 12h.01M18 12h.01",
  salary: "M3 7h18v10H3zM12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4",
  sales: "M3 12 12 3h8v8l-9 9zM16 8h.01",
  "gifts-received": "M3 10h18v4H3zM5 14h14v7H5zM12 10v11M8 3l4 4 4-4",
  "other-income": "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 8v8M9 13l3 3 3-3",
});

/** Drawing used when a key has no dedicated glyph. */
export const FALLBACK_CATEGORY_ICON_PATH = CATEGORY_ICON_PATHS.other as string;

/** Returns the path data of an icon key, or the neutral fallback drawing. */
export function categoryIconPath(iconKey: string): string {
  return CATEGORY_ICON_PATHS[iconKey] ?? FALLBACK_CATEGORY_ICON_PATH;
}

export interface CategoryIconProps {
  readonly categoryId: string;
}

/**
 * Renders the decorative badge of a category.
 *
 * The element is hidden from assistive technology on purpose: the row already
 * exposes the name, the type section and the archival state as text.
 */
export function CategoryIcon({ categoryId }: CategoryIconProps) {
  const presentation = categoryPresentation(categoryId);

  return (
    <span
      aria-hidden="true"
      data-testid={`category-icon-${categoryId}`}
      data-icon-key={presentation.iconKey}
      className="inline-flex size-10 shrink-0 items-center justify-center rounded-full"
      style={{
        color: presentation.color,
        backgroundColor: `color-mix(in srgb, ${presentation.color} 18%, transparent)`,
      }}
    >
      <svg
        viewBox="0 0 24 24"
        className="size-5"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        focusable="false"
      >
        <path d={categoryIconPath(presentation.iconKey)} />
      </svg>
    </span>
  );
}
