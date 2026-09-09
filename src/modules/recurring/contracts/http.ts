/**
 * Public HTTP schemas of monthly recurrence rules.
 *
 * The server owns today's civil date. Clients submit only the monthly ordinal
 * and template values; workspace identifiers and arbitrary preview dates are
 * deliberately absent from the public contract.
 */

import { z } from "zod";

import {
  tagInputSchema,
  transactionTypeSchema,
} from "../../transactions/contracts/http";

/** Body used to make an existing movement recur every month. */
export const activateRecurringRuleBodySchema = z.strictObject({
  transactionId: z.string(),
  monthlyDay: z.number(),
});

/** Body used to preview the first due date before creating a rule. */
export const previewNextDueDateBodySchema = z.strictObject({
  monthlyDay: z.number(),
});

/** Complete replacement of an active recurring template. */
export const recurringRuleWriteBodySchema = z.strictObject({
  templateVersion: z.number(),
  type: transactionTypeSchema,
  amountMinor: z.number(),
  categoryId: z.string(),
  concept: z.union([z.string(), z.null()]).optional(),
  note: z.union([z.string(), z.null()]).optional(),
  tagInputs: z.array(tagInputSchema).optional(),
  monthlyDay: z.number(),
});

/** Body used to deactivate one active rule. */
export const deactivateRecurringRuleBodySchema = z.strictObject({
  templateVersion: z.number(),
});

/** Active recurrence rule as the API returns it. */
export const recurringRuleDtoSchema = z.strictObject({
  id: z.string(),
  sourceTransactionId: z.string().nullable(),
  type: transactionTypeSchema,
  amountMinor: z.number(),
  categoryId: z.string(),
  concept: z.string().nullable(),
  note: z.string().nullable(),
  tagIds: z.array(z.string()),
  monthlyDay: z.number(),
  nextDueDate: z.string(),
  templateVersion: z.number(),
});

/** Rules grouped by transaction type for the Recurrentes tab. */
export const recurringRulesListDtoSchema = z.strictObject({
  expenses: z.array(recurringRuleDtoSchema),
  incomes: z.array(recurringRuleDtoSchema),
});

export type ActivateRecurringRuleBody = z.infer<
  typeof activateRecurringRuleBodySchema
>;
export type PreviewNextDueDateBody = z.infer<
  typeof previewNextDueDateBodySchema
>;
export type RecurringRuleWriteBody = z.infer<
  typeof recurringRuleWriteBodySchema
>;
export type DeactivateRecurringRuleBody = z.infer<
  typeof deactivateRecurringRuleBodySchema
>;
