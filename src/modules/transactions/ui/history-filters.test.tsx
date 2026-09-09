import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { emptyHistoryQueryState } from "../client/history-query-state";
import { HISTORY_SEARCH_DEBOUNCE_MS } from "../client/history-query-state";
import type { HistoryQueryState } from "../client/history-query-state";
import { historyCopy } from "./history-copy";
import { HistoryFilters } from "./history-filters";
import { categories, tags } from "./transaction-dialog-fixtures";

function ControlledFilters({
  initial = emptyHistoryQueryState,
}: {
  readonly initial?: HistoryQueryState;
}) {
  const [value, setValue] = useState(initial);
  return (
    <HistoryFilters
      categories={categories}
      onChange={setValue}
      tags={tags}
      value={value}
    />
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("HistoryFilters", () => {
  it("debounces search by 300ms and keeps the URL write unique for tags", async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(
      <HistoryFilters
        categories={categories}
        onChange={onChange}
        tags={tags}
        value={emptyHistoryQueryState}
      />,
    );

    fireEvent.change(screen.getByLabelText(historyCopy.searchLabel), {
      target: { value: "Café" },
    });
    expect(onChange).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(HISTORY_SEARCH_DEBOUNCE_MS - 1);
    expect(onChange).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onChange).toHaveBeenLastCalledWith({
      ...emptyHistoryQueryState,
      q: "Café",
    });

    vi.useRealTimers();
    const user = userEvent.setup();
    await user.selectOptions(
      screen.getByLabelText(historyCopy.typeLabel),
      "expense",
    );
    expect(onChange).toHaveBeenLastCalledWith({
      ...emptyHistoryQueryState,
      type: "expense",
    });

    await user.click(screen.getByRole("button", { name: /Etiquetas · 0/ }));
    await user.click(screen.getByRole("checkbox", { name: "Viajes" }));
    await user.click(screen.getByRole("checkbox", { name: "Viajes" }));
    await user.click(screen.getByRole("checkbox", { name: "Viajes" }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...emptyHistoryQueryState,
      tagIds: ["tag-trips"],
    });
  });

  it("removes chips and clears every filter", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const value = {
      ...emptyHistoryQueryState,
      q: "Café",
      type: "expense" as const,
      categoryId: "cat-food",
      tagIds: ["tag-trips", "tag-trips"],
    };
    render(
      <HistoryFilters
        categories={categories}
        onChange={onChange}
        tags={tags}
        value={value}
      />,
    );

    const chips = screen.getByRole("list", { name: historyCopy.chipsLabel });
    expect(within(chips).getAllByRole("listitem")).toHaveLength(4);

    await user.click(
      screen.getByRole("button", {
        name: historyCopy.removeFilter(historyCopy.searchChip("Café")),
      }),
    );
    expect(onChange.mock.calls.at(-1)?.[0]).toMatchObject({ q: "" });

    await user.click(
      screen.getByRole("button", { name: historyCopy.clearFilters }),
    );
    expect(onChange).toHaveBeenLastCalledWith(emptyHistoryQueryState);
  });

  it("keeps type when search debounce fires after another filter", async () => {
    const user = userEvent.setup();
    render(<ControlledFilters />);

    await user.selectOptions(
      screen.getByLabelText(historyCopy.typeLabel),
      "expense",
    );
    await user.type(screen.getByLabelText(historyCopy.searchLabel), "Café");

    expect(
      await screen.findByRole(
        "button",
        {
          name: historyCopy.removeFilter(historyCopy.searchChip("Café")),
        },
        { timeout: 1500 },
      ),
    ).toBeVisible();
    expect(screen.getByLabelText(historyCopy.typeLabel)).toHaveValue("expense");
    expect(
      screen.getByRole("button", {
        name: historyCopy.removeFilter(historyCopy.expense),
      }),
    ).toBeVisible();
  });

  it("clears an incompatible category and names every control for assistive tech", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <HistoryFilters
        categories={categories}
        onChange={onChange}
        tags={tags}
        value={{
          ...emptyHistoryQueryState,
          type: "expense",
          categoryId: "cat-food",
        }}
      />,
    );

    expect(
      screen.getByRole("group", { name: historyCopy.filtersLabel }),
    ).toBeVisible();
    expect(screen.getByLabelText(historyCopy.searchLabel)).toHaveAttribute(
      "type",
      "search",
    );
    expect(screen.getByLabelText(historyCopy.categoryLabel)).toBeEnabled();

    await user.selectOptions(
      screen.getByLabelText(historyCopy.typeLabel),
      "income",
    );
    expect(onChange).toHaveBeenLastCalledWith({
      ...emptyHistoryQueryState,
      type: "income",
      categoryId: null,
    });
  });
});

describe("HistoryFilters and the computed untagged group", () => {
  it("summarises the group as a chip the owner can remove", async () => {
    const onChange = vi.fn();
    render(
      <HistoryFilters
        categories={categories}
        onChange={onChange}
        tags={tags}
        value={{ ...emptyHistoryQueryState, untagged: true }}
      />,
    );

    const chips = screen.getByRole("list", { name: historyCopy.chipsLabel });
    expect(within(chips).getByText(historyCopy.noTags)).toBeVisible();

    await userEvent.click(
      within(chips).getByRole("button", {
        name: historyCopy.removeFilter(historyCopy.noTags),
      }),
    );

    expect(onChange).toHaveBeenCalledWith(emptyHistoryQueryState);
  });

  it("leaves the group as soon as the owner filters by a real tag", async () => {
    const onChange = vi.fn();
    render(
      <HistoryFilters
        categories={categories}
        onChange={onChange}
        tags={tags}
        value={{ ...emptyHistoryQueryState, untagged: true }}
      />,
    );

    await userEvent.click(
      screen.getByRole("button", {
        name: `${historyCopy.tagsFilterLabel} · 0`,
      }),
    );
    await userEvent.click(screen.getByRole("checkbox", { name: "Viajes" }));

    expect(onChange).toHaveBeenCalledWith({
      ...emptyHistoryQueryState,
      tagIds: ["tag-trips"],
      untagged: false,
    });
  });
});
