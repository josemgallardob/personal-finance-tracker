/**
 * Client-side values and validation of the recurrence template form.
 *
 * A template has no date: it has a monthly ordinal that the server turns into
 * the next strictly future due date. Everything else follows the same rules as
 * a movement, so the amount, free text and tag validation are shared with the
 * movement form instead of being restated with different messages.
 *
 * The category and the tags the template already uses stay selectable even
 * when they are archived: an owner who opens the dialog to move away from an
 * archived classification must still see what the template currently points
 * at, and refusing to render it would make that change impossible.
 */

import { z } from "zod";

import type { CategoryDto } from "../../classification/contracts/category";
import type { TagDto } from "../../classification/contracts/tag";
import {
  type TagSelection,
  isAssignableTag,
  toTagInputs,
} from "../../classification/ui/tag-picker";
import {
  formatMoneyMinorAsAmountText,
  parseTransactionAmountText,
  type MoneyMinor,
} from "../../../shared/domain/money";
import {
  characterLength,
  containsControlCharacters,
  nameKey,
  normalizeName,
} from "../../../shared/domain/text";
import { MAX_TAG_NAME_LENGTH } from "../../classification/domain/tag";
import {
  MAX_CONCEPT_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_TAGS_PER_TRANSACTION,
} from "../../transactions/domain/transaction";
import {
  TRANSACTION_TYPES,
  type TransactionType,
} from "../../transactions/domain/transaction-type";
import {
  isCategoryAssignable,
  moneyMessage,
  optionalTextIssue,
  optionalWriteText,
  transactionFormCopy,
} from "../../transactions/ui/transaction-form-schema";
import type { RecurringRuleWriteBody } from "../contracts/http";
import type { RecurringRuleDto } from "../contracts/recurring";

/** Lowest monthly ordinal a rule accepts. */
export const MIN_MONTHLY_DAY = 1;

/** Highest monthly ordinal a rule accepts; shorter months use their last day. */
export const MAX_MONTHLY_DAY = 31;

export const recurringFormCopy = {
  monthlyDayInvalid: "Elige un día entre 1 y 31",
} as const;

export interface RecurringRuleFormValues {
  readonly type: TransactionType;
  readonly amountText: string;
  readonly categoryId: string;
  readonly concept: string;
  readonly note: string;
  readonly tagSelections: TagSelection[];
  readonly monthlyDay: number;
}

export interface RecurringRuleFormContext {
  readonly categories: readonly CategoryDto[];
  readonly retainedCategoryId?: string;
  readonly retainedTagIds?: readonly string[];
  readonly tags: readonly TagDto[];
}

/** Form values that show the template exactly as the server stores it. */
export function recurringRuleToFormValues(
  rule: RecurringRuleDto,
  tags: readonly TagDto[],
): RecurringRuleFormValues {
  const namesById = new Map(tags.map((tag) => [tag.id, tag.name]));

  return {
    type: rule.type,
    amountText: formatMoneyMinorAsAmountText(rule.amountMinor as MoneyMinor),
    categoryId: rule.categoryId,
    concept: rule.concept ?? "",
    note: rule.note ?? "",
    tagSelections: rule.tagIds.map((tagId) => ({
      kind: "existing",
      tagId,
      name: namesById.get(tagId) ?? tagId,
    })),
    monthlyDay: rule.monthlyDay,
  };
}

/** Whether the monthly ordinal is one the recurrence contract accepts. */
export function isValidMonthlyDay(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value >= MIN_MONTHLY_DAY &&
    value <= MAX_MONTHLY_DAY
  );
}

/** Complete replacement body of a template, built from validated values. */
export function toRecurringRuleWriteBody(
  values: RecurringRuleFormValues,
  templateVersion: number,
): RecurringRuleWriteBody {
  const amount = parseTransactionAmountText(values.amountText);

  if (!amount.ok) {
    throw new Error(`Validated amount was rejected: ${amount.error}`);
  }

  return {
    templateVersion,
    type: values.type,
    amountMinor: amount.value,
    categoryId: values.categoryId,
    concept: optionalWriteText(values.concept, false),
    note: optionalWriteText(values.note, true),
    tagInputs: toTagInputs(values.tagSelections),
    monthlyDay: values.monthlyDay,
  };
}

const tagSelectionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("existing"),
    tagId: z.string(),
    name: z.string(),
  }),
  z.object({ kind: z.literal("pending"), name: z.string() }),
]);

export function createRecurringRuleFormSchema(
  context: RecurringRuleFormContext,
) {
  const retainedTagIds = context.retainedTagIds ?? [];

  return z
    .object({
      type: z.enum(TRANSACTION_TYPES, {
        error: transactionFormCopy.typeRequired,
      }),
      amountText: z.string(),
      categoryId: z.string(),
      concept: z.string(),
      note: z.string(),
      tagSelections: z.array(tagSelectionSchema),
      monthlyDay: z.number(),
    })
    .superRefine((values, ctx) => {
      if (values.amountText.trim() === "") {
        ctx.addIssue({
          code: "custom",
          path: ["amountText"],
          message: transactionFormCopy.amountRequired,
        });
      } else {
        const amount = parseTransactionAmountText(values.amountText);
        if (!amount.ok) {
          ctx.addIssue({
            code: "custom",
            path: ["amountText"],
            message: moneyMessage(amount.error),
          });
        }
      }

      if (values.categoryId.trim() === "") {
        ctx.addIssue({
          code: "custom",
          path: ["categoryId"],
          message: transactionFormCopy.categoryRequired,
        });
      } else if (
        !isCategoryAssignable(
          context.categories,
          values.type,
          values.categoryId,
          context.retainedCategoryId,
        )
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["categoryId"],
          message: transactionFormCopy.categoryIncompatible,
        });
      }

      const conceptIssue = optionalTextIssue(
        values.concept,
        MAX_CONCEPT_LENGTH,
        false,
        transactionFormCopy.conceptTooLong,
        transactionFormCopy.conceptInvalid,
      );
      if (conceptIssue) {
        ctx.addIssue({
          code: "custom",
          path: ["concept"],
          message: conceptIssue,
        });
      }

      const noteIssue = optionalTextIssue(
        values.note,
        MAX_NOTE_LENGTH,
        true,
        transactionFormCopy.noteTooLong,
        transactionFormCopy.noteInvalid,
      );
      if (noteIssue) {
        ctx.addIssue({ code: "custom", path: ["note"], message: noteIssue });
      }

      if (!isValidMonthlyDay(values.monthlyDay)) {
        ctx.addIssue({
          code: "custom",
          path: ["monthlyDay"],
          message: recurringFormCopy.monthlyDayInvalid,
        });
      }

      if (values.tagSelections.length > MAX_TAGS_PER_TRANSACTION) {
        ctx.addIssue({
          code: "custom",
          path: ["tagSelections"],
          message: transactionFormCopy.tagsTooMany,
        });
      }

      const seen = new Set<string>();
      values.tagSelections.forEach((selection, index) => {
        if (selection.kind === "existing") {
          const tag = context.tags.find((item) => item.id === selection.tagId);
          if (!tag || !isAssignableTag(tag, retainedTagIds)) {
            ctx.addIssue({
              code: "custom",
              path: ["tagSelections", index],
              message: transactionFormCopy.tagInvalid,
            });
          }
        } else {
          const name = normalizeName(selection.name);
          if (
            name === "" ||
            characterLength(name) > MAX_TAG_NAME_LENGTH ||
            containsControlCharacters(name, false)
          ) {
            ctx.addIssue({
              code: "custom",
              path: ["tagSelections", index],
              message: transactionFormCopy.tagInvalid,
            });
          }
        }

        const key =
          selection.kind === "existing"
            ? `id:${selection.tagId}`
            : `name:${nameKey(selection.name)}`;
        if (seen.has(key)) {
          ctx.addIssue({
            code: "custom",
            path: ["tagSelections", index],
            message: transactionFormCopy.tagsDuplicate,
          });
        }
        seen.add(key);
      });
    });
}
