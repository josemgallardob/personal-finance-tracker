/**
 * Shared composition of transaction HTTP endpoints.
 *
 * Route handlers resolve the workspace through the API pipeline, then talk to
 * the real SQLite ports. This module owns the mapping a repository refusal
 * becomes, the transactional boundary a save needs, and the identifier the
 * dynamic path carries. It never accepts a workspace from the request and
 * never exposes a duplication endpoint: a copy is GET of one movement followed
 * by POST of a new body.
 */

import "server-only";

import type { DomainError, DomainResult } from "../../../shared/domain/errors";
import { domainError, invalid } from "../../../shared/domain/errors";
import type { SqliteConnection } from "../../../shared/server/database";
import {
  accepted,
  apiFailure,
  refused,
  type ApiResult,
} from "../../../shared/server/http/failure";
import { toApiFailure } from "../../../shared/server/http/domain-status";
import type {
  TransactionRepositoryError,
  TransactionResult,
} from "../application/ports/transaction-repository";
import {
  autocommitUnitOfWork,
  type SqliteUnitOfWork,
} from "../infrastructure/sqlite-unit-of-work";

export {
  tagInputSchema,
  transactionCreateBodySchema,
  transactionListQuerySchema,
  transactionWriteBodySchema,
} from "../contracts/http";

/** Thrown to make SQLite roll back a domain refusal inside a transaction. */
const ROLLBACK_SIGNAL = new Error("Transaction HTTP work was rolled back");

/** Unit that commits each statement on its own. */
export function autocommit(connection: SqliteConnection): SqliteUnitOfWork {
  return autocommitUnitOfWork(connection);
}

/**
 * Runs domain work inside one SQL transaction the HTTP adapter owns.
 *
 * A save writes the movement and any tags created for it. The transaction
 * commits only when the work reports success, so a refused save never leaves
 * a partial movement behind.
 */
export function runDomainInTransaction<TValue>(
  connection: SqliteConnection,
  work: (unit: SqliteUnitOfWork) => DomainResult<TValue>,
): DomainResult<TValue> {
  let refusal: DomainResult<TValue> | undefined;

  try {
    return connection.db.transaction((tx) => {
      const result = work({ isTransactional: true, db: tx });

      if (!result.ok) {
        refusal = result;
        throw ROLLBACK_SIGNAL;
      }

      return result;
    });
  } catch {
    if (refusal) {
      return refusal;
    }

    return invalid([domainError("storage", "unavailable")]);
  }
}

/** Turns a domain outcome into the pipeline's accepted or refused value. */
export function fromDomain<TValue>(
  result: DomainResult<TValue>,
): ApiResult<TValue> {
  if (result.ok) {
    return accepted(result.value);
  }

  return refused(toApiFailure(result.errors));
}

/** Turns a repository outcome into the pipeline's accepted or refused value. */
export function fromTransaction<TValue>(
  result: TransactionResult<TValue>,
): ApiResult<TValue> {
  if (result.ok) {
    return accepted(result.value);
  }

  return refused(toApiFailure([toDomainError(result.error)]));
}

/**
 * Turns a repository refusal into the field error HTTP already knows how to
 * map. A missing movement is not found; a missing category or tag stays a
 * field 404; storage failures stay unnamed 503s.
 */
export function toDomainError(error: TransactionRepositoryError): DomainError {
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

/** Identifier of a movement item path, or a 404 when it is absent. */
export function transactionIdFrom(url: URL): ApiResult<string> {
  const segments = url.pathname.split("/").filter((segment) => segment !== "");

  if (segments[0] !== "api" || segments[1] !== "transactions") {
    return refused(apiFailure("notFound"));
  }

  const id = segments[2];

  if (id === undefined || segments.length !== 3) {
    return refused(apiFailure("notFound"));
  }

  return accepted(decodeURIComponent(id));
}

/** Normalises a single or repeated `tagId` query into the list filter. */
export function tagIdsFromQuery(
  tagId: string | readonly string[] | undefined,
): readonly string[] | undefined {
  if (tagId === undefined) {
    return undefined;
  }

  return typeof tagId === "string" ? [tagId] : tagId;
}
