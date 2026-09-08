import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  createApiClient,
  type FetchLike,
} from "../../../shared/client/api-client";
import { FinancialDataProvider } from "../../../shared/client/financial-data-provider";
import { REQUEST_ID_HEADER } from "../../../shared/contracts/http";
import { Button } from "../../../shared/ui/button";
import { createClassificationApi } from "../client/classification-api";
import {
  archiveConflictCopy,
  archiveDialogCopy,
  ConfirmArchiveDialog,
  historyHref,
} from "./archive-dialog";
import { classificationFailureCopy } from "./classification-copy";

const REQUEST_ID = "req-archive";

function dataResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data: body, requestId: REQUEST_ID }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      [REQUEST_ID_HEADER]: REQUEST_ID,
    },
  });
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  details?: readonly { field: string; code: string }[],
): Response {
  return new Response(
    JSON.stringify({
      error: { code, message, requestId: REQUEST_ID, details },
    }),
    {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        [REQUEST_ID_HEADER]: REQUEST_ID,
      },
    },
  );
}

function ArchiveHarness({
  fetchImpl,
  kind = "category",
}: {
  fetchImpl: FetchLike;
  kind?: "category" | "tag";
}) {
  const [open, setOpen] = useState(false);

  return (
    <FinancialDataProvider>
      <Button
        onClick={() => {
          setOpen(true);
        }}
      >
        Abrir
      </Button>
      <ConfirmArchiveDialog
        api={createClassificationApi(createApiClient({ fetch: fetchImpl }))}
        kind={kind}
        open={open}
        target={{ id: "cat-1", name: "Alquiler" }}
        onOpenChange={setOpen}
      />
    </FinancialDataProvider>
  );
}

describe("archiveConflictCopy", () => {
  it("keeps a 409 visible with history as the orienting action", () => {
    expect(
      archiveConflictCopy("category", {
        ok: false,
        reason: "api",
        status: 409,
        error: {
          code: "conflict",
          message: "El estado actual del recurso no permite esta operación.",
          requestId: REQUEST_ID,
          details: [{ field: "categoryId", code: "alreadyArchived" }],
        },
      }),
    ).toEqual({
      message: archiveDialogCopy.alreadyArchivedCategory,
      showHistory: true,
    });

    expect(
      archiveConflictCopy("category", {
        ok: false,
        reason: "api",
        status: 409,
        error: {
          code: "conflict",
          message: "El estado actual del recurso no permite esta operación.",
          requestId: REQUEST_ID,
        },
      }),
    ).toEqual({
      message: archiveDialogCopy.conflictCategory,
      showHistory: true,
    });

    expect(
      archiveConflictCopy("tag", {
        ok: false,
        reason: "api",
        status: 409,
        error: {
          code: "conflict",
          message: "El estado actual del recurso no permite esta operación.",
          requestId: REQUEST_ID,
          details: [{ field: "tagId", code: "alreadyArchived" }],
        },
      }),
    ).toEqual({
      message: archiveDialogCopy.alreadyArchivedTag,
      showHistory: true,
    });

    expect(
      archiveConflictCopy("tag", {
        ok: false,
        reason: "api",
        status: 409,
        error: {
          code: "conflict",
          message: "El estado actual del recurso no permite esta operación.",
          requestId: REQUEST_ID,
        },
      }),
    ).toEqual({
      message: archiveDialogCopy.conflictTag,
      showHistory: true,
    });

    expect(
      archiveConflictCopy("category", { ok: false, reason: "network" }).message,
    ).toBe(classificationFailureCopy.network);
  });

  it("builds a history URL that does not hide the item", () => {
    expect(historyHref("category", "cat-1")).toBe(
      "/transactions?categoryId=cat-1",
    );
    expect(historyHref("tag", "tag 1")).toBe("/transactions?tagId=tag%201");
  });
});

describe("ConfirmArchiveDialog", () => {
  it("archives a category, explains history retention and restores focus", async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn<FetchLike>((input, init) => {
      expect(input).toBe("/api/categories/cat-1/archive");
      expect(init?.method).toBe("POST");
      expect(init?.body).toBe("{}");
      return Promise.resolve(
        dataResponse({
          id: "cat-1",
          name: "Alquiler",
          type: "expense",
          isArchived: true,
        }),
      );
    });

    render(<ArchiveHarness fetchImpl={fetchImpl} />);
    const opener = screen.getByRole("button", { name: "Abrir" });
    await user.click(opener);

    expect(
      screen.getByRole("dialog", {
        name: archiveDialogCopy.categoryTitle("Alquiler"),
      }),
    ).toHaveAccessibleDescription(
      archiveDialogCopy.categoryDescription("Alquiler"),
    );

    await user.click(
      screen.getByRole("button", { name: archiveDialogCopy.confirm }),
    );

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(opener).toHaveFocus();
  });

  it("cancels without calling the archive endpoint", async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn<FetchLike>();

    render(<ArchiveHarness fetchImpl={fetchImpl} />);
    const opener = screen.getByRole("button", { name: "Abrir" });
    await user.click(opener);
    await user.click(
      screen.getByRole("button", { name: archiveDialogCopy.cancel }),
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(opener).toHaveFocus();
  });

  it("keeps the dialog and history action after a 409", async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn<FetchLike>(() =>
      Promise.resolve(
        errorResponse(
          409,
          "conflict",
          "El estado actual del recurso no permite esta operación.",
          [{ field: "categoryId", code: "alreadyArchived" }],
        ),
      ),
    );

    render(<ArchiveHarness fetchImpl={fetchImpl} />);
    await user.click(screen.getByRole("button", { name: "Abrir" }));
    await user.click(
      screen.getByRole("button", { name: archiveDialogCopy.confirm }),
    );

    expect(
      await screen.findByText(archiveDialogCopy.alreadyArchivedCategory),
    ).toBeVisible();
    expect(
      screen.getByRole("link", {
        name: archiveDialogCopy.viewCategoryHistory("Alquiler"),
      }),
    ).toHaveAttribute("href", "/transactions?categoryId=cat-1");
    expect(screen.getByRole("dialog")).toBeVisible();
  });

  it("blocks dismiss while pending", async () => {
    const user = userEvent.setup();
    let release!: (response: Response) => void;
    const fetchImpl = vi.fn<FetchLike>(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );

    render(<ArchiveHarness fetchImpl={fetchImpl} kind="tag" />);
    await user.click(screen.getByRole("button", { name: "Abrir" }));
    await user.click(
      screen.getByRole("button", { name: archiveDialogCopy.confirm }),
    );

    expect(
      screen.getByRole("button", { name: archiveDialogCopy.confirm }),
    ).toHaveAttribute("aria-busy", "true");
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeVisible();

    release(dataResponse({ id: "cat-1", name: "Alquiler", isArchived: true }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});
