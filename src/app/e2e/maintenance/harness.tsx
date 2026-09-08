"use client";

import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { DeleteTransactionDialog } from "../../../modules/transactions/ui/delete-dialog";
import { DuplicateTransactionDialog } from "../../../modules/transactions/ui/duplicate-dialog";
import { EditTransactionDialog } from "../../../modules/transactions/ui/edit-dialog";

export const e2eMaintenanceHarnessCopy = {
  description:
    "Abre los diálogos de mantenimiento contra el servicio real. El historial los mostrará en cada fila más adelante.",
  missingId: "Falta el identificador del movimiento.",
  title: "Mantenimiento de prueba",
  unknownMode: "Este modo de mantenimiento no existe.",
} as const;

type MaintenanceMode = "edit" | "duplicate" | "delete";

function readMode(value: string | null): MaintenanceMode | null {
  if (value === "edit" || value === "duplicate" || value === "delete") {
    return value;
  }

  return null;
}

export function E2eMaintenanceHarness() {
  const searchParams = useSearchParams();
  const mode = readMode(searchParams.get("mode"));
  const transactionId = searchParams.get("id");
  const [open, setOpen] = useState(true);
  const dialogProps = useMemo(
    () => ({
      open,
      transactionId,
      onOpenChange: setOpen,
    }),
    [open, transactionId],
  );

  if (transactionId === null || transactionId.trim() === "") {
    return (
      <section aria-labelledby="e2e-maintenance-title">
        <h1
          className="text-heading-sm text-text font-medium"
          id="e2e-maintenance-title"
        >
          {e2eMaintenanceHarnessCopy.title}
        </h1>
        <p className="text-body text-text-muted mt-3">
          {e2eMaintenanceHarnessCopy.missingId}
        </p>
      </section>
    );
  }

  if (mode === null) {
    return (
      <section aria-labelledby="e2e-maintenance-title">
        <h1
          className="text-heading-sm text-text font-medium"
          id="e2e-maintenance-title"
        >
          {e2eMaintenanceHarnessCopy.title}
        </h1>
        <p className="text-body text-text-muted mt-3">
          {e2eMaintenanceHarnessCopy.unknownMode}
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="e2e-maintenance-title">
      <h1
        className="text-heading-sm text-text font-medium"
        id="e2e-maintenance-title"
      >
        {e2eMaintenanceHarnessCopy.title}
      </h1>
      <p className="text-body text-text-muted mt-3">
        {e2eMaintenanceHarnessCopy.description}
      </p>
      {mode === "edit" ? <EditTransactionDialog {...dialogProps} /> : null}
      {mode === "duplicate" ? (
        <DuplicateTransactionDialog {...dialogProps} />
      ) : null}
      {mode === "delete" ? <DeleteTransactionDialog {...dialogProps} /> : null}
    </section>
  );
}
