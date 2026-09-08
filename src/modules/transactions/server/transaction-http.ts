/**
 * Transaction HTTP handlers.
 *
 * GET/POST the collection and GET/PUT/DELETE an item. Each handler is a
 * factory so tests inject the same environment, connection, clock and log sink
 * the pipeline already uses, while the route files call the factory with
 * process defaults. There is no duplication endpoint: a copy is a GET followed
 * by a POST of a new body.
 */

import "server-only";

import type { z } from "zod";

import { sqliteRecurringOccurrenceRepository } from "../../recurring/infrastructure/sqlite-recurring-occurrence-repository";
import { sqliteCategoryRepository } from "../../classification/infrastructure/sqlite-category-repository";
import { sqliteTagRepository } from "../../classification/infrastructure/sqlite-tag-repository";
import type { Clock } from "../../../shared/domain/clock";
import { domainError } from "../../../shared/domain/errors";
import {
  accepted,
  refused,
  type ApiResult,
} from "../../../shared/server/http/failure";
import { toApiFailure } from "../../../shared/server/http/domain-status";
import {
  createApiHandler,
  NO_CONTENT_STATUS,
  type ApiHandler,
  type ApiHandlerDeps,
  type ApiSuccess,
} from "../../../shared/server/http/handler";
import { createCreateTransaction } from "../application/create-transaction";
import { createDeleteTransaction } from "../application/delete-transaction";
import { createListTransactions } from "../application/list-transactions";
import { createUpdateTransaction } from "../application/update-transaction";
import { sqliteTransactionQuery } from "../infrastructure/sqlite-list-transactions-query";
import { sqliteTransactionRepository } from "../infrastructure/sqlite-transaction-repository";
import type { Transaction, TransactionId } from "../domain/transaction";
import {
  toTransactionCursorPageDto,
  toTransactionDto,
  type TransactionCursorPageDto,
  type TransactionDto,
} from "../contracts/transaction";
import {
  autocommit,
  fromDomain,
  fromTransaction,
  runDomainInTransaction,
  tagIdsFromQuery,
  transactionIdFrom,
  transactionListQuerySchema,
  transactionWriteBodySchema,
} from "./http";

type TransactionListQuery = z.infer<typeof transactionListQuerySchema>;
type TransactionWriteBody = z.infer<typeof transactionWriteBodySchema>;

/** Collaborators of the transaction handlers. Clock and identifiers are test seams. */
export interface TransactionHttpDeps extends ApiHandlerDeps {
  readonly clock?: Clock;
  readonly createId?: () => string;
}

function writeServices(deps: TransactionHttpDeps) {
  return {
    create: createCreateTransaction({
      transactions: sqliteTransactionRepository,
      categories: sqliteCategoryRepository,
      tags: sqliteTagRepository,
      clock: deps.clock,
      createId: deps.createId,
      now: deps.now,
    }),
    update: createUpdateTransaction({
      transactions: sqliteTransactionRepository,
      categories: sqliteCategoryRepository,
      tags: sqliteTagRepository,
      clock: deps.clock,
      createId: deps.createId,
      now: deps.now,
    }),
    remove: createDeleteTransaction({
      transactions: sqliteTransactionRepository,
      occurrences: sqliteRecurringOccurrenceRepository,
    }),
  };
}

function toWriteCommand(workspaceId: string, body: TransactionWriteBody) {
  return {
    workspaceId,
    type: body.type,
    amountMinor: body.amountMinor,
    date: body.date,
    categoryId: body.categoryId,
    concept: body.concept ?? null,
    note: body.note ?? null,
    tags: body.tagInputs,
  };
}

/** GET /api/transactions. */
export function createListTransactionsHandler(
  deps: TransactionHttpDeps = {},
): ApiHandler {
  return createApiHandler<
    undefined,
    TransactionListQuery,
    TransactionCursorPageDto
  >(
    {
      querySchema: transactionListQuerySchema,
      handle(context) {
        const listed = fromDomain(
          createListTransactions({
            query: sqliteTransactionQuery,
          }).execute(autocommit(context.connection), {
            workspaceId: context.workspaceId,
            dateFrom: context.query.dateFrom,
            dateTo: context.query.dateTo,
            type: context.query.type,
            categoryId: context.query.categoryId,
            tagIds: tagIdsFromQuery(context.query.tagId),
            untagged:
              context.query.untagged === undefined
                ? undefined
                : context.query.untagged === "true",
            q: context.query.q,
            cursor: context.query.cursor,
            limit: context.query.limit,
          }),
        );

        if (!listed.ok) {
          return listed;
        }

        return accepted({
          status: 200,
          data: toTransactionCursorPageDto(
            listed.value.items,
            listed.value.nextCursor,
          ),
        });
      },
    },
    deps,
  );
}

/** POST /api/transactions. */
export function createCreateTransactionHandler(
  deps: TransactionHttpDeps = {},
): ApiHandler {
  return createApiHandler<TransactionWriteBody, undefined, TransactionDto>(
    {
      bodySchema: transactionWriteBodySchema,
      handle(context) {
        const created = fromDomain(
          runDomainInTransaction(context.connection, (unit) =>
            writeServices(deps).create.execute(
              unit,
              toWriteCommand(context.workspaceId, context.body),
            ),
          ),
        );

        if (!created.ok) {
          return created;
        }

        return accepted({ status: 201, data: toTransactionDto(created.value) });
      },
    },
    deps,
  );
}

/** GET /api/transactions/[id]. */
export function createGetTransactionHandler(
  deps: TransactionHttpDeps = {},
): ApiHandler {
  return createApiHandler<undefined, undefined, TransactionDto>(
    {
      handle(context) {
        const transactionId = transactionIdFrom(context.url);

        if (!transactionId.ok) {
          return transactionId;
        }

        return mapFound(
          fromTransaction(
            sqliteTransactionRepository.findTransactionById(
              autocommit(context.connection),
              {
                workspaceId: context.workspaceId,
                transactionId: transactionId.value as TransactionId,
              },
            ),
          ),
        );
      },
    },
    deps,
  );
}

/** PUT /api/transactions/[id]. */
export function createUpdateTransactionHandler(
  deps: TransactionHttpDeps = {},
): ApiHandler {
  return createApiHandler<TransactionWriteBody, undefined, TransactionDto>(
    {
      bodySchema: transactionWriteBodySchema,
      handle(context) {
        const transactionId = transactionIdFrom(context.url);

        if (!transactionId.ok) {
          return transactionId;
        }

        const updated = fromDomain(
          runDomainInTransaction(context.connection, (unit) =>
            writeServices(deps).update.execute(unit, {
              ...toWriteCommand(context.workspaceId, context.body),
              transactionId: transactionId.value,
            }),
          ),
        );

        return mapItem(updated);
      },
    },
    deps,
  );
}

/** DELETE /api/transactions/[id]. */
export function createDeleteTransactionHandler(
  deps: TransactionHttpDeps = {},
): ApiHandler {
  return createApiHandler<undefined, undefined, null>(
    {
      handle(context) {
        const transactionId = transactionIdFrom(context.url);

        if (!transactionId.ok) {
          return transactionId;
        }

        const deleted = fromDomain(
          runDomainInTransaction(context.connection, (unit) =>
            writeServices(deps).remove.execute(unit, {
              workspaceId: context.workspaceId,
              transactionId: transactionId.value,
            }),
          ),
        );

        if (!deleted.ok) {
          return deleted;
        }

        return accepted({ status: NO_CONTENT_STATUS, data: null });
      },
    },
    deps,
  );
}

function mapItem(
  result: ApiResult<Transaction>,
): ApiResult<ApiSuccess<TransactionDto>> {
  if (!result.ok) {
    return result;
  }

  return accepted({ status: 200, data: toTransactionDto(result.value) });
}

function mapFound(
  result: ApiResult<Transaction | null>,
): ApiResult<ApiSuccess<TransactionDto>> {
  if (!result.ok) {
    return result;
  }

  if (result.value === null) {
    return refused(toApiFailure([domainError("id", "notFound")]));
  }

  return accepted({ status: 200, data: toTransactionDto(result.value) });
}
