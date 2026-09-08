/**
 * Combined first page of the history plus the catalogs needed to label it.
 *
 * Categories and tags stay `status: "all"` so an archived classification still
 * names a movement that already exists. A 204 from any of the three calls is
 * treated as an invalid response: the list cannot paint without a page.
 */

import { createClassificationApi } from "../../classification/client/classification-api";
import type { CategoryDto } from "../../classification/contracts/category";
import type { TagDto } from "../../classification/contracts/tag";
import type {
  ApiClient,
  ApiClientResult,
} from "../../../shared/client/api-client";
import { createTransactionsApi } from "../client/transactions-api";
import type { TransactionDto } from "../contracts/transaction";

/** First history page together with the catalogs that label its rows. */
export interface HistorySnapshot {
  readonly items: readonly TransactionDto[];
  readonly nextCursor: string | null;
  readonly categories: readonly CategoryDto[];
  readonly tags: readonly TagDto[];
}

/** Loads the first unfiltered history page and the catalogs that name it. */
export async function loadHistorySnapshot(
  client: ApiClient,
  signal: AbortSignal,
): Promise<ApiClientResult<HistorySnapshot>> {
  const transactionsApi = createTransactionsApi(client);
  const classificationApi = createClassificationApi(client);

  const [transactions, categories, tags] = await Promise.all([
    transactionsApi.listTransactions({}, { signal }),
    classificationApi.listCategories({ status: "all" }, { signal }),
    classificationApi.listTags({ status: "all" }, { signal }),
  ]);

  if (!transactions.ok) {
    return transactions;
  }

  if (!categories.ok) {
    return categories;
  }

  if (!tags.ok) {
    return tags;
  }

  if (transactions.noContent || categories.noContent || tags.noContent) {
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
      categories: categories.data,
      tags: tags.data,
    },
  };
}
