import { render, screen, waitFor } from "@testing-library/react";
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
import { DeleteTransactionDialog } from "./delete-dialog";
import {
  categories,
  jsonResponse,
  maintenanceFetch,
  movement,
  noContentResponse,
  notFoundResponse,
  REQUEST_ID,
} from "./transaction-dialog-fixtures";
import {
  describeTransactionForDelete,
  transactionMaintenanceCopy,
} from "./transaction-dialog-support";

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
        Abrir borrado
      </button>
      <DeleteTransactionDialog
        client={client}
        open={open}
        transactionId={transactionId}
        onOpenChange={setOpen}
      />
      <RevisionReadout />
    </FinancialDataProvider>
  );
}

const identifyingCopy = describeTransactionForDelete(movement, categories);

describe("DeleteTransactionDialog", () => {
  it("identifies the movement and DELETEs only after confirm", async () => {
    const user = userEvent.setup();
    const fetchImpl = maintenanceFetch();
    render(<Harness fetchImpl={fetchImpl} />);

    const dialog = await screen.findByRole("dialog", {
      name: transactionMaintenanceCopy.deleteTitle,
    });
    expect(dialog).toHaveAccessibleDescription(identifyingCopy);

    expect(
      fetchImpl.mock.calls.filter((call) => call[1]?.method === "DELETE"),
    ).toHaveLength(0);

    await user.click(
      screen.getByRole("button", {
        name: transactionMaintenanceCopy.deleteConfirm,
      }),
    );

    await waitFor(() => {
      expect(
        fetchImpl.mock.calls.filter((call) => call[1]?.method === "DELETE"),
      ).toHaveLength(1);
    });
    expect(
      fetchImpl.mock.calls.find((call) => call[1]?.method === "DELETE")?.[0],
    ).toBe(`/api/transactions/${movement.id}`);
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(screen.getByText("revision:1")).toBeVisible();
  });

  it("preserves the movement when cancel or Escape is used", async () => {
    const user = userEvent.setup();
    const fetchImpl = maintenanceFetch();
    render(<Harness fetchImpl={fetchImpl} initiallyOpen={false} />);

    const opener = screen.getByRole("button", { name: "Abrir borrado" });
    await user.click(opener);
    await screen.findByRole("dialog", {
      name: transactionMaintenanceCopy.deleteTitle,
    });
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      fetchImpl.mock.calls.filter((call) => call[1]?.method === "DELETE"),
    ).toHaveLength(0);
    expect(opener).toHaveFocus();

    await user.click(opener);
    await screen.findByRole("dialog", {
      name: transactionMaintenanceCopy.deleteTitle,
    });
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      fetchImpl.mock.calls.filter((call) => call[1]?.method === "DELETE"),
    ).toHaveLength(0);
    expect(opener).toHaveFocus();
  });

  it("explains a 404 and does not DELETE", async () => {
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
      fetchImpl.mock.calls.filter((call) => call[1]?.method === "DELETE"),
    ).toHaveLength(0);
  });

  it("retries after a load failure", async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn<FetchLike>(async (path, init) => {
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
      return maintenanceFetch()(path, init);
    });
    render(<Harness fetchImpl={fetchImpl} />);

    expect(
      await screen.findByText(transactionMaintenanceCopy.loadError),
    ).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: transactionMaintenanceCopy.retry }),
    );
    expect(
      await screen.findByRole("dialog", {
        name: transactionMaintenanceCopy.deleteTitle,
      }),
    ).toHaveAccessibleDescription(identifyingCopy);
  });

  it("keeps the confirm dialog open when DELETE is refused", async () => {
    const user = userEvent.setup();
    const fetchImpl = maintenanceFetch({
      onMutate: (method) => {
        if (method === "DELETE") {
          return jsonResponse(422, {
            error: {
              code: "validationFailed",
              message: API_ERROR_MESSAGE.validationFailed,
              requestId: REQUEST_ID,
            },
          });
        }
        return notFoundResponse();
      },
    });
    render(<Harness fetchImpl={fetchImpl} />);

    await screen.findByRole("dialog", {
      name: transactionMaintenanceCopy.deleteTitle,
    });
    await user.click(
      screen.getByRole("button", {
        name: transactionMaintenanceCopy.deleteConfirm,
      }),
    );

    expect(
      await screen.findByText(API_ERROR_MESSAGE.validationFailed),
    ).toBeVisible();
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByText("revision:0")).toBeVisible();
  });

  it("blocks a second confirm and Escape while DELETE is pending", async () => {
    const user = userEvent.setup();
    let resolveDelete!: (response: Response) => void;
    const pendingDelete = new Promise<Response>((resolve) => {
      resolveDelete = resolve;
    });
    const fetchImpl = maintenanceFetch({
      onMutate: (method) => {
        if (method === "DELETE") {
          return pendingDelete;
        }
        return notFoundResponse();
      },
    });
    render(<Harness fetchImpl={fetchImpl} />);

    await screen.findByRole("dialog", {
      name: transactionMaintenanceCopy.deleteTitle,
    });
    await user.click(
      screen.getByRole("button", {
        name: transactionMaintenanceCopy.deleteConfirm,
      }),
    );
    await user.click(
      screen.getByRole("button", {
        name: transactionMaintenanceCopy.deleteConfirm,
      }),
    );
    await user.keyboard("{Escape}");

    expect(
      fetchImpl.mock.calls.filter((call) => call[1]?.method === "DELETE"),
    ).toHaveLength(1);
    expect(
      screen.getByRole("button", {
        name: transactionMaintenanceCopy.deleteConfirm,
      }),
    ).toBeDisabled();
    expect(screen.getByRole("dialog")).toBeVisible();

    resolveDelete(noContentResponse());
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("explains a missing identifier without deleting", async () => {
    const fetchImpl = maintenanceFetch();
    render(<Harness fetchImpl={fetchImpl} transactionId={null} />);

    expect(
      await screen.findByText(transactionMaintenanceCopy.loadError),
    ).toBeVisible();
    expect(
      fetchImpl.mock.calls.filter((call) => call[1]?.method === "DELETE"),
    ).toHaveLength(0);
  });

  it("keeps the confirm dialog open when DELETE fails on the network", async () => {
    const user = userEvent.setup();
    const fetchImpl = maintenanceFetch({
      onMutate: (method) => {
        if (method === "DELETE") {
          return Promise.reject(new TypeError("Failed to fetch"));
        }
        return notFoundResponse();
      },
    });
    render(<Harness fetchImpl={fetchImpl} />);

    await screen.findByRole("dialog", {
      name: transactionMaintenanceCopy.deleteTitle,
    });
    await user.click(
      screen.getByRole("button", {
        name: transactionMaintenanceCopy.deleteConfirm,
      }),
    );

    expect(
      await screen.findByText(transactionMaintenanceCopy.deleteError),
    ).toBeVisible();
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByText("revision:0")).toBeVisible();
  });
});
