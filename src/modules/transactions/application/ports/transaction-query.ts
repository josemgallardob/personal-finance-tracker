/**
 * Read port of a history page.
 *
 * Listing is a query, not a mutation of the movement port: it receives a
 * normalised filter contract, runs a snapshot-consistent page and returns the
 * movements of that page in the stable history order. It never encodes cursors
 * or talks to HTTP.
 */

import type { Transaction } from "../../domain/transaction";
import type { NormalizedTransactionListQuery } from "../list-transaction-filters";
import type {
  TransactionRepositoryError,
  TransactionResult,
} from "./transaction-repository";
import type { UnitOfWork } from "./unit-of-work";

export type { TransactionRepositoryError, TransactionResult };

/** Movements of one consistent page, in history order. */
export interface TransactionListPage {
  readonly items: readonly Transaction[];
  readonly hasNextPage: boolean;
}

/** Focused query contract of the history list. */
export interface TransactionQuery<TUnitOfWork extends UnitOfWork = UnitOfWork> {
  /**
   * Reads one page of the workspace that matches the normalised filters.
   *
   * The page is ordered by date, creation time and identifier descending. When
   * the unit is not already transactional the adapter opens a read snapshot so
   * the page and its associations cannot see a writer that commits in between.
   */
  listTransactions(
    unit: TUnitOfWork,
    query: NormalizedTransactionListQuery,
  ): TransactionResult<TransactionListPage>;
}
