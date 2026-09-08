/**
 * Movements route.
 *
 * The page is checked with the browser `fetch` replaced and nothing else, so
 * the assertion is that Todos really wires the default adapters to the
 * documented endpoints of the current origin.
 */

import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FinancialDataProvider } from "../../shared/client/financial-data-provider";
import { REQUEST_ID_HEADER } from "../../shared/contracts/http";
import { emptyStateCopy } from "../../shared/ui/empty-state";
import { historyCopy } from "../../modules/transactions/ui/history-copy";
import TransactionsPage from "./page";

const REQUEST_ID = "req-transactions-page";

vi.mock("next/navigation", () => ({
  usePathname: () => "/transactions",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams("tab=all"),
}));

vi.mock("next/link", () => ({
  default: function MockLink({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
  }) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  },
}));

function dataResponse(body: unknown): Response {
  return new Response(JSON.stringify({ data: body, requestId: REQUEST_ID }), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      [REQUEST_ID_HEADER]: REQUEST_ID,
    },
  });
}

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query.includes("640px"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function renderPage(tab?: string) {
  const ui = await TransactionsPage({
    searchParams: Promise.resolve(tab === undefined ? {} : { tab }),
  });

  return render(<FinancialDataProvider>{ui}</FinancialDataProvider>);
}

describe("TransactionsPage", () => {
  it("loads the real history for Todos, including ?tab=all", async () => {
    const fetchImpl = vi.fn((input: string) => {
      if (input.startsWith("/api/transactions")) {
        return Promise.resolve(
          dataResponse({
            items: [
              {
                id: "tx-1",
                type: "expense",
                amountMinor: 1250,
                date: "2026-08-01",
                categoryId: "seed-exp-alquiler",
                concept: "Alquiler agosto",
                note: null,
                tagIds: [],
              },
            ],
            nextCursor: null,
          }),
        );
      }
      if (input.startsWith("/api/categories")) {
        return Promise.resolve(
          dataResponse([
            {
              id: "seed-exp-alquiler",
              name: "Alquiler",
              type: "expense",
              isArchived: false,
            },
          ]),
        );
      }
      return Promise.resolve(dataResponse([]));
    });

    vi.stubGlobal("fetch", fetchImpl);

    await renderPage("all");

    expect(
      screen.getByRole("heading", { name: "Movimientos", level: 1 }),
    ).toBeVisible();
    expect(
      screen.getByRole("tab", { name: historyCopy.allTab }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      await screen.findByRole("rowheader", { name: "Alquiler agosto" }),
    ).toBeVisible();
    expect(fetchImpl.mock.calls.map((call) => call[0]).sort()).toEqual([
      "/api/categories?status=all",
      "/api/tags?status=all",
      "/api/transactions",
    ]);
  });

  it("keeps Recurrentes as a placeholder without loading the history API", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(dataResponse([])));
    vi.stubGlobal("fetch", fetchImpl);

    await renderPage("recurring");

    expect(
      screen.getByRole("tab", { name: historyCopy.recurringTab }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("region", { name: historyCopy.recurringTitle }),
    ).toBeVisible();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("region", {
        name: emptyStateCopy.noTransactions.title,
      }),
    ).not.toBeInTheDocument();
  });

  it("shows the empty history copy when Todos has no movements", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string) => {
        if (input.startsWith("/api/transactions")) {
          return Promise.resolve(dataResponse({ items: [], nextCursor: null }));
        }
        return Promise.resolve(dataResponse([]));
      }),
    );

    await renderPage();

    expect(
      await screen.findByRole("region", {
        name: emptyStateCopy.noTransactions.title,
      }),
    ).toBeVisible();
  });
});
