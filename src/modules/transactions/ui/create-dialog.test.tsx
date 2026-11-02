import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { API_ERROR_MESSAGE } from "../../../shared/contracts/api";
import { REQUEST_ID_HEADER } from "../../../shared/contracts/http";
import {
  createApiClient,
  type FetchLike,
} from "../../../shared/client/api-client";
import {
  FinancialDataProvider,
  useFinancialDataRevision,
} from "../../../shared/client/financial-data-provider";
import {
  CreateTransactionDialog,
  createTransactionDialogCopy,
} from "./create-dialog";
import { transactionFormCopy } from "./transaction-form-schema";

const REQUEST_ID = "req-create";
const today = "2026-09-08";

const preferences = {
  locale: "es-ES",
  currency: "EUR",
  timeZone: "Europe/Madrid",
  today,
};

const categories = [
  { id: "cat-food", name: "Alimentación", type: "expense", isArchived: false },
  { id: "cat-salary", name: "Nómina", type: "income", isArchived: false },
];

const tags = [{ id: "tag-trips", name: "Viajes", isArchived: false }];

const created = {
  id: "tx-1",
  type: "expense",
  amountMinor: 1250,
  date: today,
  categoryId: "cat-food",
  concept: null,
  note: null,
  tagIds: [],
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      [REQUEST_ID_HEADER]: REQUEST_ID,
    },
  });
}

function envelope<T>(data: T) {
  return { data, requestId: REQUEST_ID };
}

function catalogFetch(
  onPost?: (body: unknown) => Promise<Response> | Response,
): ReturnType<typeof vi.fn<FetchLike>> {
  return vi.fn<FetchLike>(async (path, init) => {
    if (path.startsWith("/api/preferences")) {
      return jsonResponse(200, envelope(preferences));
    }
    if (path.startsWith("/api/categories")) {
      return jsonResponse(200, envelope(categories));
    }
    if (path.startsWith("/api/tags")) {
      return jsonResponse(200, envelope(tags));
    }
    if (path === "/api/transactions" && init.method === "POST") {
      const payload = init.body ? JSON.parse(String(init.body)) : {};
      if (onPost) {
        return onPost(payload);
      }
      return jsonResponse(201, envelope(created));
    }
    return jsonResponse(404, {
      error: {
        code: "notFound",
        message: API_ERROR_MESSAGE.notFound,
        requestId: REQUEST_ID,
      },
    });
  });
}

function RevisionReadout() {
  const { revision } = useFinancialDataRevision();
  return <p>revision:{revision}</p>;
}

function Harness({
  fetchImpl,
  initiallyOpen = true,
}: {
  fetchImpl: FetchLike;
  initiallyOpen?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const client = createApiClient({ fetch: fetchImpl });

  return (
    <FinancialDataProvider>
      <button type="button" onClick={() => setOpen(true)}>
        Abrir alta
      </button>
      <CreateTransactionDialog
        client={client}
        open={open}
        onOpenChange={setOpen}
      />
      <RevisionReadout />
    </FinancialDataProvider>
  );
}

async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/Importe/), "12,50");
  await user.selectOptions(screen.getByLabelText(/Categoría/), "cat-food");
}

describe("CreateTransactionDialog", () => {
  it("posts once, announces a revision and closes on success", async () => {
    const user = userEvent.setup();
    const posted: unknown[] = [];
    const fetchImpl = catalogFetch((body) => {
      posted.push(body);
      return jsonResponse(201, envelope(created));
    });
    render(<Harness fetchImpl={fetchImpl} />);

    await screen.findByLabelText(/Importe/);
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "Añadir gasto" }));

    await waitFor(() => {
      expect(posted).toHaveLength(1);
    });
    expect(posted[0]).toMatchObject({
      type: "expense",
      amountMinor: 1250,
      date: today,
      categoryId: "cat-food",
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(screen.getByText("revision:1")).toBeVisible();
    expect(
      fetchImpl.mock.calls.filter((call) => call[1]?.method === "POST"),
    ).toHaveLength(1);
  });

  it("keeps type, category and date after save-and-add-another and focuses the amount", async () => {
    const user = userEvent.setup();
    const posted: unknown[] = [];
    const fetchImpl = catalogFetch((body) => {
      posted.push(body);
      const payload = body as Record<string, unknown>;
      return jsonResponse(
        201,
        envelope({
          id: `tx-${posted.length}`,
          type: payload.type ?? "expense",
          amountMinor: payload.amountMinor ?? 0,
          date: payload.date ?? today,
          categoryId: payload.categoryId ?? "cat-food",
          concept: payload.concept ?? null,
          note: payload.note ?? null,
          tagIds: [],
        }),
      );
    });
    render(<Harness fetchImpl={fetchImpl} />);

    await screen.findByLabelText(/Importe/);
    await fillRequired(user);
    await user.type(screen.getByLabelText("Concepto"), "Pan");
    await user.click(
      screen.getByRole("button", {
        name: transactionFormCopy.saveAndAddAnother,
      }),
    );

    await waitFor(() => {
      expect(posted).toHaveLength(1);
    });
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(
      screen.getByText(/Gasto añadido\. Puedes registrar otro movimiento\./),
    ).toBeVisible();
    expect(screen.getByLabelText(/Importe/)).toHaveValue("");
    expect(screen.getByLabelText(/Importe/)).toHaveFocus();
    expect(screen.getByLabelText("Concepto")).toHaveValue("");
    expect(screen.getByLabelText(/Categoría/)).toHaveValue("cat-food");
    expect(screen.getByLabelText(/Fecha/)).toHaveValue(today);
    expect(screen.getByLabelText("Gasto")).toBeChecked();
    expect(screen.getByText("revision:1")).toBeVisible();

    await user.type(screen.getByLabelText(/Importe/), "5,00");
    await user.click(screen.getByRole("button", { name: "Añadir gasto" }));
    await waitFor(() => {
      expect(posted).toHaveLength(2);
    });
    expect(posted[1]).toMatchObject({ amountMinor: 500, concept: null });
    expect(posted[1]).not.toMatchObject({ amountMinor: 1250 });
  });

  it("blocks a second submit while the first POST is pending", async () => {
    const user = userEvent.setup();
    let resolvePost!: (response: Response) => void;
    const pendingPost = new Promise<Response>((resolve) => {
      resolvePost = resolve;
    });
    const posted: unknown[] = [];
    const fetchImpl = catalogFetch((body) => {
      posted.push(body);
      return pendingPost;
    });
    render(<Harness fetchImpl={fetchImpl} />);

    await screen.findByLabelText(/Importe/);
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "Añadir gasto" }));
    await user.click(screen.getByRole("button", { name: "Añadir gasto" }));

    expect(posted).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Añadir gasto" })).toBeDisabled();

    resolvePost(jsonResponse(201, envelope(created)));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("preserves the entered fields when the POST is refused", async () => {
    const user = userEvent.setup();
    const fetchImpl = catalogFetch(() =>
      jsonResponse(422, {
        error: {
          code: "validationFailed",
          message: API_ERROR_MESSAGE.validationFailed,
          requestId: REQUEST_ID,
        },
      }),
    );
    render(<Harness fetchImpl={fetchImpl} />);

    await screen.findByLabelText(/Importe/);
    await fillRequired(user);
    await user.type(screen.getByLabelText("Concepto"), "Pan");
    await user.click(screen.getByRole("button", { name: "Añadir gasto" }));

    expect(
      await screen.findByText(API_ERROR_MESSAGE.validationFailed),
    ).toBeVisible();
    expect(screen.getByLabelText(/Importe/)).toHaveValue("12,50");
    expect(screen.getByLabelText("Concepto")).toHaveValue("Pan");
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByText("revision:0")).toBeVisible();
  });

  it("does not post when cancelled and restores focus to the opener", async () => {
    const user = userEvent.setup();
    const fetchImpl = catalogFetch();
    render(<Harness fetchImpl={fetchImpl} initiallyOpen={false} />);

    const opener = screen.getByRole("button", { name: "Abrir alta" });
    await user.click(opener);
    await screen.findByLabelText(/Importe/);
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      fetchImpl.mock.calls.filter((call) => call[1]?.method === "POST"),
    ).toHaveLength(0);
    expect(opener).toHaveFocus();
  });

  it("does not post when the dialog is closed with Escape", async () => {
    const user = userEvent.setup();
    const fetchImpl = catalogFetch();
    render(<Harness fetchImpl={fetchImpl} initiallyOpen={false} />);

    const opener = screen.getByRole("button", { name: "Abrir alta" });
    await user.click(opener);
    await screen.findByLabelText(/Importe/);
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      fetchImpl.mock.calls.filter((call) => call[1]?.method === "POST"),
    ).toHaveLength(0);
    expect(opener).toHaveFocus();
  });

  it("shows a load error and retries the catalog", async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn<FetchLike>(async (path) => {
      if (
        path.startsWith("/api/preferences") &&
        fetchImpl.mock.calls.filter((call) =>
          String(call[0]).startsWith("/api/preferences"),
        ).length === 1
      ) {
        return jsonResponse(503, {
          error: {
            code: "serviceUnavailable",
            message: API_ERROR_MESSAGE.serviceUnavailable,
            requestId: REQUEST_ID,
          },
        });
      }
      if (path.startsWith("/api/preferences")) {
        return jsonResponse(200, envelope(preferences));
      }
      if (path.startsWith("/api/categories")) {
        return jsonResponse(200, envelope(categories));
      }
      if (path.startsWith("/api/tags")) {
        return jsonResponse(200, envelope(tags));
      }
      return jsonResponse(404, {
        error: {
          code: "notFound",
          message: API_ERROR_MESSAGE.notFound,
          requestId: REQUEST_ID,
        },
      });
    });
    render(<Harness fetchImpl={fetchImpl} />);

    expect(
      await screen.findByText(createTransactionDialogCopy.loadHint),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByLabelText(/Importe/)).toBeVisible();
  });

  it("announces an income save-and-add-another without closing", async () => {
    const user = userEvent.setup();
    const fetchImpl = catalogFetch((body) => {
      const payload = body as Record<string, unknown>;
      return jsonResponse(
        201,
        envelope({
          id: "tx-income",
          type: "income",
          amountMinor: payload.amountMinor ?? 0,
          date: payload.date ?? today,
          categoryId: payload.categoryId ?? "cat-salary",
          concept: null,
          note: null,
          tagIds: [],
        }),
      );
    });
    render(<Harness fetchImpl={fetchImpl} />);

    await screen.findByLabelText(/Importe/);
    await user.click(screen.getByLabelText("Ingreso"));
    await user.type(screen.getByLabelText(/Importe/), "20,00");
    await user.selectOptions(screen.getByLabelText(/Categoría/), "cat-salary");
    await user.click(
      screen.getByRole("button", {
        name: transactionFormCopy.saveAndAddAnother,
      }),
    );

    expect(
      await screen.findByText(
        /Ingreso añadido\. Puedes registrar otro movimiento\./,
      ),
    ).toBeVisible();
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByText("revision:1")).toBeVisible();
  });

  it("keeps the dialog open while a save is pending", async () => {
    const user = userEvent.setup();
    let resolvePost!: (response: Response) => void;
    const pendingPost = new Promise<Response>((resolve) => {
      resolvePost = resolve;
    });
    const fetchImpl = catalogFetch(() => pendingPost);
    render(<Harness fetchImpl={fetchImpl} />);

    await screen.findByLabelText(/Importe/);
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "Añadir gasto" }));
    await user.keyboard("{Escape}");

    expect(screen.getByRole("dialog")).toBeVisible();
    resolvePost(jsonResponse(201, envelope(created)));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});
