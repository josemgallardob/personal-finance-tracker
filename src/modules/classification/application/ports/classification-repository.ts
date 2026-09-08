/**
 * Shared vocabulary of the classification repositories.
 *
 * Categories and tags are read and written through focused ports, never through
 * a generic CRUD repository: every operation names a business intent, is scoped
 * to a workspace and reports its refusals as values instead of throwing.
 */

/** Lifecycle slice a scoped list asks for. */
export type ClassificationStatus = "active" | "archived" | "all";

/**
 * Workspace every classification read and write is scoped to.
 *
 * The identifier is resolved on the server; it never travels from a client.
 */
export interface WorkspaceScope {
  readonly workspaceId: string;
}

/** Reason why a classification repository refused an operation. */
export type ClassificationRepositoryErrorCode =
  /** No category with that identifier exists inside the scoped workspace. */
  | "categoryNotFound"
  /** No tag with that identifier exists inside the scoped workspace. */
  | "tagNotFound"
  /** An active row of the same scope already uses that normalized name. */
  | "duplicateName"
  /** A row with that identifier already exists. */
  | "duplicateId"
  /** The scoped workspace does not exist. */
  | "unknownWorkspace"
  /** The row was already archived, so the operation changed nothing. */
  | "alreadyArchived"
  /** The order is not the complete, duplicate-free list of the active rows. */
  | "invalidCategoryOrder"
  /** The operation writes several rows and needs a transactional unit. */
  | "transactionRequired"
  /** A stored row does not satisfy the domain contract that wrote it. */
  | "invalidStoredRow"
  /** The storage engine failed for a reason the port does not model. */
  | "storageFailure";

/** Refusal of a classification repository operation. */
export interface ClassificationRepositoryError {
  readonly code: ClassificationRepositoryErrorCode;
  /** Technical detail kept for logs. Never carries personal data. */
  readonly cause?: string;
}

/** Outcome of a classification repository operation. */
export type ClassificationResult<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly error: ClassificationRepositoryError };

/** Accepted outcome carrying the stored representation. */
export function succeeded<TValue>(value: TValue): ClassificationResult<TValue> {
  return { ok: true, value };
}

/** Refused outcome carrying the reason and an optional technical detail. */
export function failed<TValue>(
  code: ClassificationRepositoryErrorCode,
  cause?: string,
): ClassificationResult<TValue> {
  return { ok: false, error: cause === undefined ? { code } : { code, cause } };
}
