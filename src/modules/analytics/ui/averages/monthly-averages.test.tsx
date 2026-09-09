/**
 * Monthly averages block.
 *
 * The suite pins that the block states its own window and divisor, that it says
 * the current month is never included, that a history without a closed month
 * reports insufficient history instead of averages of zero, and that the shared
 * selection only decides which bars are drawn — never the global averages.
 */

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { emptyStateCopy } from "../../../../shared/ui/empty-state";
import type { MultiSelectOption } from "../../../../shared/ui/multi-select";
import { dashboardCopy } from "../dashboard-copy";
import { averages } from "../dashboard-fixtures";
import type { SeriesSelection } from "../series/use-series-selection";
import { MonthlyAverages } from "./monthly-averages";

vi.mock("next/link", () => ({
  default: function MockLink({
    children,
    href,
    ...props
  }: {
    children: ReactNode;
    href: string;
  }) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  },
}));

/** Replaces the narrow no-break spaces produced by Intl with plain spaces. */
function withPlainSpaces(text: string | null): string {
  return (text ?? "").replace(/[\u202f\u00a0]/g, " ");
}

const categoryOptions: MultiSelectOption[] = [
  { id: "cat-food", label: "Alimentación" },
  { id: "cat-old", label: "Antigua", archived: true },
];

const tagOptions: MultiSelectOption[] = [
  { id: "tag-trips", label: "Viajes" },
  { id: "untagged", label: dashboardCopy.untagged },
];

function selection(ids: readonly string[]): SeriesSelection {
  return { ids, setIds: vi.fn(), selectAll: vi.fn() };
}

function renderAverages(options?: {
  readonly categoryIds?: readonly string[];
  readonly tagIds?: readonly string[];
  readonly data?: typeof averages;
  readonly onSelectAll?: () => void;
}) {
  const categorySelection = {
    ...selection(options?.categoryIds ?? ["cat-food", "cat-old"]),
    selectAll: options?.onSelectAll ?? vi.fn(),
  };

  render(
    <MonthlyAverages
      averages={options?.data ?? averages}
      categoryOptions={categoryOptions}
      categorySelection={categorySelection}
      tagOptions={tagOptions}
      tagSelection={selection(options?.tagIds ?? ["tag-trips", "untagged"])}
    />,
  );

  return { categorySelection };
}

describe("MonthlyAverages", () => {
  it("states the window, its divisor and that the current month is out", () => {
    renderAverages();

    expect(
      screen.getByText("09/2025–08/2026 · 12 meses completos"),
    ).toBeVisible();
    expect(
      screen.getByText(dashboardCopy.averagesExcludesCurrentMonth),
    ).toBeVisible();
  });

  it("shows the two global averages with their exact figures", () => {
    renderAverages();

    const cards = screen.getByRole("list", {
      name: dashboardCopy.averagesCaption,
    });
    const expense = within(cards)
      .getByRole("heading", { name: dashboardCopy.averageExpense })
      .closest("li") as HTMLElement;
    const net = within(cards)
      .getByRole("heading", { name: dashboardCopy.averageNet })
      .closest("li") as HTMLElement;

    expect(
      withPlainSpaces(within(expense).getByText(/100,04/).textContent),
    ).toBe("100,04 €");
    const netFigure = within(net).getByText(/50,01/);
    expect(withPlainSpaces(netFigure.textContent)).toBe("−50,01 €");
    expect(netFigure).toHaveClass("text-expense");
  });

  it("publishes both averaged breakdowns as tables of exact figures", () => {
    renderAverages();

    const categoryTable = screen.getByRole("table", {
      name: dashboardCopy.averageCategoryCaption,
    });
    expect(
      within(categoryTable).getByRole("rowheader", { name: /Alimentación/ }),
    ).toBeVisible();

    const tagTable = screen.getByRole("table", {
      name: dashboardCopy.averageTagCaption,
    });
    expect(
      within(tagTable).getByRole("rowheader", { name: dashboardCopy.untagged }),
    ).toBeVisible();
    expect(screen.getAllByText(dashboardCopy.tagOverlap)).toHaveLength(1);
  });

  it("draws only the selected series and never changes the global averages", () => {
    renderAverages({ categoryIds: ["cat-food"], tagIds: ["tag-trips"] });

    const categoryTable = screen.getByRole("table", {
      name: dashboardCopy.averageCategoryCaption,
    });
    expect(within(categoryTable).getAllByRole("rowheader")).toHaveLength(1);

    const tagTable = screen.getByRole("table", {
      name: dashboardCopy.averageTagCaption,
    });
    expect(
      within(tagTable).queryByRole("rowheader", {
        name: dashboardCopy.untagged,
      }),
    ).not.toBeInTheDocument();

    // The block still divides the same exact sums by the same divisor.
    expect(screen.getByText(/100,04/)).toBeVisible();
  });

  it("offers Seleccionar todas when the selection hides every bar", async () => {
    const onSelectAll = vi.fn();
    renderAverages({ categoryIds: [], onSelectAll });

    const emptyState = screen.getByRole("region", {
      name: dashboardCopy.selectionEmptyTitle,
    });
    within(emptyState)
      .getByRole("button", { name: dashboardCopy.selectAll })
      .click();

    expect(onSelectAll).toHaveBeenCalled();
    expect(
      screen.queryByRole("table", {
        name: dashboardCopy.averageCategoryCaption,
      }),
    ).not.toBeInTheDocument();
  });

  it("says an average is unavailable instead of colouring a figure it has not got", () => {
    const broken =
      averages.kind === "months"
        ? {
            ...averages,
            net: { ...averages.net, monthCount: 0 },
          }
        : averages;

    renderAverages({ data: broken });

    const net = screen
      .getByRole("heading", { name: dashboardCopy.averageNet })
      .closest("li") as HTMLElement;
    const figure = within(net).getByText(dashboardCopy.unavailableAverage);

    expect(figure).toBeVisible();
    expect(figure).toHaveClass("text-text");
  });

  it("omits the history link of an average whose interval cannot be opened", () => {
    const broken =
      averages.kind === "months"
        ? {
            ...averages,
            totalExpense: {
              ...averages.totalExpense,
              drillDown: { ...averages.totalExpense.drillDown, untagged: true },
            },
          }
        : averages;

    renderAverages({ data: broken });

    const expense = screen
      .getByRole("heading", { name: dashboardCopy.averageExpense })
      .closest("li") as HTMLElement;

    expect(within(expense).queryByRole("link")).not.toBeInTheDocument();
    expect(
      within(
        screen
          .getByRole("heading", { name: dashboardCopy.averageNet })
          .closest("li") as HTMLElement,
      ).getByRole("link", { name: dashboardCopy.viewWindowMovements }),
    ).toBeVisible();
  });

  it("reports insufficient history instead of averages of zero", () => {
    renderAverages({ data: { kind: "insufficientHistory" } });

    expect(
      screen.getByRole("heading", {
        name: emptyStateCopy.insufficientHistory.title,
      }),
    ).toBeVisible();
    expect(
      screen.queryByRole("list", { name: dashboardCopy.averagesCaption }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/meses completos$/)).not.toBeInTheDocument();
  });
});
