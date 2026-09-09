import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  createApiClient,
  type FetchLike,
} from "../../../shared/client/api-client";
import { FinancialDataProvider } from "../../../shared/client/financial-data-provider";
import {
  DemoModeControls,
  EnterDemoAction,
  ResetDemoDialog,
  demoCopy,
} from "./demo-actions";

const requestIdHeaders = { "x-request-id": "req-demo-ui" };

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      ...requestIdHeaders,
      "content-type": "application/json",
    },
    status: 200,
  });
}

function preferences(mode: "personal" | "demo") {
  return jsonResponse({
    data: {
      locale: "es-ES",
      currency: "EUR",
      timeZone: "Europe/Madrid",
      mode,
      today: "2026-09-09",
    },
    requestId: "req-preferences",
  });
}

describe("demo mode controls", () => {
  it("enters demo then reloads all mode-bound resources", async () => {
    const reload = vi.fn();
    const fetchImpl = vi.fn<FetchLike>(() =>
      Promise.resolve(
        jsonResponse({ data: { mode: "demo" }, requestId: "req-session" }),
      ),
    );

    render(
      <EnterDemoAction
        client={createApiClient({ fetch: fetchImpl })}
        reload={reload}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: demoCopy.enter }));

    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(fetchImpl).toHaveBeenCalledWith("/api/demo/session", {
      body: JSON.stringify({ mode: "demo" }),
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      method: "POST",
      signal: undefined,
    });
  });

  it("leaves a reset dialog inert when it is cancelled", async () => {
    const reload = vi.fn();
    const fetchImpl = vi.fn<FetchLike>();

    render(
      <ResetDemoDialog
        client={createApiClient({ fetch: fetchImpl })}
        reload={reload}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: demoCopy.reset }));
    await userEvent.click(
      screen.getByRole("button", { name: demoCopy.resetCancel }),
    );

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the demo banner with reset and exit actions", async () => {
    const fetchImpl = vi.fn<FetchLike>((path) => {
      if (path === "/api/preferences") {
        return Promise.resolve(preferences("demo"));
      }

      return Promise.resolve(
        jsonResponse({ data: { mode: "personal" }, requestId: "req-session" }),
      );
    });

    render(
      <FinancialDataProvider>
        <DemoModeControls
          client={createApiClient({ fetch: fetchImpl })}
          reload={vi.fn()}
        />
      </FinancialDataProvider>,
    );

    expect(
      await screen.findByRole("status", { name: demoCopy.banner }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: demoCopy.reset })).toBeVisible();
    expect(screen.getByRole("button", { name: demoCopy.exit })).toBeVisible();
  });
});
