/**
 * Browser adapters for movement endpoints.
 *
 * Each method builds the documented URL and body, including the stable query
 * encoding of repeated tags, open ranges, cursors and untagged filters, then
 * validates the returned representation against the public Zod contract.
 */

import type {
  ApiClient,
  ApiClientResult,
  ApiRequestOptions,
} from "../../../shared/client/api-client";
import { parseApiData } from "../../../shared/client/parse-api-data";
import {
  apiPath,
  encodeApiPathSegment,
  type ApiQueryParams,
} from "../../../shared/client/query";
import type {
  TransactionCursorPageDto,
  TransactionDto,
} from "../contracts/transaction";
import {
  transactionCursorPageDtoSchema,
  transactionDtoSchema,
  type TransactionListQuery,
  type TransactionWriteBody,
} from "../contracts/http";

/** Movement operations of the browser API. */
export interface TransactionsApi {
  listTransactions(
    query?: TransactionListQuery,
    options?: ApiRequestOptions,
  ): Promise<ApiClientResult<TransactionCursorPageDto>>;
  createTransaction(
    body: TransactionWriteBody,
    options?: ApiRequestOptions,
  ): Promise<ApiClientResult<TransactionDto>>;
  getTransaction(
    transactionId: string,
    options?: ApiRequestOptions,
  ): Promise<ApiClientResult<TransactionDto>>;
  updateTransaction(
    transactionId: string,
    body: TransactionWriteBody,
    options?: ApiRequestOptions,
  ): Promise<ApiClientResult<TransactionDto>>;
  deleteTransaction(
    transactionId: string,
    options?: ApiRequestOptions,
  ): Promise<ApiClientResult<null>>;
}

function transactionItemPath(transactionId: string): string {
  return apiPath(`/api/transactions/${encodeApiPathSegment(transactionId)}`);
}

function listQueryParams(query: TransactionListQuery): ApiQueryParams {
  return {
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
    type: query.type,
    categoryId: query.categoryId,
    tagId: query.tagId,
    untagged:
      query.untagged === undefined
        ? undefined
        : query.untagged
          ? "true"
          : "false",
    q: query.q,
    cursor: query.cursor,
    limit: query.limit,
  };
}

/** Builds the movement adapters against a transport. */
export function createTransactionsApi(client: ApiClient): TransactionsApi {
  return {
    async listTransactions(query = {}, options) {
      return parseApiData(
        await client.get(
          apiPath("/api/transactions", listQueryParams(query)),
          options,
        ),
        transactionCursorPageDtoSchema,
      );
    },

    async createTransaction(body, options) {
      return parseApiData(
        await client.post(apiPath("/api/transactions"), body, options),
        transactionDtoSchema,
      );
    },

    async getTransaction(transactionId, options) {
      return parseApiData(
        await client.get(transactionItemPath(transactionId), options),
        transactionDtoSchema,
      );
    },

    async updateTransaction(transactionId, body, options) {
      return parseApiData(
        await client.put(transactionItemPath(transactionId), body, options),
        transactionDtoSchema,
      );
    },

    async deleteTransaction(transactionId, options) {
      return client.delete(transactionItemPath(transactionId), options);
    },
  };
}
