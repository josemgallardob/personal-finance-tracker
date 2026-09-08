/**
 * Transaction port.
 *
 * The port exposes exactly the operations the movement stories need: the two
 * scoped reads the history and the edit form depend on, and the three
 * mutations of the MVP. It is not a generic CRUD repository: every operation
 * names a business intent, is scoped to a workspace, shares the caller-owned
 * unit of work and reports its refusals as values instead of throwing.
 *
 * A movement is always read together with its tag associations. The port
 * promises a constant number of statements per read, so loading many movements
 * never issues one association query per movement. The schema stores the tags
 * of a movement as an unordered set, so every read returns them ordered by tag
 * identifier instead of pretending to remember the order the caller wrote.
 */

import type { Transaction, TransactionId } from "../../domain/transaction";
import type { UnitOfWork } from "./unit-of-work";

/**
 * Workspace every transaction read and write is scoped to.
 *
 * The identifier is resolved on the server; it never travels from a client.
 */
export interface WorkspaceScope {
  readonly workspaceId: string;
}

/** Lookup of a single movement by identifier. */
export interface TransactionByIdQuery extends WorkspaceScope {
  readonly transactionId: TransactionId;
}

/** Lookup of several movements by identifier, with their associations. */
export interface TransactionsByIdsQuery extends WorkspaceScope {
  readonly transactionIds: readonly TransactionId[];
}

/** Insertion of a movement the domain already validated, with its tags. */
export interface InsertTransactionCommand extends WorkspaceScope {
  readonly transaction: Transaction;
}

/**
 * Replacement of a stored movement with the version the domain validated.
 *
 * The identifier selects the row and the tag set replaces the stored one. The
 * creation timestamp of the stored row is never rewritten: an edit only moves
 * `updatedAt` forward.
 */
export interface UpdateTransactionCommand extends WorkspaceScope {
  readonly transaction: Transaction;
}

/** Deletion of a movement and of its tag associations. */
export interface DeleteTransactionCommand extends WorkspaceScope {
  readonly transactionId: TransactionId;
}

/** Reason why a transaction repository refused an operation. */
export type TransactionRepositoryErrorCode =
  /** No movement with that identifier exists inside the scoped workspace. */
  | "transactionNotFound"
  /** A movement with that identifier already exists. */
  | "duplicateId"
  /** The scoped workspace does not exist. */
  | "unknownWorkspace"
  /** The workspace has no category with that identifier and type. */
  | "unknownCategory"
  /** The workspace has no tag with one of those identifiers. */
  | "unknownTag"
  /** The operation writes several rows and needs a transactional unit. */
  | "transactionRequired"
  /** A stored row does not satisfy the domain contract that wrote it. */
  | "invalidStoredRow"
  /** The storage engine failed for a reason the port does not model. */
  | "storageFailure";

/** Refusal of a transaction repository operation. */
export interface TransactionRepositoryError {
  readonly code: TransactionRepositoryErrorCode;
  /** Technical detail kept for logs. Never carries personal data. */
  readonly cause?: string;
}

/** Outcome of a transaction repository operation. */
export type TransactionResult<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly error: TransactionRepositoryError };

/** Accepted outcome carrying the stored representation. */
export function succeeded<TValue>(value: TValue): TransactionResult<TValue> {
  return { ok: true, value };
}

/** Refused outcome carrying the reason and an optional technical detail. */
export function failed<TValue>(
  code: TransactionRepositoryErrorCode,
  cause?: string,
): TransactionResult<TValue> {
  return { ok: false, error: cause === undefined ? { code } : { code, cause } };
}

/** Focused storage contract of movements. */
export interface TransactionRepository<
  TUnitOfWork extends UnitOfWork = UnitOfWork,
> {
  /**
   * Reads one movement of the workspace with its tags, or `null` when the
   * workspace has no movement with that identifier. A movement of another
   * workspace is invisible here; it is not an error, it simply does not exist
   * for this scope.
   */
  findTransactionById(
    unit: TUnitOfWork,
    query: TransactionByIdQuery,
  ): TransactionResult<Transaction | null>;

  /**
   * Reads several movements of the workspace with their tags, using a constant
   * number of statements. Identifiers the workspace does not own are skipped,
   * and the result is ordered by date, creation time and identifier
   * descending, which is the stable order the history reads in.
   */
  findTransactionsByIds(
    unit: TUnitOfWork,
    query: TransactionsByIdsQuery,
  ): TransactionResult<readonly Transaction[]>;

  /**
   * Inserts a movement and its tag associations, and returns the stored
   * movement. It writes more than one row, so it requires a transactional unit
   * and never leaves a movement without the tags it was saved with.
   */
  insertTransaction(
    unit: TUnitOfWork,
    command: InsertTransactionCommand,
  ): TransactionResult<Transaction>;

  /**
   * Replaces a stored movement and its tag set, and returns the stored
   * movement. It writes more than one row, so it requires a transactional
   * unit.
   */
  updateTransaction(
    unit: TUnitOfWork,
    command: UpdateTransactionCommand,
  ): TransactionResult<Transaction>;

  /**
   * Deletes a movement of the workspace. The schema cascades its tag
   * associations in the same statement, and the categories and tags it used
   * survive the deletion.
   */
  deleteTransaction(
    unit: TUnitOfWork,
    command: DeleteTransactionCommand,
  ): TransactionResult<TransactionId>;
}
