import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { API_ERROR_MESSAGE } from "../../../shared/contracts/api";
import {
  createApiClient,
  type FetchLike,
} from "../../../shared/client/api-client";
import {
  FinancialDataProvider,
  useFinancialDataRevision,
} from "../../../shared/client/financial-data-provider";
import { EditTransactionDialog } from "./edit-dialog";
import {
  archivedMovement,
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
  onCompleted,
  transactionId = movement.id,
}: {
  fetchImpl: FetchLike;
  initiallyOpen?: boolean;
  onCompleted?: () => void;
  transactionId?: string | null;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const client = createApiClient({ fetch: fetchImpl });

  return (
    <FinancialDataProvider>
      <button type="button" onClick={() => setOpen(true)}>
        Abrir edición
      </button>
      <EditTransactionDialog
        client={client}
        open={open}
        transactionId={transactionId}
        onCompleted={onCompleted}
        onOpenChange={setOpen}
      />
      <RevisionReadout />
    </FinancialDataProvider>
  );
}

describe("EditTransactionDialog", () => {
  it("loads the movement by id and PUTs type and period changes", async () => {
    const user = userEvent.setup();
    const onCompleted = vi.fn();
    const putBodies: unknown[] = [];
    const fetchImpl = maintenanceFetch({
      onMutate: (method, path, body) => {
        if (method === "PUT" && path === `/api/transactions/${movement.id}`) {
          putBodies.push(body);
          const payload = body as Record<string, unknown>;
          return jsonResponse(
            200,
            envelope({
              ...movement,
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
    render(<Harness fetchImpl={fetchImpl} onCompleted={onCompleted} />);

    const dialog = await screen.findByRole("dialog", {
      name: transactionMaintenanceCopy.editTitle,
    });
    expect(dialog).toHaveAccessibleDescription(
      transactionMaintenanceCopy.editDescription,
    );
    expect(await screen.findByLabelText(/Importe/)).toHaveValue("12,50");
    expect(screen.getByLabelText("Gasto")).toBeChecked();
    expect(screen.getByLabelText(/Fecha/)).toHaveValue("2026-08-01");
    expect(screen.getByLabelText(/Categoría/)).toHaveValue("cat-food");
    expect(screen.getByLabelText("Concepto")).toHaveValue("Supermercado");

    await user.click(screen.getByLabelText("Ingreso"));
    await user.clear(screen.getByLabelText(/Fecha/));
    await user.type(screen.getByLabelText(/Fecha/), today);
    await user.selectOptions(screen.getByLabelText(/Categoría/), "cat-salary");
    await user.click(
      screen.getByRole("button", { name: transactionMaintenanceCopy.saveEdit }),
    );

    await waitFor(() => {
      expect(putBodies).toHaveLength(1);
    });
    expect(putBodies[0]).toEqual({
      type: "income",
      amountMinor: 1250,
      date: today,
      categoryId: "cat-salary",
      concept: "Supermercado",
      note: "Semanal",
      tagInputs: [{ tagId: "tag-trips" }],
    });
    expect(putBodies[0]).not.toHaveProperty("id");
    expect(
      fetchImpl.mock.calls.filter((call) => call[1]?.method === "POST"),
    ).toHaveLength(0);
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(screen.getByText("revision:1")).toBeVisible();
    expect(onCompleted).toHaveBeenCalledTimes(1);
  });

  it("keeps an already assigned archived category and tag, and refuses other archived ones", async () => {
    const user = userEvent.setup();
    const putBodies: unknown[] = [];
    const fetchImpl = maintenanceFetch({
      movement: archivedMovement,
      onMutate: (method, path, body) => {
        if (
          method === "PUT" &&
          path === `/api/transactions/${archivedMovement.id}`
        ) {
          putBodies.push(body);
          return jsonResponse(
            200,
            envelope({ ...archivedMovement, tagIds: ["tag-old"] }),
          );
        }
        return notFoundResponse();
      },
    });
    render(
      <Harness fetchImpl={fetchImpl} transactionId={archivedMovement.id} />,
    );

    await screen.findByLabelText(/Importe/);
    const category = screen.getByLabelText(/Categoría/);
    expect(category).toHaveValue("cat-old");
    expect(
      within(category).getByRole("option", { name: "Antigua" }),
    ).toBeEnabled();
    expect(
      within(category).queryByRole("option", { name: "Otra archivada" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Vieja")).toBeVisible();

    await user.click(screen.getByLabelText("Ingreso"));
    expect(screen.getByLabelText(/Categoría/)).toHaveValue("");
    expect(
      within(screen.getByLabelText(/Categoría/)).queryByRole("option", {
        name: "Antigua",
      }),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByLabelText(/Categoría/)).getByRole("option", {
        name: "Nómina",
      }),
    ).toBeInTheDocument();

    await user.click(screen.getByLabelText("Gasto"));
    await user.selectOptions(screen.getByLabelText(/Categoría/), "cat-old");
    await user.click(
      screen.getByRole("button", { name: transactionMaintenanceCopy.saveEdit }),
    );

    await waitFor(() => {
      expect(putBodies).toHaveLength(1);
    });
    expect(putBodies[0]).toMatchObject({
      type: "expense",
      categoryId: "cat-old",
      tagInputs: [{ tagId: "tag-old" }],
    });
  });

  it("explains a 404 and closes without mutating", async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn<FetchLike>(async (path) => {
      if (path === `/api/transactions/${movement.id}`) {
        return notFoundResponse();
      }
      return notFoundResponse();
    });
    render(<Harness fetchImpl={fetchImpl} />);

    expect(
      await screen.findByText(transactionMaintenanceCopy.notFound),
    ).toBeVisible();
    expect(
      screen.getByText(transactionMaintenanceCopy.notFoundHint),
    ).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: transactionMaintenanceCopy.close }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      fetchImpl.mock.calls.filter(
        (call) => call[1]?.method === "PUT" || call[1]?.method === "POST",
      ),
    ).toHaveLength(0);
  });

  it("retries after a network load failure", async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn<FetchLike>(async (path) => {
      const getCalls = fetchImpl.mock.calls.filter(
        (call) =>
          String(call[0]) === `/api/transactions/${movement.id}` &&
          (call[1]?.method ?? "GET") === "GET",
      ).length;
      if (path === `/api/transactions/${movement.id}` && getCalls === 1) {
        return jsonResponse(503, {
          error: {
            code: "serviceUnavailable",
            message: API_ERROR_MESSAGE.serviceUnavailable,
            requestId: REQUEST_ID,
          },
        });
      }
      return maintenanceFetch()(path, { method: "GET" });
    });
    render(<Harness fetchImpl={fetchImpl} />);

    expect(
      await screen.findByText(transactionMaintenanceCopy.loadError),
    ).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: transactionMaintenanceCopy.retry }),
    );
    expect(await screen.findByLabelText(/Importe/)).toHaveValue("12,50");
  });

  it("keeps the form when the PUT is refused", async () => {
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
    await user.clear(screen.getByLabelText("Concepto"));
    await user.type(screen.getByLabelText("Concepto"), "Pan");
    await user.click(
      screen.getByRole("button", { name: transactionMaintenanceCopy.saveEdit }),
    );

    expect(
      await screen.findByText(API_ERROR_MESSAGE.validationFailed),
    ).toBeVisible();
    expect(screen.getByLabelText("Concepto")).toHaveValue("Pan");
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByText("revision:0")).toBeVisible();
  });

  it("blocks a second submit and Escape while the PUT is pending", async () => {
    const user = userEvent.setup();
    let resolvePut!: (response: Response) => void;
    const pendingPut = new Promise<Response>((resolve) => {
      resolvePut = resolve;
    });
    const putBodies: unknown[] = [];
    const fetchImpl = maintenanceFetch({
      onMutate: (method, _path, body) => {
        if (method === "PUT") {
          putBodies.push(body);
          return pendingPut;
        }
        return notFoundResponse();
      },
    });
    render(<Harness fetchImpl={fetchImpl} />);

    await screen.findByLabelText(/Importe/);
    await user.click(
      screen.getByRole("button", { name: transactionMaintenanceCopy.saveEdit }),
    );
    await user.click(
      screen.getByRole("button", { name: transactionMaintenanceCopy.saveEdit }),
    );
    await user.keyboard("{Escape}");

    expect(putBodies).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: transactionMaintenanceCopy.saveEdit }),
    ).toBeDisabled();
    expect(screen.getByRole("dialog")).toBeVisible();

    resolvePut(jsonResponse(200, envelope({ ...movement, tagIds: [] })));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("does not PUT when cancelled and restores focus to the opener", async () => {
    const user = userEvent.setup();
    const fetchImpl = maintenanceFetch();
    render(<Harness fetchImpl={fetchImpl} initiallyOpen={false} />);

    const opener = screen.getByRole("button", { name: "Abrir edición" });
    await user.click(opener);
    await screen.findByLabelText(/Importe/);
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      fetchImpl.mock.calls.filter((call) => call[1]?.method === "PUT"),
    ).toHaveLength(0);
    expect(opener).toHaveFocus();
  });

  it("explains a missing identifier without requesting a movement", async () => {
    const fetchImpl = maintenanceFetch();
    render(<Harness fetchImpl={fetchImpl} transactionId={null} />);

    expect(
      await screen.findByText(transactionMaintenanceCopy.loadError),
    ).toBeVisible();
    expect(
      fetchImpl.mock.calls.filter((call) =>
        String(call[0]).startsWith("/api/transactions/"),
      ),
    ).toHaveLength(0);
  });

  it("keeps the form when the PUT fails on the network", async () => {
    const user = userEvent.setup();
    const fetchImpl = maintenanceFetch({
      onMutate: () => Promise.reject(new TypeError("Failed to fetch")),
    });
    render(<Harness fetchImpl={fetchImpl} />);

    await screen.findByLabelText(/Importe/);
    await user.click(
      screen.getByRole("button", { name: transactionMaintenanceCopy.saveEdit }),
    );

    expect(
      await screen.findByText(transactionMaintenanceCopy.saveError),
    ).toBeVisible();
    expect(screen.getByLabelText("Concepto")).toHaveValue("Supermercado");
    expect(screen.getByRole("dialog")).toBeVisible();
  });
});
