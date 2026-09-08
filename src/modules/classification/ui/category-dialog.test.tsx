/**
 * Category create and rename dialog.
 *
 * Fetch is the only replaced collaborator. The real adapter, Zod schema and
 * dialog shell run, so a cancelled save, a name conflict and a network
 * failure are observed the way the owner would see them.
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
import type { CategoryDto } from "../contracts/category";
import { CategoryDialog, type CategoryDialogMode } from "./category-dialog";
import { classificationFailureCopy } from "./classification-copy";
import { classificationFormCopy } from "./classification-form";

const REQUEST_ID = "req-category-dialog";

const expense: CategoryDto = {
  id: "cat-1",
  name: "Alquiler",
  type: "expense",
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

function CategoryDialogHarness({
  existing = [expense],
  fetchImpl,
  mode,
}: {
  existing?: readonly CategoryDto[];
  fetchImpl: FetchLike;
  mode: CategoryDialogMode;
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
      <CategoryDialog
        api={createClassificationApi(createApiClient({ fetch: fetchImpl }))}
        existingCategories={existing}
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

describe("CategoryDialog create", () => {
  it("creates an income category and restores focus to the opener", async () => {
    const user = userEvent.setup();
    const created: CategoryDto = {
      id: "cat-new",
      name: "Sueldo extra",
      type: "income",
      isArchived: false,
    };
    const fetchImpl = vi.fn<FetchLike>((input, init) => {
      expect(init?.method).toBe("POST");
      expect(input).toBe("/api/categories");
      expect(JSON.parse(String(init?.body))).toEqual({
        name: "Sueldo extra",
        type: "income",
      });
      return Promise.resolve(dataResponse(created, 201));
    });

    render(
      <CategoryDialogHarness fetchImpl={fetchImpl} mode={{ kind: "create" }} />,
    );

    const opener = screen.getByRole("button", { name: "Abrir" });
    await user.click(opener);
    await user.type(nameField(), "Sueldo extra");
    await user.click(
      screen.getByRole("radio", { name: classificationFormCopy.income }),
    );
    await user.click(
      screen.getByRole("button", { name: classificationFormCopy.save }),
    );

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(opener).toHaveFocus();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("shows a required name without calling the API", async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn<FetchLike>();

    render(
      <CategoryDialogHarness fetchImpl={fetchImpl} mode={{ kind: "create" }} />,
    );

    await user.click(screen.getByRole("button", { name: "Abrir" }));
    await user.click(
      screen.getByRole("button", { name: classificationFormCopy.save }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      classificationFormCopy.nameRequired,
    );
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveFocus();
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("renders a normalized client conflict for the selected type", async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn<FetchLike>();

    render(
      <CategoryDialogHarness fetchImpl={fetchImpl} mode={{ kind: "create" }} />,
    );

    await user.click(screen.getByRole("button", { name: "Abrir" }));
    await user.type(nameField(), "  alquiler  ");
    await user.click(
      screen.getByRole("button", { name: classificationFormCopy.save }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      classificationFormCopy.categoryDuplicateName,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("renders a server name conflict when the catalog did not yet include it", async () => {
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

    render(
      <CategoryDialogHarness
        existing={[]}
        fetchImpl={fetchImpl}
        mode={{ kind: "create" }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Abrir" }));
    await user.type(nameField(), "Alquiler");
    await user.click(
      screen.getByRole("button", { name: classificationFormCopy.save }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      classificationFormCopy.categoryDuplicateName,
    );
    expect(nameField()).toHaveValue("Alquiler");
    expect(screen.getByRole("dialog")).toBeVisible();
  });

  it("keeps the typed name after a network failure", async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn<FetchLike>(() =>
      Promise.reject(new TypeError("Failed to fetch")),
    );

    render(
      <CategoryDialogHarness
        existing={[]}
        fetchImpl={fetchImpl}
        mode={{ kind: "create" }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Abrir" }));
    await user.type(nameField(), "Café");
    await user.click(
      screen.getByRole("button", { name: classificationFormCopy.save }),
    );

    expect(
      await screen.findByText(classificationFailureCopy.network),
    ).toBeVisible();
    expect(nameField()).toHaveValue("Café");
    expect(
      screen.getByRole("radio", { name: classificationFormCopy.expense }),
    ).toBeChecked();
  });

  it("cancels without mutating and restores focus", async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn<FetchLike>();

    render(
      <CategoryDialogHarness fetchImpl={fetchImpl} mode={{ kind: "create" }} />,
    );

    const opener = screen.getByRole("button", { name: "Abrir" });
    await user.click(opener);
    await user.type(nameField(), "Café");
    await user.click(
      screen.getByRole("button", { name: classificationFormCopy.cancel }),
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(opener).toHaveFocus();
  });

  it("blocks a second submit and Escape while the request is pending", async () => {
    const user = userEvent.setup();
    let release!: (response: Response) => void;
    const fetchImpl = vi.fn<FetchLike>(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );

    render(
      <CategoryDialogHarness
        existing={[]}
        fetchImpl={fetchImpl}
        mode={{ kind: "create" }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Abrir" }));
    await user.type(nameField(), "Café");
    await user.click(
      screen.getByRole("button", { name: classificationFormCopy.save }),
    );

    expect(
      await screen.findByRole("button", {
        name: classificationFormCopy.saving,
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: classificationFormCopy.cancel }),
    ).toBeDisabled();

    await user.click(
      screen.getByRole("button", { name: classificationFormCopy.saving }),
    );
    await user.keyboard("{Escape}");

    expect(screen.getByRole("dialog")).toBeVisible();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    release(
      dataResponse(
        {
          id: "cat-new",
          name: "Café",
          type: "expense",
          isArchived: false,
        },
        201,
      ),
    );

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});

describe("CategoryDialog rename", () => {
  it("renames without sending a type and keeps the type immutable", async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn<FetchLike>((input, init) => {
      expect(init?.method).toBe("PATCH");
      expect(input).toBe(`/api/categories/${expense.id}`);
      expect(JSON.parse(String(init?.body))).toEqual({ name: "Casa" });
      return Promise.resolve(dataResponse({ ...expense, name: "Casa" }));
    });

    render(
      <CategoryDialogHarness
        fetchImpl={fetchImpl}
        mode={{ kind: "rename", category: expense }}
      />,
    );

    const opener = screen.getByRole("button", { name: "Abrir" });
    await user.click(opener);

    expect(
      screen.getByText(classificationFormCopy.typeImmutableExpense),
    ).toBeVisible();
    expect(
      screen.queryByRole("radio", { name: classificationFormCopy.expense }),
    ).not.toBeInTheDocument();
    expect(nameField()).toHaveValue("Alquiler");

    await user.clear(nameField());
    await user.type(nameField(), "Casa");
    await user.click(
      screen.getByRole("button", { name: classificationFormCopy.save }),
    );

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(opener).toHaveFocus();
  });

  it("explains that an income category type cannot change", async () => {
    const user = userEvent.setup();

    render(
      <CategoryDialogHarness
        fetchImpl={vi.fn<FetchLike>()}
        mode={{
          kind: "rename",
          category: {
            id: "cat-inc",
            name: "Sueldo",
            type: "income",
            isArchived: false,
          },
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Abrir" }));
    expect(
      screen.getByText(classificationFormCopy.typeImmutableIncome),
    ).toBeVisible();
  });
});
