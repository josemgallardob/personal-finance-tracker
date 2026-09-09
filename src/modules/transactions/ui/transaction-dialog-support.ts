import { createClassificationApi } from "../../classification/client/classification-api";
import type { CategoryDto } from "../../classification/contracts/category";
import type { TagDto } from "../../classification/contracts/tag";
import { createPreferencesApi } from "../../preferences/client/preferences-api";
import type {
  ApiClient,
  ApiClientFailure,
  ApiClientResult,
} from "../../../shared/client/api-client";
import {
  formatMoneyMinorAsAmountText,
  formatMoneyMinorAsEur,
  type MoneyMinor,
} from "../../../shared/domain/money";
import { createTransactionsApi } from "../client/transactions-api";
import type { TransactionDto } from "../contracts/transaction";
import type { TagSelection } from "../../classification/ui/tag-picker";
import { formatLocalDateAsSpanish } from "./transaction-form-schema";
import type { TransactionFormValues } from "./transaction-form-schema";

export const transactionMaintenanceCopy = {
  close: "Cerrar",
  deleteConfirm: "Eliminar movimiento",
  deleteError: "No se ha podido eliminar el movimiento.",
  deleteTitle: "¿Eliminar este movimiento?",
  duplicateDescription:
    "Se creará un movimiento nuevo con estos valores. El original no cambia y no hereda recurrencia.",
  duplicateTitle: "Duplicar movimiento",
  editDescription:
    "Corrige el movimiento. El histórico se recalculará al guardar.",
  editTitle: "Editar movimiento",
  loadError: "No se ha podido cargar el movimiento.",
  loadHint: "Revisa la conexión e inténtalo de nuevo.",
  notFound: "Este movimiento ya no existe.",
  notFoundHint: "Puede haberse eliminado o el enlace ya no es válido.",
  retry: "Reintentar",
  saveError: "No se ha podido guardar. Conservamos los datos introducidos.",
  saveEdit: "Guardar cambios",
  saveDuplicateExpense: "Añadir copia del gasto",
  saveDuplicateIncome: "Añadir copia del ingreso",
} as const;

export interface LoadedTransactionEditor {
  readonly today: string;
  readonly categories: readonly CategoryDto[];
  readonly tags: readonly TagDto[];
  readonly transaction: TransactionDto;
}

export function apiFailureMessage(
  failure: ApiClientFailure,
  fallback: string,
): string {
  if (failure.reason === "api") {
    return failure.error.message;
  }

  return fallback;
}

function asMoneyMinor(amountMinor: number): MoneyMinor {
  return amountMinor as MoneyMinor;
}

export function transactionToFormValues(
  transaction: TransactionDto,
  tags: readonly TagDto[],
): TransactionFormValues {
  const tagsById = new Map(tags.map((tag) => [tag.id, tag]));
  const tagSelections: TagSelection[] = transaction.tagIds.map((tagId) => ({
    kind: "existing",
    tagId,
    name: tagsById.get(tagId)?.name ?? tagId,
  }));

  return {
    type: transaction.type,
    amountText: formatMoneyMinorAsAmountText(
      asMoneyMinor(transaction.amountMinor),
    ),
    date: transaction.date,
    categoryId: transaction.categoryId,
    concept: transaction.concept ?? "",
    note: transaction.note ?? "",
    tagSelections,
    recurrenceEnabled: false,
    monthlyDay: Number(transaction.date.slice(-2)),
  };
}

export function describeTransactionForDelete(
  transaction: TransactionDto,
  categories: readonly CategoryDto[],
): string {
  const categoryName =
    categories.find((category) => category.id === transaction.categoryId)
      ?.name ?? "Movimiento";
  const label = transaction.concept?.trim() || categoryName;
  const amount = formatMoneyMinorAsEur(asMoneyMinor(transaction.amountMinor));
  const signedAmount =
    transaction.type === "expense" ? `−${amount}` : `+${amount}`;
  return `Se eliminará ${label} · ${formatLocalDateAsSpanish(transaction.date)} · ${signedAmount}. Esta acción no se puede deshacer.`;
}

export async function loadTransactionEditor(
  client: ApiClient,
  transactionId: string,
  signal: AbortSignal,
): Promise<ApiClientResult<LoadedTransactionEditor>> {
  const transactionsApi = createTransactionsApi(client);
  const classificationApi = createClassificationApi(client);
  const preferencesApi = createPreferencesApi(client);

  const transaction = await transactionsApi.getTransaction(transactionId, {
    signal,
  });
  if (!transaction.ok) {
    return transaction;
  }

  const preferences = await preferencesApi.getPreferences({ signal });
  if (!preferences.ok) {
    return preferences;
  }

  const categories = await classificationApi.listCategories(
    { status: "all" },
    { signal },
  );
  if (!categories.ok) {
    return categories;
  }

  const tags = await classificationApi.listTags({ status: "all" }, { signal });
  if (!tags.ok) {
    return tags;
  }

  if (
    transaction.noContent ||
    preferences.noContent ||
    categories.noContent ||
    tags.noContent
  ) {
    return {
      ok: false,
      reason: "invalidResponse",
      status: 204,
    };
  }

  return {
    ok: true,
    noContent: false,
    status: transaction.status,
    requestId: transaction.requestId,
    data: {
      today: preferences.data.today,
      categories: categories.data,
      tags: tags.data,
      transaction: transaction.data,
    },
  };
}
