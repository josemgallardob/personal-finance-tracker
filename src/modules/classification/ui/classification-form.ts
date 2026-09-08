/**
 * Shared create/rename validation for categories and tags.
 *
 * The dialogs reuse the same name rules the domain already applies: trim,
 * Unicode NFC, collapsed spaces, grapheme length and uniqueness on the
 * lowercase comparison key. Client checks catch those mistakes before a
 * request; a 409 from the server is mapped onto the same field so a race
 * with another window still reads as a name conflict rather than a generic
 * failure.
 */

import { z } from "zod";

import type { ApiClientFailure } from "../../../shared/client/api-client";
import type {
  ApiFieldErrorCode,
  ApiFieldErrorDto,
} from "../../../shared/contracts/api";
import {
  characterLength,
  containsControlCharacters,
  nameKey,
  normalizeName,
} from "../../../shared/domain/text";
import type { FormError } from "../../../shared/ui/error-summary";
import { TRANSACTION_TYPES } from "../../transactions/domain/transaction-type";
import { MAX_CATEGORY_NAME_LENGTH } from "../domain/category";
import { MAX_TAG_NAME_LENGTH } from "../domain/tag";
import {
  classificationFailureCopy,
  classificationFailureMessage,
} from "./classification-copy";

/** Catalog row the uniqueness check needs. */
export interface ClassificationNameItem {
  readonly id: string;
  readonly name: string;
  readonly isArchived: boolean;
}

/** Spanish field and dialog copy of the classification forms. */
export const classificationFormCopy = {
  cancel: "Cancelar",
  save: "Guardar",
  saving: "Guardando…",
  nameLabel: "Nombre",
  nameHint: "Hasta 80 caracteres. Mayúsculas y tildes se conservan.",
  typeLabel: "Tipo",
  typeHint: "El tipo queda fijado al crear la categoría y no se puede cambiar.",
  expense: "Gasto",
  income: "Ingreso",
  typeImmutableExpense:
    "Esta categoría es de gasto. El tipo no se puede cambiar.",
  typeImmutableIncome:
    "Esta categoría es de ingreso. El tipo no se puede cambiar.",
  createCategoryTitle: "Nueva categoría",
  createCategoryDescription:
    "Elige un nombre y si clasifica gastos o ingresos. El tipo no se podrá cambiar después.",
  renameCategoryTitle: "Renombrar categoría",
  renameCategoryDescription:
    "El nuevo nombre se aplica a todo el histórico. El tipo de la categoría no cambia.",
  createTagTitle: "Nueva etiqueta",
  createTagDescription:
    "El nombre se compara sin distinguir mayúsculas. Las tildes sí marcan la diferencia.",
  renameTagTitle: "Renombrar etiqueta",
  renameTagDescription:
    "El nuevo nombre se aplica a todo el histórico y sigue siendo único.",
  nameRequired: "Introduce un nombre.",
  nameTooLong: "El nombre no puede superar 80 caracteres.",
  nameInvalidCharacter: "El nombre no puede contener caracteres de control.",
  categoryDuplicateName:
    "Ya existe una categoría activa de este tipo con ese nombre.",
  tagDuplicateName: "Ya existe una etiqueta activa con ese nombre.",
  typeRequired: "Elige si es de gasto o de ingreso.",
} as const;

/** Control identifiers the error summary links to. */
export const categoryDialogFields = {
  form: "category-dialog-form",
  name: "category-name",
  type: "category-type-gasto",
} as const;

/** Control identifiers of the tag dialog. */
export const tagDialogFields = {
  form: "tag-dialog-form",
  name: "tag-name",
} as const;

/** Values of the create-category form. */
export interface CreateCategoryFormValues {
  readonly name: string;
  readonly type: (typeof TRANSACTION_TYPES)[number];
}

/** Values of a rename form that only edits the written name. */
export interface RenameNameFormValues {
  readonly name: string;
}

function nameIssueMessage(
  issue: "required" | "tooLong" | "invalidCharacter",
): string {
  switch (issue) {
    case "required":
      return classificationFormCopy.nameRequired;
    case "tooLong":
      return classificationFormCopy.nameTooLong;
    default:
      return classificationFormCopy.nameInvalidCharacter;
  }
}

/**
 * Classifies a written name against the domain length, control-character and
 * emptiness rules. Uniqueness is a separate check because its scope depends
 * on the resource.
 */
export function classifyClassificationName(
  raw: string,
  maxLength: number,
): "required" | "tooLong" | "invalidCharacter" | undefined {
  const name = normalizeName(raw);

  if (name === "") {
    return "required";
  }

  if (characterLength(name) > maxLength) {
    return "tooLong";
  }

  if (containsControlCharacters(name, false)) {
    return "invalidCharacter";
  }

  return undefined;
}

/**
 * Tells whether an active catalog row already owns the normalized name.
 *
 * Archived rows are ignored: the unique index only covers active names, so
 * reusing a retired label is allowed. The row being renamed is also ignored
 * so submitting the current name is not a conflict.
 */
export function hasNormalizedNameConflict(
  raw: string,
  existing: readonly ClassificationNameItem[],
  excludeId?: string,
): boolean {
  const key = nameKey(raw);

  if (key === "") {
    return false;
  }

  return existing.some(
    (item) =>
      !item.isArchived && item.id !== excludeId && nameKey(item.name) === key,
  );
}

function addNameIssues(
  ctx: z.RefinementCtx,
  raw: string,
  options: {
    readonly maxLength: number;
    readonly existing: readonly ClassificationNameItem[];
    readonly excludeId?: string;
    readonly duplicateMessage: string;
  },
): void {
  const issue = classifyClassificationName(raw, options.maxLength);

  if (issue) {
    ctx.addIssue({
      code: "custom",
      path: ["name"],
      message: nameIssueMessage(issue),
    });
    return;
  }

  if (hasNormalizedNameConflict(raw, options.existing, options.excludeId)) {
    ctx.addIssue({
      code: "custom",
      path: ["name"],
      message: options.duplicateMessage,
    });
  }
}

/** Schema of POST /api/categories as the create dialog submits it. */
export function createCategoryFormSchema(
  existing: readonly (ClassificationNameItem & {
    readonly type: CreateCategoryFormValues["type"];
  })[],
) {
  return z
    .object({
      name: z.string(),
      type: z.enum(TRANSACTION_TYPES, {
        error: classificationFormCopy.typeRequired,
      }),
    })
    .superRefine((value, ctx) => {
      addNameIssues(ctx, value.name, {
        maxLength: MAX_CATEGORY_NAME_LENGTH,
        existing: existing.filter((item) => item.type === value.type),
        duplicateMessage: classificationFormCopy.categoryDuplicateName,
      });
    })
    .transform((value) => ({
      name: normalizeName(value.name),
      type: value.type,
    }));
}

/** Schema of PATCH /api/categories/[id] as the rename dialog submits it. */
export function renameCategoryFormSchema(
  existing: readonly (ClassificationNameItem & {
    readonly type: CreateCategoryFormValues["type"];
  })[],
  category: ClassificationNameItem & {
    readonly type: CreateCategoryFormValues["type"];
  },
) {
  return z
    .object({
      name: z.string(),
      type: z.enum(TRANSACTION_TYPES),
    })
    .superRefine((value, ctx) => {
      addNameIssues(ctx, value.name, {
        maxLength: MAX_CATEGORY_NAME_LENGTH,
        existing: existing.filter((item) => item.type === category.type),
        excludeId: category.id,
        duplicateMessage: classificationFormCopy.categoryDuplicateName,
      });
    })
    .transform((value) => ({
      name: normalizeName(value.name),
      type: value.type,
    }));
}

/** Schema of POST /api/tags as the create dialog submits it. */
export function createTagFormSchema(
  existing: readonly ClassificationNameItem[],
) {
  return z
    .object({
      name: z.string(),
    })
    .superRefine((value, ctx) => {
      addNameIssues(ctx, value.name, {
        maxLength: MAX_TAG_NAME_LENGTH,
        existing,
        duplicateMessage: classificationFormCopy.tagDuplicateName,
      });
    })
    .transform((value) => ({
      name: normalizeName(value.name),
    }));
}

/** Schema of PATCH /api/tags/[id] as the rename dialog submits it. */
export function renameTagFormSchema(
  existing: readonly ClassificationNameItem[],
  tag: ClassificationNameItem,
) {
  return z
    .object({
      name: z.string(),
    })
    .superRefine((value, ctx) => {
      addNameIssues(ctx, value.name, {
        maxLength: MAX_TAG_NAME_LENGTH,
        existing,
        excludeId: tag.id,
        duplicateMessage: classificationFormCopy.tagDuplicateName,
      });
    })
    .transform((value) => ({
      name: normalizeName(value.name),
    }));
}

function messageForFieldCode(
  code: ApiFieldErrorCode,
  duplicateMessage: string,
): string | undefined {
  switch (code) {
    case "required":
      return classificationFormCopy.nameRequired;
    case "tooLong":
    case "tooBig":
      return classificationFormCopy.nameTooLong;
    case "invalidCharacter":
      return classificationFormCopy.nameInvalidCharacter;
    case "duplicateName":
      return duplicateMessage;
    case "invalidTransactionType":
    case "invalidValue":
    case "invalidType":
      return classificationFormCopy.typeRequired;
    default:
      return undefined;
  }
}

/** Field-level copy produced from a refused classification mutation. */
export interface ClassificationSubmitErrors {
  name?: string;
  type?: string;
  form?: string;
}

/**
 * Maps a mutation failure onto the name/type fields or a form-level sentence.
 *
 * A `duplicateName` detail is the normalized-name conflict. Transport
 * failures keep the typed values in the form by never implying a reset: this
 * helper only returns copy.
 */
export function classificationSubmitErrors(
  failure: ApiClientFailure,
  kind: "category" | "tag",
): ClassificationSubmitErrors {
  const duplicateMessage =
    kind === "category"
      ? classificationFormCopy.categoryDuplicateName
      : classificationFormCopy.tagDuplicateName;

  if (failure.reason !== "api") {
    return { form: classificationFailureMessage(failure) };
  }

  const details = failure.error.details ?? [];
  const fieldErrors: ClassificationSubmitErrors = {};

  for (const detail of details) {
    assignDetail(fieldErrors, detail, duplicateMessage);
  }

  if (fieldErrors.name !== undefined || fieldErrors.type !== undefined) {
    return fieldErrors;
  }

  return {
    form: failure.error.message || classificationFailureCopy.network,
  };
}

function assignDetail(
  target: ClassificationSubmitErrors,
  detail: ApiFieldErrorDto,
  duplicateMessage: string,
): void {
  const message = messageForFieldCode(detail.code, duplicateMessage);

  if (message === undefined) {
    return;
  }

  if (detail.field === "type" || detail.code === "invalidTransactionType") {
    if (target.type === undefined) {
      target.type = message;
    }
    return;
  }

  if (target.name === undefined) {
    target.name = message;
  }
}

/** Builds the accessible summary from RHF field errors and a form error. */
export function classificationFormSummary(
  fields: readonly { readonly fieldId: string; readonly message?: string }[],
  formError?: string,
): FormError[] {
  const errors: FormError[] = fields
    .filter((field) => field.message)
    .map((field) => ({
      fieldId: field.fieldId,
      message: field.message as string,
    }));

  if (formError) {
    errors.push({ message: formError });
  }

  return errors;
}

/** Moves keyboard focus to the form alert so a failure is announced. */
export function focusClassificationAlert(root: ParentNode | null): void {
  const alert = root?.querySelector<HTMLElement>('[role="alert"]');
  alert?.focus();
}

/**
 * Focuses the alert after React Hook Form has moved to the first invalid
 * field, so the summary remains the announced target of a failed submit.
 */
export function scheduleClassificationAlertFocus(
  root: ParentNode | null,
): void {
  window.setTimeout(() => {
    focusClassificationAlert(root);
  }, 0);
}
