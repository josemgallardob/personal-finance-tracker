"use client";

import { useMemo, useRef, useState } from "react";

import {
  createApiClient,
  type ApiClient,
} from "../../../shared/client/api-client";
import { useFinancialDataRevision } from "../../../shared/client/financial-data-provider";
import { useResource } from "../../../shared/client/use-resource";
import { Button } from "../../../shared/ui/button";
import { confirmDialogCopy } from "../../../shared/ui/confirm-dialog";
import { DialogShell } from "../../../shared/ui/dialog";
import { EmptyState } from "../../../shared/ui/empty-state";
import { ErrorSummary } from "../../../shared/ui/error-summary";
import { LoadingState } from "../../../shared/ui/loading-state";
import { createTransactionsApi } from "../client/transactions-api";
import {
  apiFailureMessage,
  describeTransactionForDelete,
  loadTransactionEditor,
  transactionMaintenanceCopy,
} from "./transaction-dialog-support";

export interface DeleteTransactionDialogProps {
  readonly client?: ApiClient;
  readonly onCompleted?: () => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
  readonly transactionId: string | null;
}

export function DeleteTransactionDialog({
  client,
  onCompleted,
  onOpenChange,
  open,
  transactionId,
}: DeleteTransactionDialogProps) {
  const apiClient = useMemo(() => client ?? createApiClient(), [client]);
  const transactionsApi = useMemo(
    () => createTransactionsApi(apiClient),
    [apiClient],
  );
  const { announceSuccessfulMutation } = useFinancialDataRevision();
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const editor = useResource({
    enabled: open,
    requestKey: `transaction-delete:${transactionId ?? ""}`,
    revision: 0,
    refreshEpoch: 0,
    load: (signal) => {
      if (transactionId === null) {
        return Promise.resolve({
          ok: false as const,
          reason: "invalidResponse" as const,
          status: 204,
        });
      }

      return loadTransactionEditor(apiClient, transactionId, signal);
    },
  });

  function resetDialogState() {
    pendingRef.current = false;
    setPending(false);
    setDeleteError(null);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (pendingRef.current && !nextOpen) {
      return;
    }

    if (!nextOpen) {
      resetDialogState();
    }

    onOpenChange(nextOpen);
  }

  async function confirmDelete(): Promise<void> {
    if (pendingRef.current || transactionId === null) {
      return;
    }

    pendingRef.current = true;
    setPending(true);
    setDeleteError(null);

    const result = await transactionsApi.deleteTransaction(transactionId);

    if (!result.ok) {
      pendingRef.current = false;
      if (result.reason !== "aborted") {
        setDeleteError(
          apiFailureMessage(result, transactionMaintenanceCopy.deleteError),
        );
      }
      setPending(false);
      return;
    }

    announceSuccessfulMutation();
    onCompleted?.();
    resetDialogState();
    onOpenChange(false);
  }

  const notFound =
    editor.error?.reason === "api" && editor.error.error.code === "notFound";
  const loaded = editor.status === "ready" && editor.data !== undefined;
  const identifyingCopy = loaded
    ? describeTransactionForDelete(
        editor.data.transaction,
        editor.data.categories,
      )
    : transactionMaintenanceCopy.deleteTitle;

  return (
    <DialogShell
      description={identifyingCopy}
      footer={
        loaded ? (
          <>
            <Button
              disabled={pending}
              variant="secondary"
              onClick={() => {
                handleOpenChange(false);
              }}
            >
              {confirmDialogCopy.cancel}
            </Button>
            <Button
              pending={pending}
              variant="danger"
              onClick={() => {
                void confirmDelete();
              }}
            >
              {transactionMaintenanceCopy.deleteConfirm}
            </Button>
          </>
        ) : undefined
      }
      open={open}
      preventClose={pending}
      showCloseButton={!loaded && !pending}
      title={transactionMaintenanceCopy.deleteTitle}
      onOpenChange={handleOpenChange}
    >
      {editor.status === "loading" ? (
        <LoadingState />
      ) : editor.status === "error" || !editor.data ? (
        <EmptyState
          action={
            notFound ? undefined : (
              <Button
                type="button"
                variant="secondary"
                onClick={editor.refetch}
              >
                {transactionMaintenanceCopy.retry}
              </Button>
            )
          }
          description={
            notFound
              ? transactionMaintenanceCopy.notFoundHint
              : transactionMaintenanceCopy.loadHint
          }
          title={
            notFound
              ? transactionMaintenanceCopy.notFound
              : transactionMaintenanceCopy.loadError
          }
        />
      ) : deleteError ? (
        <ErrorSummary errors={[{ message: deleteError }]} />
      ) : null}
    </DialogShell>
  );
}
