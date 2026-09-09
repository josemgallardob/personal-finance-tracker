/**
 * Public HTTP schemas of movements.
 *
 * Request and response shapes live here so the browser client and the route
 * handlers validate the same contract. The module has no SQLite or
 * application-service imports.
 */

import { z } from "zod";

import { TRANSACTION_TYPES } from "../domain/transaction-type";

/** Type of a movement, as the wire contract names it. */
export const transactionTypeSchema = z.enum(TRANSACTION_TYPES);

/** One tag chosen from a form: an existing identifier or a name to create. */
export const tagInputSchema = z.union([
  z.strictObject({ tagId: z.string() }),
  z.strictObject({ name: z.string() }),
]);

/** Optional monthly rule created atomically with a new movement. */
export const createTransactionRecurrenceSchema = z.strictObject({
  monthlyDay: z.number(),
});

/** Body of POST /api/transactions and PUT /api/transactions/[id]. */
export const transactionWriteBodySchema = z.strictObject({
  type: transactionTypeSchema,
  amountMinor: z.number(),
  date: z.string(),
  categoryId: z.string(),
  concept: z.union([z.string(), z.null()]).optional(),
  note: z.union([z.string(), z.null()]).optional(),
  tagInputs: z.array(tagInputSchema).optional(),
});

/** Body of POST /api/transactions, with an optional atomic monthly rule. */
export const transactionCreateBodySchema = transactionWriteBodySchema.extend({
  recurrence: createTransactionRecurrenceSchema.optional(),
});

/**
 * Query of GET /api/transactions.
 *
 * `tagId` may repeat; every other filter must appear at most once. `untagged`
 * is mutually exclusive with `tagId` once the domain sees both.
 */
export const transactionListQuerySchema = z.strictObject({
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  type: transactionTypeSchema.optional(),
  categoryId: z.string().optional(),
  tagId: z.union([z.string(), z.array(z.string())]).optional(),
  untagged: z.enum(["true", "false"]).optional(),
  q: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().optional(),
});

/** Transaction as the API returns it. */
export const transactionDtoSchema = z.strictObject({
  id: z.string(),
  type: transactionTypeSchema,
  amountMinor: z.number(),
  date: z.string(),
  categoryId: z.string(),
  concept: z.string().nullable(),
  note: z.string().nullable(),
  tagIds: z.array(z.string()),
  recurringRuleId: z.string().nullable().optional(),
  scheduledFor: z.string().nullable().optional(),
  recurrence: z
    .strictObject({ ruleId: z.string(), nextDueDate: z.string() })
    .optional(),
});

/**
 * One page of the history.
 *
 * `nextCursor` is an opaque continuation token bound to the filters that
 * produced the page.
 */
export const transactionCursorPageDtoSchema = z.strictObject({
  items: z.array(transactionDtoSchema),
  nextCursor: z.string().nullable(),
});

export type TagInput = z.infer<typeof tagInputSchema>;
export type TransactionWriteBody = z.infer<typeof transactionWriteBodySchema>;
export type TransactionCreateBody = z.infer<typeof transactionCreateBodySchema>;
export type TransactionListQueryDto = z.infer<
  typeof transactionListQuerySchema
>;

/**
 * History filters as a client adapter accepts them.
 *
 * `untagged` is a boolean here; the encoder writes the `true`/`false` strings
 * the query schema expects. `tagId` may be one identifier or several, which
 * become repeated `tagId` parameters.
 */
export interface TransactionListQuery {
  readonly dateFrom?: string;
  readonly dateTo?: string;
  readonly type?: (typeof TRANSACTION_TYPES)[number];
  readonly categoryId?: string;
  readonly tagId?: string | readonly string[];
  readonly untagged?: boolean;
  readonly q?: string;
  readonly cursor?: string;
  readonly limit?: number;
}
