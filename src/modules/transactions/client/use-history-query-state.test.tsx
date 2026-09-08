import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useSyncExternalStore } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const historyNav = vi.hoisted(() => {
  let search = "tab=all";
  const stack: string[] = [];
  const listeners = new Set<() => void>();

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot() {
      return search;
    },
    push(href: string) {
      stack.push(search);
      search = new URL(href, "http://localhost").searchParams.toString();
      listeners.forEach((listener) => {
        listener();
      });
    },
    back() {
      const previous = stack.pop();
      if (previous === undefined) {
        return;
      }

      search = previous;
      listeners.forEach((listener) => {
        listener();
      });
    },
    reset() {
      search = "tab=all";
      stack.length = 0;
    },
  };
});

vi.mock("next/navigation", () => ({
  usePathname: () => "/transactions",
  useRouter: () => ({
    push: (href: string) => {
      historyNav.push(href);
    },
    replace: vi.fn(),
  }),
  useSearchParams: () => {
    const search = useSyncExternalStore(
      historyNav.subscribe,
      historyNav.getSnapshot,
      historyNav.getSnapshot,
    );
    return new URLSearchParams(search);
  },
}));

import { useHistoryQueryState } from "./use-history-query-state";

afterEach(() => {
  historyNav.reset();
});

function QueryProbe() {
  const { state, setState, tab } = useHistoryQueryState();

  return (
    <div>
      <p>{`tab:${tab}`}</p>
      <p>{`q:${state.q}`}</p>
      <p>{`type:${state.type ?? ""}`}</p>
      <p>{`tags:${state.tagIds.join(",")}`}</p>
      <button
        onClick={() => {
          setState({
            q: "Café & té",
            type: "expense",
            categoryId: null,
            tagIds: ["tag-trips", "tag-trips", "tag-home"],
          });
        }}
        type="button"
      >
        Aplicar filtros
      </button>
      <button
        onClick={() => {
          setState({
            q: "",
            type: null,
            categoryId: null,
            tagIds: [],
          });
        }}
        type="button"
      >
        Quitar todos
      </button>
      <button
        onClick={() => {
          historyNav.back();
        }}
        type="button"
      >
        Atrás
      </button>
    </div>
  );
}

describe("useHistoryQueryState", () => {
  it("pushes encoded filters and restores them on back", async () => {
    const user = userEvent.setup();
    render(<QueryProbe />);

    expect(screen.getByText("tab:all")).toBeVisible();
    expect(screen.getByText("q:")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Aplicar filtros" }));

    expect(screen.getByText("q:Café & té")).toBeVisible();
    expect(screen.getByText("type:expense")).toBeVisible();
    expect(screen.getByText("tags:tag-trips,tag-home")).toBeVisible();
    expect(historyNav.getSnapshot()).toContain("Caf%C3%A9");
    expect(historyNav.getSnapshot()).toContain("%26");
    expect(historyNav.getSnapshot()).toContain("tagId=tag-trips");
    expect(historyNav.getSnapshot()).toContain("tagId=tag-home");
    expect(historyNav.getSnapshot()).not.toMatch(
      /tagId=tag-trips.*tagId=tag-trips/,
    );

    const encoded = historyNav.getSnapshot();
    await user.click(screen.getByRole("button", { name: "Aplicar filtros" }));
    expect(historyNav.getSnapshot()).toBe(encoded);

    await user.click(screen.getByRole("button", { name: "Quitar todos" }));
    expect(screen.getByText("q:")).toBeVisible();
    expect(screen.getByText("type:")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Atrás" }));
    expect(screen.getByText("q:Café & té")).toBeVisible();
    expect(screen.getByText("type:expense")).toBeVisible();
    expect(screen.getByText("tags:tag-trips,tag-home")).toBeVisible();
  });
});
