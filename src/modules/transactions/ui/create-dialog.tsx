"use client";

import { useMemo, useRef, useState } from "react";

import { createClassificationApi } from "../../classification/client/classification-api";
import type { CategoryDto } from "../../classification/contracts/category";
import type { TagDto } from "../../classification/contracts/tag";
import { createRecurringApi } from "../../recurring/client/recurring-api";
import { createPreferencesApi } from "../../preferences/client/preferences-api";
import {
  createApiClient,
  type ApiClient,
  type ApiClientFailure,
} from "../../../shared/client/api-client";
import { useFinancialDataRevision } from "../../../shared/client/financial-data-provider";
import { useResource } from "../../../shared/client/use-resource";
import { Button } from "../../../shared/ui/button";
import { DialogShell } from "../../../shared/ui/dialog";
import { EmptyState } from "../../../shared/ui/empty-state";
import { LoadingState } from "../../../shared/ui/loading-state";
import { createTransactionsApi } from "../client/transactions-api";
import type { TransactionCreateBody } from "../contracts/http";
import { TransactionForm } from "./transaction-form";
import {
  defaultTransactionFormValues,
  type TransactionFormValues,
} from "./transaction-form-schema";

export const createTransactionDialogCopy = {
  add: "Añadir movimiento",
  description:
    "Registra un gasto o un ingreso. La fecha de hoy viene de la instalación.",
  loadError: "No se han podido cargar las categorías y la fecha de hoy.",
  loadHint: "Revisa la conexión e inténtalo de nuevo.",
  retry: "Reintentar",
  saveError: "No se ha podido guardar. Conservamos los datos introducidos.",
  successAnother: "Puedes registrar otro movimiento.",
  successExpense: "Gasto añadido.",
  successIncome: "Ingreso añadido.",
  title: "Nuevo movimiento",
} as const;

export interface CreateTransactionDialogProps {
  readonly client?: ApiClient;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
}

interface CreateCatalog {
  readonly today: string;
  readonly categories: readonly CategoryDto[];
  readonly tags: readonly TagDto[];
}

function failureMessage(failure: ApiClientFailure): string {
  if (failure.reason === "api") {
    return failure.error.message;
  }

  return createTransactionDialogCopy.saveError;
}

function successMessage(type: TransactionCreateBody["type"]): string {
  return type === "income"
    ? createTransactionDialogCopy.successIncome
    : createTransactionDialogCopy.successExpense;
}

export function CreateTransactionDialog({
  client,
  onOpenChange,
  open,
}: CreateTransactionDialogProps) {
  const apiClient = useMemo(() => client ?? createApiClient(), [client]);
  const classificationApi = useMemo(
    () => createClassificationApi(apiClient),
    [apiClient],
  );
  const preferencesApi = useMemo(
    () => createPreferencesApi(apiClient),
    [apiClient],
  );
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
  const catalog = useResource<CreateCatalog>({
    enabled: open,
    requestKey: "create-transaction-catalog",
    revision: 0,
    refreshEpoch: 0,
    load: async (signal) => {
      const preferences = await preferencesApi.getPreferences({ signal });
      if (!preferences.ok) {
        return preferences;
      }

      const categories = await classificationApi.listCategories(
        { status: "active" },
        { signal },
      );
      if (!categories.ok) {
        return categories;
      }

      const tags = await classificationApi.listTags(
        { status: "active" },
        { signal },
      );
      if (!tags.ok) {
        return tags;
      }

      if (preferences.noContent || categories.noContent || tags.noContent) {
        return {
          ok: false,
          reason: "invalidResponse",
          status: 204,
        };
      }

      return {
        ok: true,
        noContent: false,
        status: preferences.status,
        requestId: preferences.requestId,
        data: {
          today: preferences.data.today,
          categories: categories.data,
          tags: tags.data,
        },
      };
    },
  });
  const [pending, setPending] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [initialValues, setInitialValues] = useState<
    Partial<TransactionFormValues>
  >({});
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  function resetDialogState() {
    pendingRef.current = false;
    setPending(false);
    setFormKey(0);
    setInitialValues({});
    setStatusMessage(null);
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

  async function save(
    body: TransactionCreateBody,
    addAnother: boolean,
  ): Promise<void> {
    if (pendingRef.current) {
      return;
    }

    pendingRef.current = true;
    setPending(true);
    setSaveError(null);

    const result = await transactionsApi.createTransaction(body);

    if (!result.ok) {
      pendingRef.current = false;
      if (result.reason !== "aborted") {
        setSaveError(failureMessage(result));
      }
      setPending(false);
      return;
    }

    announceSuccessfulMutation();
    const confirmation = successMessage(body.type);

    if (addAnother) {
      pendingRef.current = false;
      setInitialValues({
        type: body.type,
        date: body.date,
        categoryId: body.categoryId,
      });
      setFormKey((current) => current + 1);
      setStatusMessage(
        `${confirmation} ${createTransactionDialogCopy.successAnother}`,
      );
      setPending(false);
      return;
    }

    resetDialogState();
    onOpenChange(false);
  }

  const today = catalog.data?.today ?? "";

  return (
    <DialogShell
      description={createTransactionDialogCopy.description}
      open={open}
      preventClose={pending}
      showCloseButton={!pending}
      title={createTransactionDialogCopy.title}
      onOpenChange={handleOpenChange}
    >
      {catalog.status === "loading" ? (
        <LoadingState />
      ) : catalog.status === "error" || !catalog.data ? (
        <EmptyState
          action={
            <Button type="button" variant="secondary" onClick={catalog.refetch}>
              {createTransactionDialogCopy.retry}
            </Button>
          }
          description={createTransactionDialogCopy.loadHint}
          title={createTransactionDialogCopy.loadError}
        />
      ) : (
        <div className="flex w-full max-w-full flex-col gap-3">
          {statusMessage ? (
            <p
              aria-live="polite"
              className="text-body-sm text-income"
              role="status"
            >
              {statusMessage}
            </p>
          ) : null}
          {saveError ? (
            <p className="text-body-sm text-danger" role="alert">
              {saveError}
            </p>
          ) : null}
          <TransactionForm
            key={`${formKey}:${today}`}
            categories={catalog.data.categories}
            initialValues={defaultTransactionFormValues(today, initialValues)}
            pending={pending}
            recurringApi={recurringApi}
            tags={catalog.data.tags}
            today={today}
            onCancel={() => {
              handleOpenChange(false);
            }}
            onSubmit={(body) => save(body, false)}
            onSubmitAndAddAnother={(body) => save(body, true)}
          />
        </div>
      )}
    </DialogShell>
  );
}
