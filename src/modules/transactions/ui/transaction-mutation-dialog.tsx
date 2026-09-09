"use client";

import { useMemo, useRef, useState } from "react";

import {
  createApiClient,
  type ApiClient,
} from "../../../shared/client/api-client";
import { useFinancialDataRevision } from "../../../shared/client/financial-data-provider";
import { useResource } from "../../../shared/client/use-resource";
import { Button } from "../../../shared/ui/button";
import { DialogShell } from "../../../shared/ui/dialog";
import { EmptyState } from "../../../shared/ui/empty-state";
import { LoadingState } from "../../../shared/ui/loading-state";
import { createTransactionsApi } from "../client/transactions-api";
import { createRecurringApi } from "../../recurring/client/recurring-api";
import type { TransactionWriteBody } from "../contracts/http";
import { TransactionForm } from "./transaction-form";
import {
  apiFailureMessage,
  loadTransactionEditor,
  transactionMaintenanceCopy,
  transactionToFormValues,
} from "./transaction-dialog-support";

export type TransactionMutationMode = "edit" | "duplicate";

export interface TransactionMutationDialogProps {
  readonly client?: ApiClient;
  readonly mode: TransactionMutationMode;
  readonly onCompleted?: () => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
  readonly transactionId: string | null;
}

export function TransactionMutationDialog({
  client,
  mode,
  onCompleted,
  onOpenChange,
  open,
  transactionId,
}: TransactionMutationDialogProps) {
  const apiClient = useMemo(() => client ?? createApiClient(), [client]);
  const transactionsApi = useMemo(
    () => createTransactionsApi(apiClient),
    [apiClient],
  );
  const recurringApi = useMemo(
    () => createRecurringApi(apiClient),
    [apiClient],
  );
  const { announceSuccessfulMutation } = useFinancialDataRevision();
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);
  const editor = useResource({
    enabled: open,
    requestKey: `transaction-${mode}:${transactionId ?? ""}`,
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
    setSaveError(null);
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

  async function save(body: TransactionWriteBody): Promise<void> {
    if (pendingRef.current || transactionId === null) {
      return;
    }

    pendingRef.current = true;
    setPending(true);
    setSaveError(null);

    const result =
      mode === "edit"
        ? await transactionsApi.updateTransaction(transactionId, body)
        : await transactionsApi.createTransaction(body);

    if (!result.ok) {
      pendingRef.current = false;
      if (result.reason !== "aborted") {
        setSaveError(
          apiFailureMessage(result, transactionMaintenanceCopy.saveError),
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

  async function activateExisting(): Promise<void> {
    if (transactionId === null || !editor.data || activating) return;
    setActivating(true);
    setSaveError(null);
    const result = await recurringApi.activateRule({
      transactionId,
      monthlyDay: Number(editor.data.transaction.date.slice(-2)),
    });
    setActivating(false);
    if (!result.ok) {
      setSaveError(
        apiFailureMessage(result, transactionMaintenanceCopy.saveError),
      );
      return;
    }
    announceSuccessfulMutation();
    onCompleted?.();
    onOpenChange(false);
  }

  const title =
    mode === "edit"
      ? transactionMaintenanceCopy.editTitle
      : transactionMaintenanceCopy.duplicateTitle;
  const description =
    mode === "edit"
      ? transactionMaintenanceCopy.editDescription
      : transactionMaintenanceCopy.duplicateDescription;
  const notFound =
    editor.error?.reason === "api" && editor.error.error.code === "notFound";

  return (
    <DialogShell
      description={description}
      open={open}
      preventClose={pending}
      showCloseButton={!pending}
      title={title}
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
      ) : (
        <div className="flex w-full max-w-full flex-col gap-3">
          {saveError ? (
            <p className="text-body-sm text-danger" role="alert">
              {saveError}
            </p>
          ) : null}
          <TransactionForm
            categories={editor.data.categories}
            initialValues={transactionToFormValues(
              editor.data.transaction,
              editor.data.tags,
            )}
            pending={pending}
            retainedCategoryId={editor.data.transaction.categoryId}
            retainedTagIds={editor.data.transaction.tagIds}
            submitLabel={
              mode === "edit"
                ? transactionMaintenanceCopy.saveEdit
                : editor.data.transaction.type === "income"
                  ? transactionMaintenanceCopy.saveDuplicateIncome
                  : transactionMaintenanceCopy.saveDuplicateExpense
            }
            tags={editor.data.tags}
            today={editor.data.today}
            onCancel={() => {
              handleOpenChange(false);
            }}
            onSubmit={save}
          />
          {mode === "edit" ? (
            <Button
              disabled={pending || activating}
              pending={activating}
              type="button"
              variant="secondary"
              onClick={activateExisting}
            >
              Repetir cada mes
            </Button>
          ) : null}
        </div>
      )}
    </DialogShell>
  );
}
