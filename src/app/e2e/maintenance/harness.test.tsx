import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { e2eMaintenanceHarnessCopy, E2eMaintenanceHarness } from "./harness";

const { useSearchParams } = vi.hoisted(() => ({
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));

vi.mock("next/navigation", () => ({
  useSearchParams,
}));

vi.mock("../../../modules/transactions/ui/edit-dialog", () => ({
  EditTransactionDialog: ({
    transactionId,
  }: {
    transactionId: string | null;
  }) => <div role="dialog">editar:{transactionId}</div>,
}));

vi.mock("../../../modules/transactions/ui/duplicate-dialog", () => ({
  DuplicateTransactionDialog: ({
    transactionId,
  }: {
    transactionId: string | null;
  }) => <div role="dialog">duplicar:{transactionId}</div>,
}));

vi.mock("../../../modules/transactions/ui/delete-dialog", () => ({
  DeleteTransactionDialog: ({
    transactionId,
  }: {
    transactionId: string | null;
  }) => <div role="dialog">eliminar:{transactionId}</div>,
}));

describe("E2eMaintenanceHarness", () => {
  it("asks for a movement identifier before opening a dialog", () => {
    useSearchParams.mockReturnValue(new URLSearchParams("mode=edit"));
    render(<E2eMaintenanceHarness />);

    expect(
      screen.getByRole("heading", { name: e2eMaintenanceHarnessCopy.title }),
    ).toBeVisible();
    expect(screen.getByText(e2eMaintenanceHarnessCopy.missingId)).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("rejects an unknown maintenance mode", () => {
    useSearchParams.mockReturnValue(new URLSearchParams("mode=print&id=tx-1"));
    render(<E2eMaintenanceHarness />);

    expect(
      screen.getByText(e2eMaintenanceHarnessCopy.unknownMode),
    ).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it.each([
    ["edit", "editar:tx-1"],
    ["duplicate", "duplicar:tx-1"],
    ["delete", "eliminar:tx-1"],
  ] as const)(
    "opens the %s dialog for the requested movement",
    (mode, label) => {
      useSearchParams.mockReturnValue(
        new URLSearchParams(`mode=${mode}&id=tx-1`),
      );
      render(<E2eMaintenanceHarness />);

      expect(
        screen.getByText(e2eMaintenanceHarnessCopy.description),
      ).toBeVisible();
      expect(screen.getByRole("dialog")).toHaveTextContent(label);
    },
  );
});
