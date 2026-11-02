/**
 * Client-side transaction form values and Zod validation.
 *
 * Amounts stay as Spanish text until submit. Tags stay as picker selections
 * and become {@link TagInput} values only when the form is valid. Nothing here
 * talks to HTTP.
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
  compareLocalDates,
  type LocalDate,
  parseLocalDate,
} from "../../../shared/domain/dates";
import {
  parseTransactionAmountText,
  type MoneyErrorCode,
} from "../../../shared/domain/money";
import {
  characterLength,
  containsControlCharacters,
  nameKey,
  normalizeFreeText,
  normalizeName,
} from "../../../shared/domain/text";
import type { TagInput, TransactionCreateBody } from "../contracts/http";
import {
  MAX_CONCEPT_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_TAGS_PER_TRANSACTION,
} from "../domain/transaction";
import {
  TRANSACTION_TYPES,
  type TransactionType,
} from "../domain/transaction-type";
import { MAX_TAG_NAME_LENGTH } from "../../classification/domain/tag";

export const transactionFormCopy = {
  amountHint: "Usa coma decimal, por ejemplo 12,50",
  amountInvalid: "Introduce un importe válido, por ejemplo 12,50",
  amountRequired: "El importe es obligatorio",
  amountTooLarge: "El importe no puede superar 999.999.999,99 €",
  amountTooSmall: "El importe debe ser al menos 0,01 €",
  cancel: "Cancelar",
  categoryIncompatible: "Elige una categoría compatible con el tipo",
  categoryLabel: "Categoría",
  categoryPlaceholder: "Elige una categoría",
  categoryRequired: "La categoría es obligatoria",
  conceptLabel: "Concepto",
  conceptHint: "Opcional",
  conceptInvalid: "El concepto contiene caracteres no válidos",
  conceptTooLong: "El concepto no puede superar 200 caracteres",
  dateFuture: "La fecha no puede ser posterior a hoy",
  dateInvalid: "Introduce una fecha válida",
  dateLabel: "Fecha",
  dateRequired: "La fecha es obligatoria",
  expense: "Gasto",
  income: "Ingreso",
  noteHint: "Opcional",
  noteInvalid: "La nota contiene caracteres no válidos",
  noteLabel: "Nota",
  noteTooLong: "La nota no puede superar 2.000 caracteres",
  submitExpense: "Añadir gasto",
  submitIncome: "Añadir ingreso",
  saveAndAddAnother: "Guardar y añadir otro",
  requiredFields: "Campos obligatorios",
  tagsDuplicate: "Esa etiqueta ya está en el movimiento",
  tagsTooMany: "Un movimiento admite como máximo 20 etiquetas",
  tagInvalid: "Introduce un nombre de etiqueta válido",
  typeLabel: "Tipo",
  typeRequired: "Elige gasto o ingreso",
} as const;

export interface TransactionFormValues {
  readonly type: TransactionType;
  readonly amountText: string;
  readonly date: string;
  readonly categoryId: string;
  readonly concept: string;
  readonly note: string;
  readonly tagSelections: TagSelection[];
  readonly recurrenceEnabled: boolean;
  readonly monthlyDay: number;
}

export interface TransactionFormContext {
  readonly categories: readonly CategoryDto[];
  readonly retainedCategoryId?: string;
  readonly retainedTagIds?: readonly string[];
  readonly tags: readonly TagDto[];
  readonly today: LocalDate | string;
}

export function compatibleCategories(
  categories: readonly CategoryDto[],
  type: TransactionType,
  retainedCategoryId?: string,
): CategoryDto[] {
  return categories.filter(
    (category) =>
      category.type === type &&
      (!category.isArchived || category.id === retainedCategoryId),
  );
}

export function isCategoryAssignable(
  categories: readonly CategoryDto[],
  type: TransactionType,
  categoryId: string,
  retainedCategoryId?: string,
): boolean {
  return compatibleCategories(categories, type, retainedCategoryId).some(
    (category) => category.id === categoryId,
  );
}

export function defaultTransactionFormValues(
  today: string,
  initial?: Partial<TransactionFormValues>,
): TransactionFormValues {
  return {
    type: initial?.type ?? "expense",
    amountText: initial?.amountText ?? "",
    date: initial?.date ?? today,
    categoryId: initial?.categoryId ?? "",
    concept: initial?.concept ?? "",
    note: initial?.note ?? "",
    tagSelections: initial?.tagSelections ? [...initial.tagSelections] : [],
    recurrenceEnabled: initial?.recurrenceEnabled ?? false,
    monthlyDay: initial?.monthlyDay ?? Number(today.slice(-2)),
  };
}

export function formatLocalDateAsSpanish(date: string): string {
  const parsed = parseLocalDate(date);

  if (!parsed.ok) {
    return date;
  }

  const [year, month, day] = parsed.value.split("-");
  return `${day}/${month}/${year}`;
}

/** Spanish message of a rejected amount, shared with the recurrence form. */
export function moneyMessage(error: MoneyErrorCode): string {
  switch (error) {
    case "belowMinimum":
      return transactionFormCopy.amountTooSmall;
    case "aboveMaximum":
    case "overflow":
      return transactionFormCopy.amountTooLarge;
    default:
      return transactionFormCopy.amountInvalid;
  }
}

/** Message of an optional free-text field that is too long or malformed. */
export function optionalTextIssue(
  raw: string,
  maxLength: number,
  allowLineBreaks: boolean,
  tooLong: string,
  invalid: string,
): string | undefined {
  const text = normalizeFreeText(raw, allowLineBreaks);

  if (text === "") {
    return undefined;
  }

  if (characterLength(text) > maxLength) {
    return tooLong;
  }

  if (containsControlCharacters(text, allowLineBreaks)) {
    return invalid;
  }

  return undefined;
}

/** Optional free text as the API stores it: normalised, or `null` when empty. */
export function optionalWriteText(
  raw: string,
  allowLineBreaks: boolean,
): string | null {
  const text = normalizeFreeText(raw, allowLineBreaks);
  return text === "" ? null : text;
}

export function toTransactionWriteBody(
  values: TransactionFormValues,
): TransactionCreateBody {
  const amount = parseTransactionAmountText(values.amountText);

  if (!amount.ok) {
    throw new Error(`Validated amount was rejected: ${amount.error}`);
  }

  const tagInputs: TagInput[] = toTagInputs(values.tagSelections);

  return {
    type: values.type,
    amountMinor: amount.value,
    date: values.date,
    categoryId: values.categoryId,
    concept: optionalWriteText(values.concept, false),
    note: optionalWriteText(values.note, true),
    tagInputs,
    ...(values.recurrenceEnabled
      ? { recurrence: { monthlyDay: values.monthlyDay } }
      : {}),
  };
}

const tagSelectionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("existing"),
    tagId: z.string(),
    name: z.string(),
  }),
  z.object({
    kind: z.literal("pending"),
    name: z.string(),
  }),
]);

export function createTransactionFormSchema(context: TransactionFormContext) {
  const today = parseLocalDate(context.today);
  const retainedTagIds = context.retainedTagIds ?? [];

  return z
    .object({
      type: z.enum(TRANSACTION_TYPES, {
        error: transactionFormCopy.typeRequired,
      }),
      amountText: z.string(),
      date: z.string(),
      categoryId: z.string(),
      concept: z.string(),
      note: z.string(),
      tagSelections: z.array(tagSelectionSchema),
      recurrenceEnabled: z.boolean(),
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

      if (values.date.trim() === "") {
        ctx.addIssue({
          code: "custom",
          path: ["date"],
          message: transactionFormCopy.dateRequired,
        });
      } else {
        const date = parseLocalDate(values.date);
        if (!date.ok) {
          ctx.addIssue({
            code: "custom",
            path: ["date"],
            message: transactionFormCopy.dateInvalid,
          });
        } else if (today.ok && compareLocalDates(date.value, today.value) > 0) {
          ctx.addIssue({
            code: "custom",
            path: ["date"],
            message: transactionFormCopy.dateFuture,
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
        ctx.addIssue({
          code: "custom",
          path: ["note"],
          message: noteIssue,
        });
      }

      if (values.tagSelections.length > MAX_TAGS_PER_TRANSACTION) {
        ctx.addIssue({
          code: "custom",
          path: ["tagSelections"],
          message: transactionFormCopy.tagsTooMany,
        });
      }

      if (
        values.recurrenceEnabled &&
        (!Number.isInteger(values.monthlyDay) ||
          values.monthlyDay < 1 ||
          values.monthlyDay > 31)
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["monthlyDay"],
          message: "Elige un día entre 1 y 31.",
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
