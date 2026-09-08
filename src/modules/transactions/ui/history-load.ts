/**
 * History catalogs and the first filtered page of movements.
 *
 * Categories and tags stay `status: "all"` so an archived classification still
 * names a movement that already exists. A 204 from any of the calls is treated
 * as an invalid response: the list cannot paint without a page.
 */

import { createClassificationApi } from "../../classification/client/classification-api";
import type { CategoryDto } from "../../classification/contracts/category";
import type { TagDto } from "../../classification/contracts/tag";
import type {
  ApiClient,
  ApiClientResult,
} from "../../../shared/client/api-client";
import { createTransactionsApi } from "../client/transactions-api";
import type { TransactionListQuery } from "../contracts/http";
import type { TransactionDto } from "../contracts/transaction";

/** Catalogs used to label history rows and filter controls. */
export interface HistoryCatalogs {
  readonly categories: readonly CategoryDto[];
  readonly tags: readonly TagDto[];
}

/** First history page together with the catalogs that label its rows. */
export interface HistorySnapshot {
  readonly items: readonly TransactionDto[];
  readonly nextCursor: string | null;
  readonly categories: readonly CategoryDto[];
  readonly tags: readonly TagDto[];
}

/** Loads categories and tags, including archived rows that still name movements. */
export async function loadHistoryCatalogs(
  client: ApiClient,
  signal: AbortSignal,
): Promise<ApiClientResult<HistoryCatalogs>> {
  const classificationApi = createClassificationApi(client);
  const [categories, tags] = await Promise.all([
    classificationApi.listCategories({ status: "all" }, { signal }),
    classificationApi.listTags({ status: "all" }, { signal }),
  ]);

  if (!categories.ok) {
    return categories;
  }

  if (!tags.ok) {
    return tags;
  }

  if (categories.noContent || tags.noContent) {
    return {
      ok: false,
      reason: "invalidResponse",
      status: 204,
    };
  }

  return {
    ok: true,
    noContent: false,
    status: categories.status,
    requestId: categories.requestId,
    data: {
      categories: categories.data,
      tags: tags.data,
    },
  };
}

/** Loads the first history page for the given filters plus the catalogs that name it. */
export async function loadHistorySnapshot(
  client: ApiClient,
  signal: AbortSignal,
  query: TransactionListQuery = {},
): Promise<ApiClientResult<HistorySnapshot>> {
  const transactionsApi = createTransactionsApi(client);
  const [transactions, catalogs] = await Promise.all([
    transactionsApi.listTransactions(query, { signal }),
    loadHistoryCatalogs(client, signal),
  ]);

  if (!transactions.ok) {
    return transactions;
  }

  if (!catalogs.ok) {
    return catalogs;
  }

  if (transactions.noContent || catalogs.noContent) {
    return {
      ok: false,
      reason: "invalidResponse",
      status: 204,
    };
  }

  return {
    ok: true,
    noContent: false,
    status: transactions.status,
    requestId: transactions.requestId,
    data: {
      items: transactions.data.items,
      nextCursor: transactions.data.nextCursor,
      categories: catalogs.data.categories,
      tags: catalogs.data.tags,
    },
  };
}
