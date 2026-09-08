import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { API_ERROR_MESSAGE } from "../../../shared/contracts/api";
import {
  createApiClient,
  type FetchLike,
} from "../../../shared/client/api-client";
import {
  FinancialDataProvider,
  useFinancialDataRevision,
} from "../../../shared/client/financial-data-provider";
import { DuplicateTransactionDialog } from "./duplicate-dialog";
import {
  envelope,
  jsonResponse,
  maintenanceFetch,
  movement,
  notFoundResponse,
  REQUEST_ID,
  today,
} from "./transaction-dialog-fixtures";
import { transactionMaintenanceCopy } from "./transaction-dialog-support";

function RevisionReadout() {
  const { revision } = useFinancialDataRevision();
  return <p>revision:{revision}</p>;
}

function Harness({
  fetchImpl,
  initiallyOpen = true,
  transactionId = movement.id,
}: {
  fetchImpl: FetchLike;
  initiallyOpen?: boolean;
  transactionId?: string | null;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const client = createApiClient({ fetch: fetchImpl });

  return (
    <FinancialDataProvider>
      <button type="button" onClick={() => setOpen(true)}>
        Abrir duplicado
      </button>
      <DuplicateTransactionDialog
        client={client}
        open={open}
        transactionId={transactionId}
        onOpenChange={setOpen}
      />
      <RevisionReadout />
    </FinancialDataProvider>
  );
}

describe("DuplicateTransactionDialog", () => {
  it("copies editable values and POSTs a new movement only on confirm", async () => {
    const user = userEvent.setup();
    const posted: unknown[] = [];
    const fetchImpl = maintenanceFetch({
      onMutate: (method, path, body) => {
        if (method === "POST" && path === "/api/transactions") {
          posted.push(body);
          const payload = body as Record<string, unknown>;
          return jsonResponse(
            201,
            envelope({
              id: "tx-copy",
              type: payload.type,
              amountMinor: payload.amountMinor,
              date: payload.date,
              categoryId: payload.categoryId,
              concept: payload.concept ?? null,
              note: payload.note ?? null,
              tagIds: [],
            }),
          );
        }
        return notFoundResponse();
      },
    });
    render(<Harness fetchImpl={fetchImpl} />);

    expect(
      await screen.findByRole("dialog", {
        name: transactionMaintenanceCopy.duplicateTitle,
      }),
    ).toHaveAccessibleDescription(
      transactionMaintenanceCopy.duplicateDescription,
    );
    expect(await screen.findByLabelText(/Importe/)).toHaveValue("12,50");
    expect(screen.getByLabelText("Concepto")).toHaveValue("Supermercado");
    expect(
      screen.getByRole("button", {
        name: transactionMaintenanceCopy.saveDuplicateExpense,
      }),
    ).toBeVisible();

    await user.click(
      screen.getByRole("button", {
        name: transactionMaintenanceCopy.saveDuplicateExpense,
      }),
    );

    await waitFor(() => {
      expect(posted).toHaveLength(1);
    });
    expect(posted[0]).toEqual({
      type: "expense",
      amountMinor: 1250,
      date: "2026-08-01",
      categoryId: "cat-food",
      concept: "Supermercado",
      note: "Semanal",
      tagInputs: [{ tagId: "tag-trips" }],
    });
    expect(posted[0]).not.toHaveProperty("id");
    expect(posted[0]).not.toHaveProperty("recurrenceId");
    expect(posted[0]).not.toHaveProperty("occurrenceDate");
    expect(
      fetchImpl.mock.calls.filter((call) => call[1]?.method === "PUT"),
    ).toHaveLength(0);
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(screen.getByText("revision:1")).toBeVisible();
  });

  it("uses the income copy label and does not POST until confirm", async () => {
    const user = userEvent.setup();
    const income = {
      ...movement,
      type: "income" as const,
      categoryId: "cat-salary",
      concept: "Nómina agosto",
    };
    const posted: unknown[] = [];
    const fetchImpl = maintenanceFetch({
      movement: income,
      onMutate: (method, path, body) => {
        if (method === "POST" && path === "/api/transactions") {
          posted.push(body);
          return jsonResponse(
            201,
            envelope({
              id: "tx-copy",
              type: "income",
              amountMinor: 1250,
              date: "2026-08-01",
              categoryId: "cat-salary",
              concept: "Nómina agosto",
              note: "Semanal",
              tagIds: [],
            }),
          );
        }
        return notFoundResponse();
      },
    });
    render(<Harness fetchImpl={fetchImpl} />);

    await screen.findByLabelText(/Importe/);
    expect(screen.getByLabelText("Ingreso")).toBeChecked();
    expect(
      fetchImpl.mock.calls.filter((call) => call[1]?.method === "POST"),
    ).toHaveLength(0);
    await user.click(
      screen.getByRole("button", {
        name: transactionMaintenanceCopy.saveDuplicateIncome,
      }),
    );
    await waitFor(() => {
      expect(posted).toHaveLength(1);
    });
    expect(posted[0]).toMatchObject({
      type: "income",
      categoryId: "cat-salary",
    });
  });

  it("does not POST when cancelled and restores focus to the opener", async () => {
    const user = userEvent.setup();
    const fetchImpl = maintenanceFetch();
    render(<Harness fetchImpl={fetchImpl} initiallyOpen={false} />);

    const opener = screen.getByRole("button", { name: "Abrir duplicado" });
    await user.click(opener);
    await screen.findByLabelText(/Importe/);
    await user.type(screen.getByLabelText("Concepto"), " extra");
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      fetchImpl.mock.calls.filter((call) => call[1]?.method === "POST"),
    ).toHaveLength(0);
    expect(opener).toHaveFocus();
  });

  it("keeps the copied fields when the POST is refused", async () => {
    const user = userEvent.setup();
    const fetchImpl = maintenanceFetch({
      onMutate: () =>
        jsonResponse(422, {
          error: {
            code: "validationFailed",
            message: API_ERROR_MESSAGE.validationFailed,
            requestId: REQUEST_ID,
          },
        }),
    });
    render(<Harness fetchImpl={fetchImpl} />);

    await screen.findByLabelText(/Importe/);
    await user.clear(screen.getByLabelText(/Fecha/));
    await user.type(screen.getByLabelText(/Fecha/), today);
    await user.click(
      screen.getByRole("button", {
        name: transactionMaintenanceCopy.saveDuplicateExpense,
      }),
    );

    expect(
      await screen.findByText(API_ERROR_MESSAGE.validationFailed),
    ).toBeVisible();
    expect(screen.getByLabelText(/Fecha/)).toHaveValue(today);
    expect(screen.getByLabelText("Concepto")).toHaveValue("Supermercado");
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByText("revision:0")).toBeVisible();
  });

  it("blocks a second submit while the POST is pending", async () => {
    const user = userEvent.setup();
    let resolvePost!: (response: Response) => void;
    const pendingPost = new Promise<Response>((resolve) => {
      resolvePost = resolve;
    });
    const posted: unknown[] = [];
    const fetchImpl = maintenanceFetch({
      onMutate: (method, _path, body) => {
        if (method === "POST") {
          posted.push(body);
          return pendingPost;
        }
        return notFoundResponse();
      },
    });
    render(<Harness fetchImpl={fetchImpl} />);

    await screen.findByLabelText(/Importe/);
    await user.click(
      screen.getByRole("button", {
        name: transactionMaintenanceCopy.saveDuplicateExpense,
      }),
    );
    await user.click(
      screen.getByRole("button", {
        name: transactionMaintenanceCopy.saveDuplicateExpense,
      }),
    );

    expect(posted).toHaveLength(1);
    expect(
      screen.getByRole("button", {
        name: transactionMaintenanceCopy.saveDuplicateExpense,
      }),
    ).toBeDisabled();

    resolvePost(
      jsonResponse(201, envelope({ ...movement, id: "tx-copy", tagIds: [] })),
    );
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});
