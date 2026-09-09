/**
 * Selection of one dimension across a session.
 *
 * The suite pins the policy of the accepted design: while the owner has not
 * touched a selector the selection follows the catalog, so an active
 * classification created afterwards joins it on its own; once the owner has
 * chosen, the choice is kept exactly, survives a remount and never mixes with
 * the selection of another application mode.
 */

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { MultiSelectOption } from "../../../../shared/ui/multi-select";
import type { SeriesStorage } from "./series-selection";
import { useSeriesSelection } from "./use-series-selection";

function memoryStorage(initial: Record<string, string> = {}): SeriesStorage & {
  readonly entries: Record<string, string>;
} {
  const entries: Record<string, string> = { ...initial };

  return {
    entries,
    getItem: (key) => entries[key] ?? null,
    setItem: (key, value) => {
      entries[key] = value;
    },
  };
}

const catalog: MultiSelectOption[] = [
  { id: "cat-food", label: "Alimentación" },
  { id: "cat-old", label: "Antigua", archived: true },
];

function Harness({
  mode = "personal",
  options = catalog,
  storage,
}: {
  readonly mode?: string | null;
  readonly options?: readonly MultiSelectOption[];
  /** Undefined asks the hook for the real session of the browser. */
  readonly storage: SeriesStorage | null | undefined;
}) {
  const selection = useSeriesSelection({
    dimension: "categories",
    mode,
    options,
    ...(storage === undefined ? {} : { storage }),
  });

  return (
    <div>
      <p data-testid="ids">{selection.ids.join(",")}</p>
      <button
        onClick={() => {
          selection.setIds(["cat-old"]);
        }}
        type="button"
      >
        Elegir archivada
      </button>
      <button onClick={selection.selectAll} type="button">
        Seleccionar todas
      </button>
    </div>
  );
}

function ids(): string {
  return screen.getByTestId("ids").textContent ?? "";
}

describe("useSeriesSelection", () => {
  it("selects every active option while the session has made no choice", async () => {
    const storage = memoryStorage();

    render(<Harness storage={storage} />);

    await waitFor(() => {
      expect(ids()).toBe("cat-food");
    });
    expect(storage.entries).toEqual({});
  });

  it("adds an active option created later, until the owner chooses", async () => {
    const storage = memoryStorage();
    const { rerender } = render(<Harness storage={storage} />);

    await waitFor(() => {
      expect(ids()).toBe("cat-food");
    });

    rerender(
      <Harness
        options={[...catalog, { id: "cat-new", label: "Nueva" }]}
        storage={storage}
      />,
    );

    expect(ids()).toBe("cat-food,cat-new");
  });

  it("keeps the choice of the owner and stops following the catalog", async () => {
    const storage = memoryStorage();
    const { rerender } = render(<Harness storage={storage} />);
    await waitFor(() => {
      expect(ids()).toBe("cat-food");
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Elegir archivada" }),
    );

    expect(ids()).toBe("cat-old");
    expect(storage.entries["dashboard:series:categories:personal"]).toBe(
      '["cat-old"]',
    );

    rerender(
      <Harness
        options={[...catalog, { id: "cat-new", label: "Nueva" }]}
        storage={storage}
      />,
    );

    expect(ids()).toBe("cat-old");
  });

  it("restores the stored choice when the dashboard is opened again", async () => {
    const storage = memoryStorage({
      "dashboard:series:categories:personal": '["cat-old"]',
    });

    render(<Harness storage={storage} />);

    await waitFor(() => {
      expect(ids()).toBe("cat-old");
    });
  });

  it("keeps an empty choice instead of falling back to every option", async () => {
    const storage = memoryStorage({
      "dashboard:series:categories:personal": "[]",
    });

    render(<Harness storage={storage} />);

    await waitFor(() => {
      expect(ids()).toBe("");
    });
  });

  it("never reads the selection stored for another application mode", async () => {
    const storage = memoryStorage({
      "dashboard:series:categories:demo": '["cat-old"]',
    });

    const { rerender } = render(<Harness storage={storage} />);
    await waitFor(() => {
      expect(ids()).toBe("cat-food");
    });

    rerender(<Harness mode="demo" storage={storage} />);

    await waitFor(() => {
      expect(ids()).toBe("cat-old");
    });
  });

  it("restores every active option through Seleccionar todas", async () => {
    const storage = memoryStorage({
      "dashboard:series:categories:personal": "[]",
    });
    render(<Harness storage={storage} />);
    await waitFor(() => {
      expect(ids()).toBe("");
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Seleccionar todas" }),
    );

    expect(ids()).toBe("cat-food");
    expect(storage.entries["dashboard:series:categories:personal"]).toBe(
      '["cat-food"]',
    );
  });

  it("keeps working, without persisting, while the mode is unknown", async () => {
    const storage = memoryStorage();
    render(<Harness mode={null} storage={storage} />);

    expect(ids()).toBe("cat-food");

    await act(async () => {
      screen.getByRole("button", { name: "Elegir archivada" }).click();
    });

    expect(ids()).toBe("cat-food");
    expect(storage.entries).toEqual({});
  });

  it("works without any session storage at all", async () => {
    render(<Harness storage={null} />);

    await waitFor(() => {
      expect(ids()).toBe("cat-food");
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Elegir archivada" }),
    );

    expect(ids()).toBe("cat-old");
  });
});

describe("useSeriesSelection against the real session storage", () => {
  it("reads and writes the session of the browser when none is injected", async () => {
    window.sessionStorage.clear();

    render(
      <Harness options={catalog} storage={undefined as unknown as null} />,
    );
    await waitFor(() => {
      expect(ids()).toBe("cat-food");
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Elegir archivada" }),
    );

    expect(ids()).toBe("cat-old");
    expect(
      window.sessionStorage.getItem("dashboard:series:categories:personal"),
    ).toBe('["cat-old"]');
    window.sessionStorage.clear();
  });
});
