/**
 * Paginated history of movements.
 *
 * The use case validates filters and the opaque cursor, then asks storage for
 * one snapshot-consistent page. It never exposes SQL or HTTP: the result is
 * the domain movements of that page and the cursor that continues the same
 * normalised filters. A changed filter set must start from the first page.
 */

import {
  type DomainError,
  type DomainResult,
  domainError,
  invalid,
  valid,
} from "../../../shared/domain/errors";
import type { Transaction } from "../domain/transaction";
import {
  encodeListCursor,
  parseListTransactionsInput,
  type ListTransactionsInput,
} from "./list-transaction-filters";
import type {
  TransactionQuery,
  TransactionListPage,
} from "./ports/transaction-query";
import type { TransactionRepositoryError } from "./ports/transaction-repository";
import type { UnitOfWork } from "./ports/unit-of-work";

/** Workspace-scoped history page request. */
export type ListTransactionsQuery = ListTransactionsInput;

/** One page of the history and the cursor that continues it, if any. */
export interface ListTransactionsPage {
  readonly items: readonly Transaction[];
  readonly nextCursor: string | null;
}

/** Collaborators of the use case. */
export interface ListTransactionsDeps<TUnit extends UnitOfWork> {
  readonly query: TransactionQuery<TUnit>;
}

/** List use case bound to one query port. */
export interface ListTransactions<TUnit extends UnitOfWork> {
  execute(
    unit: TUnit,
    query: ListTransactionsQuery,
  ): DomainResult<ListTransactionsPage>;
}

/** Builds the use case. */
export function createListTransactions<TUnit extends UnitOfWork>(
  deps: ListTransactionsDeps<TUnit>,
): ListTransactions<TUnit> {
  return {
    execute(unit, query) {
      return executeListTransactions(unit, query, deps.query);
    },
  };
}

function executeListTransactions<TUnit extends UnitOfWork>(
  unit: TUnit,
  query: ListTransactionsQuery,
  transactions: TransactionQuery<TUnit>,
): DomainResult<ListTransactionsPage> {
  const parsed = parseListTransactionsInput(query);

  if (!parsed.ok) {
    return parsed;
  }

  const page = transactions.listTransactions(unit, parsed.value);

  if (!page.ok) {
    return invalid([toDomainError(page.error)]);
  }

  return valid(toListPage(page.value, parsed.value.fingerprint));
}

function toListPage(
  page: TransactionListPage,
  fingerprint: string,
): ListTransactionsPage {
  const last = page.items[page.items.length - 1];

  return {
    items: page.items,
    nextCursor:
      page.hasNextPage && last !== undefined
        ? encodeListCursor(
            {
              date: last.date,
              createdAt: last.createdAt,
              id: last.id,
            },
            fingerprint,
          )
        : null,
  };
}

function toDomainError(error: TransactionRepositoryError): DomainError {
  switch (error.code) {
    case "duplicateId":
      return domainError("id", "invalidIdentifier");
    case "transactionNotFound":
      return domainError("id", "notFound");
    case "unknownCategory":
      return domainError("categoryId", "notFound");
    case "unknownTag":
      return domainError("tagId", "notFound");
    case "unknownWorkspace":
      return domainError("workspaceId", "notFound");
    case "transactionRequired":
    case "invalidStoredRow":
    case "storageFailure":
      return domainError("storage", "unavailable");
  }
}
