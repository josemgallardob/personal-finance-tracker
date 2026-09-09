/**
 * Series selectors of the dashboard.
 *
 * The suite pins the interaction the accepted design asks for: a compact
 * trigger with the selected count, a searchable panel, the two bulk actions,
 * archived options offered as archived and selectable, and a selection that
 * only reaches the caller when the owner applies it.
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { multiSelectCopy } from "../../../../shared/ui/multi-select";
import { dashboardCopy } from "../dashboard-copy";
import { CategorySeriesSelector, TagSeriesSelector } from "./series-selectors";

const categoryOptions = [
  { id: "cat-food", label: "Alimentación" },
  { id: "cat-home", label: "Hogar" },
  { id: "cat-old", label: "Antigua", archived: true },
];

function renderSelector(value: readonly string[] = ["cat-food", "cat-home"]) {
  const onChange = vi.fn();
  render(
    <CategorySeriesSelector
      onChange={onChange}
      options={categoryOptions}
      value={value}
    />,
  );

  return { onChange };
}

async function openPanel(
  trigger = `${dashboardCopy.categorySelectorTrigger} · 2`,
): Promise<HTMLElement> {
  await userEvent.click(screen.getByRole("button", { name: trigger }));

  return screen.getByRole("dialog", {
    name: dashboardCopy.categorySelectorTitle,
  });
}

describe("CategorySeriesSelector", () => {
  it("shows how many series are drawn on its own trigger", () => {
    renderSelector();

    expect(
      screen.getByRole("button", {
        name: `${dashboardCopy.categorySelectorTrigger} · 2`,
      }),
    ).toBeVisible();
  });

  it("applies a choice only when the owner confirms it", async () => {
    const { onChange } = renderSelector();
    const panel = await openPanel();

    await userEvent.click(
      within(panel).getByRole("checkbox", { name: "Hogar" }),
    );
    expect(onChange).not.toHaveBeenCalled();

    await userEvent.click(
      within(panel).getByRole("button", { name: multiSelectCopy.apply }),
    );

    expect(onChange).toHaveBeenCalledWith(["cat-food"]);
  });

  it("keeps the applied selection when the panel is cancelled", async () => {
    const { onChange } = renderSelector();
    const panel = await openPanel();

    await userEvent.click(
      within(panel).getByRole("checkbox", { name: "Hogar" }),
    );
    await userEvent.click(
      within(panel).getByRole("button", { name: multiSelectCopy.cancel }),
    );

    expect(onChange).not.toHaveBeenCalled();
  });

  it("selects and clears every option through the bulk actions", async () => {
    const { onChange } = renderSelector();
    const panel = await openPanel();

    await userEvent.click(
      within(panel).getByRole("button", { name: multiSelectCopy.clearAll }),
    );
    await userEvent.click(
      within(panel).getByRole("button", { name: multiSelectCopy.apply }),
    );
    expect(onChange).toHaveBeenLastCalledWith([]);

    const reopened = await openPanel();
    await userEvent.click(
      within(reopened).getByRole("button", { name: multiSelectCopy.selectAll }),
    );
    await userEvent.click(
      within(reopened).getByRole("button", { name: multiSelectCopy.apply }),
    );

    expect(onChange).toHaveBeenLastCalledWith([
      "cat-food",
      "cat-home",
      "cat-old",
    ]);
  });

  it("filters the list by the search text without losing the selection", async () => {
    const { onChange } = renderSelector();
    const panel = await openPanel();

    await userEvent.type(
      within(panel).getByRole("searchbox", { name: multiSelectCopy.search }),
      "hog",
    );

    expect(within(panel).getAllByRole("checkbox")).toHaveLength(1);
    await userEvent.click(
      within(panel).getByRole("checkbox", { name: "Hogar" }),
    );
    await userEvent.click(
      within(panel).getByRole("button", { name: multiSelectCopy.apply }),
    );

    expect(onChange).toHaveBeenCalledWith(["cat-food"]);
  });

  it("offers an archived category as archived and lets the owner draw it", async () => {
    const { onChange } = renderSelector();
    const panel = await openPanel();
    const archived = within(panel).getByRole("checkbox", {
      name: `Antigua (${multiSelectCopy.archived})`,
    });

    expect(archived).toBeEnabled();
    expect(archived).not.toBeChecked();

    await userEvent.click(archived);
    await userEvent.click(
      within(panel).getByRole("button", { name: multiSelectCopy.apply }),
    );

    expect(onChange).toHaveBeenCalledWith(["cat-food", "cat-home", "cat-old"]);
  });
});

describe("TagSeriesSelector", () => {
  it("names its own dimension and carries the untagged group", async () => {
    const onChange = vi.fn();
    render(
      <TagSeriesSelector
        onChange={onChange}
        options={[
          { id: "tag-trips", label: "Viajes" },
          { id: "untagged", label: dashboardCopy.untagged },
        ]}
        value={["tag-trips"]}
      />,
    );

    await userEvent.click(
      screen.getByRole("button", {
        name: `${dashboardCopy.tagSelectorTrigger} · 1`,
      }),
    );
    const panel = screen.getByRole("dialog", {
      name: dashboardCopy.tagSelectorTitle,
    });

    await userEvent.click(
      within(panel).getByRole("checkbox", { name: dashboardCopy.untagged }),
    );
    await userEvent.click(
      within(panel).getByRole("button", { name: multiSelectCopy.apply }),
    );

    expect(onChange).toHaveBeenCalledWith(["tag-trips", "untagged"]);
  });
});
