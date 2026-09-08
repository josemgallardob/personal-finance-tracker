/**
 * Tag create and rename dialog.
 *
 * Fetch is the only replaced collaborator. Client uniqueness, a 409 name
 * conflict, cancel and a network failure are asserted against the real form.
 */

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
import type { TagDto } from "../contracts/tag";
import { classificationFailureCopy } from "./classification-copy";
import { classificationFormCopy } from "./classification-form";
import { TagDialog, type TagDialogMode } from "./tag-dialog";

const REQUEST_ID = "req-tag-dialog";

const vacation: TagDto = {
  id: "tag-1",
  name: "Vacaciones",
  isArchived: false,
};

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

function TagDialogHarness({
  existing = [vacation],
  fetchImpl,
  mode,
}: {
  existing?: readonly TagDto[];
  fetchImpl: FetchLike;
  mode: TagDialogMode;
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
      <TagDialog
        api={createClassificationApi(createApiClient({ fetch: fetchImpl }))}
        existingTags={existing}
        mode={mode}
        open={open}
        onOpenChange={setOpen}
      />
    </FinancialDataProvider>
  );
}

function nameField() {
  return screen.getByLabelText(new RegExp(classificationFormCopy.nameLabel));
}

describe("TagDialog create", () => {
  it("creates a tag and restores focus", async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn<FetchLike>((input, init) => {
      expect(init?.method).toBe("POST");
      expect(input).toBe("/api/tags");
      expect(JSON.parse(String(init?.body))).toEqual({ name: "Navidad" });
      return Promise.resolve(
        dataResponse({ id: "tag-2", name: "Navidad", isArchived: false }, 201),
      );
    });

    render(
      <TagDialogHarness fetchImpl={fetchImpl} mode={{ kind: "create" }} />,
    );

    const opener = screen.getByRole("button", { name: "Abrir" });
    await user.click(opener);
    await user.type(nameField(), "Navidad");
    await user.click(
      screen.getByRole("button", { name: classificationFormCopy.save }),
    );

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(opener).toHaveFocus();
  });

  it("shows invalid, client conflict and server conflict copy", async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn<FetchLike>(() =>
      Promise.resolve(
        errorResponse(
          409,
          "conflict",
          "El estado actual del recurso no permite esta operación.",
          [{ field: "name", code: "duplicateName" }],
        ),
      ),
    );

    const { rerender } = render(
      <TagDialogHarness fetchImpl={fetchImpl} mode={{ kind: "create" }} />,
    );

    await user.click(screen.getByRole("button", { name: "Abrir" }));
    await user.click(
      screen.getByRole("button", { name: classificationFormCopy.save }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      classificationFormCopy.nameRequired,
    );

    await user.type(nameField(), "vacaciones");
    await user.click(
      screen.getByRole("button", { name: classificationFormCopy.save }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      classificationFormCopy.tagDuplicateName,
    );
    expect(fetchImpl).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: classificationFormCopy.cancel }),
    );

    rerender(
      <TagDialogHarness
        existing={[]}
        fetchImpl={fetchImpl}
        mode={{ kind: "create" }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Abrir" }));
    await user.type(nameField(), "Vacaciones");
    await user.click(
      screen.getByRole("button", { name: classificationFormCopy.save }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      classificationFormCopy.tagDuplicateName,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("keeps the typed name after a network failure and ignores cancel of nothing", async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn<FetchLike>(() =>
      Promise.reject(new TypeError("Failed to fetch")),
    );

    render(
      <TagDialogHarness
        existing={[]}
        fetchImpl={fetchImpl}
        mode={{ kind: "create" }}
      />,
    );

    const opener = screen.getByRole("button", { name: "Abrir" });
    await user.click(opener);
    await user.type(nameField(), "Viaje");
    await user.click(
      screen.getByRole("button", { name: classificationFormCopy.save }),
    );

    expect(
      await screen.findByText(classificationFailureCopy.network),
    ).toBeVisible();
    expect(nameField()).toHaveValue("Viaje");

    await user.click(
      screen.getByRole("button", { name: classificationFormCopy.cancel }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});

describe("TagDialog rename", () => {
  it("renames a tag without extra fields and restores focus", async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn<FetchLike>((input, init) => {
      expect(init?.method).toBe("PATCH");
      expect(input).toBe(`/api/tags/${vacation.id}`);
      expect(JSON.parse(String(init?.body))).toEqual({ name: "Viaje" });
      return Promise.resolve(dataResponse({ ...vacation, name: "Viaje" }));
    });

    render(
      <TagDialogHarness
        fetchImpl={fetchImpl}
        mode={{ kind: "rename", tag: vacation }}
      />,
    );

    const opener = screen.getByRole("button", { name: "Abrir" });
    await user.click(opener);
    expect(nameField()).toHaveValue("Vacaciones");
    await user.clear(nameField());
    await user.type(nameField(), "Viaje");
    await user.click(
      screen.getByRole("button", { name: classificationFormCopy.save }),
    );

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(opener).toHaveFocus();
  });

  it("blocks a second submit while pending", async () => {
    const user = userEvent.setup();
    let release!: (response: Response) => void;
    const fetchImpl = vi.fn<FetchLike>(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );

    render(
      <TagDialogHarness
        existing={[]}
        fetchImpl={fetchImpl}
        mode={{ kind: "create" }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Abrir" }));
    await user.type(nameField(), "Viaje");
    await user.click(
      screen.getByRole("button", { name: classificationFormCopy.save }),
    );

    expect(
      await screen.findByRole("button", {
        name: classificationFormCopy.saving,
      }),
    ).toHaveAttribute("aria-busy", "true");
    await user.click(
      screen.getByRole("button", { name: classificationFormCopy.saving }),
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    release(
      dataResponse({ id: "tag-9", name: "Viaje", isArchived: false }, 201),
    );
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});
