"use client";

/**
 * Create and rename dialog for a category.
 *
 * Type is a radio choice only while creating. Rename sends the name and
 * never a type, because that field is immutable after insert. Shared Zod
 * schemas and field copy keep client checks aligned with the server conflict
 * the API already returns as `duplicateName`.
 */

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo, useRef, type FormEvent } from "react";
import { useForm } from "react-hook-form";

import { createApiClient } from "../../../shared/client/api-client";
import { useFinancialDataRevision } from "../../../shared/client/financial-data-provider";
import { Button } from "../../../shared/ui/button";
import { DialogShell } from "../../../shared/ui/dialog";
import { ErrorSummary } from "../../../shared/ui/error-summary";
import { Field } from "../../../shared/ui/field";
import { Input } from "../../../shared/ui/input";
import {
  createClassificationApi,
  type ClassificationApi,
} from "../client/classification-api";
import type { CategoryDto } from "../contracts/category";
import {
  categoryDialogFields,
  classificationFormCopy,
  classificationFormSummary,
  classificationSubmitErrors,
  createCategoryFormSchema,
  scheduleClassificationAlertFocus,
  renameCategoryFormSchema,
  type CreateCategoryFormValues,
} from "./classification-form";

const defaultClassificationApi = createClassificationApi(createApiClient());

export type CategoryDialogMode =
  | { readonly kind: "create" }
  | { readonly kind: "rename"; readonly category: CategoryDto };

export interface CategoryDialogProps {
  readonly api?: ClassificationApi;
  readonly existingCategories: readonly CategoryDto[];
  readonly mode: CategoryDialogMode | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSaved?: (focusId?: string) => void;
  readonly open: boolean;
}

export function CategoryDialog({
  api = defaultClassificationApi,
  existingCategories,
  mode,
  onOpenChange,
  onSaved,
  open,
}: CategoryDialogProps) {
  const { announceSuccessfulMutation } = useFinancialDataRevision();
  const formRootRef = useRef<HTMLDivElement>(null);
  const isCreate = mode?.kind !== "rename";
  const category = mode?.kind === "rename" ? mode.category : undefined;

  const resolver = useMemo(() => {
    if (isCreate) {
      return zodResolver(createCategoryFormSchema(existingCategories));
    }

    return zodResolver(
      renameCategoryFormSchema(
        existingCategories,
        category ?? {
          id: "",
          name: "",
          type: "expense",
          isArchived: false,
        },
      ),
    );
  }, [category, existingCategories, isCreate]);

  const form = useForm<CreateCategoryFormValues>({
    resolver,
    shouldFocusError: false,
    defaultValues: {
      name: "",
      type: "expense",
    },
  });

  const pending = form.formState.isSubmitting;

  useEffect(() => {
    if (!open) {
      return;
    }

    form.clearErrors();
    form.reset({
      name: isCreate ? "" : (category?.name ?? ""),
      type: isCreate ? "expense" : (category?.type ?? "expense"),
    });
  }, [category?.id, category?.name, category?.type, form, isCreate, open]);

  function requestClose() {
    if (pending) {
      return;
    }

    onOpenChange(false);
  }

  async function onValid(values: CreateCategoryFormValues) {
    const result = isCreate
      ? await api.createCategory({
          name: values.name,
          type: values.type,
        })
      : category === undefined
        ? undefined
        : await api.renameCategory(category.id, { name: values.name });

    if (result === undefined) {
      return;
    }

    if (result.ok) {
      onSaved?.(isCreate ? undefined : category?.id);
      onOpenChange(false);
      announceSuccessfulMutation();
      return;
    }

    const mapped = classificationSubmitErrors(result, "category");
    if (mapped.name) {
      form.setError("name", { type: "server", message: mapped.name });
    }
    if (mapped.type) {
      form.setError("type", { type: "server", message: mapped.type });
    }
    if (mapped.form) {
      form.setError("root", { type: "server", message: mapped.form });
    }
    scheduleClassificationAlertFocus(formRootRef.current);
  }

  function handleFormSubmit(event: FormEvent<HTMLFormElement>) {
    void form.handleSubmit(onValid, () => {
      scheduleClassificationAlertFocus(formRootRef.current);
    })(event);
  }

  const nameError = form.formState.errors.name?.message;
  const typeError = form.formState.errors.type?.message;
  const formError = form.formState.errors.root?.message;
  const summary = classificationFormSummary(
    [
      { fieldId: categoryDialogFields.name, message: nameError },
      ...(isCreate
        ? [{ fieldId: categoryDialogFields.type, message: typeError }]
        : []),
    ],
    formError,
  );

  return (
    <DialogShell
      description={
        isCreate
          ? classificationFormCopy.createCategoryDescription
          : classificationFormCopy.renameCategoryDescription
      }
      footer={
        <>
          <Button disabled={pending} variant="secondary" onClick={requestClose}>
            {classificationFormCopy.cancel}
          </Button>
          <Button
            form={categoryDialogFields.form}
            pending={pending}
            type="submit"
          >
            {pending
              ? classificationFormCopy.saving
              : classificationFormCopy.save}
          </Button>
        </>
      }
      open={open}
      preventClose={pending}
      showCloseButton={false}
      title={
        isCreate
          ? classificationFormCopy.createCategoryTitle
          : classificationFormCopy.renameCategoryTitle
      }
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          requestClose();
        }
      }}
    >
      <div ref={formRootRef} className="flex flex-col gap-4">
        <ErrorSummary errors={summary} />
        <form
          id={categoryDialogFields.form}
          noValidate
          className="flex flex-col gap-4"
          onSubmit={handleFormSubmit}
        >
          <Field
            error={nameError}
            hint={classificationFormCopy.nameHint}
            id={categoryDialogFields.name}
            label={classificationFormCopy.nameLabel}
            required
          >
            <Input
              autoComplete="off"
              disabled={pending}
              {...form.register("name")}
            />
          </Field>
          {isCreate ? (
            <fieldset className="flex w-full max-w-full flex-col gap-1.5">
              <legend
                id="category-type-legend"
                className="text-body-sm text-text font-semibold"
              >
                {classificationFormCopy.typeLabel}
                <span className="text-text-muted font-normal">
                  {" "}
                  · obligatorio
                </span>
              </legend>
              <p
                id="category-type-hint"
                className="text-caption text-text-muted"
              >
                {classificationFormCopy.typeHint}
              </p>
              <div
                aria-describedby={
                  typeError
                    ? "category-type-hint category-type-error"
                    : "category-type-hint"
                }
                aria-invalid={typeError ? true : undefined}
                aria-labelledby="category-type-legend"
                aria-required="true"
                className="flex flex-col gap-2 sm:flex-row"
                role="radiogroup"
              >
                <label className="border-border text-body text-text inline-flex min-h-11 cursor-pointer items-center gap-3 rounded-full border px-4">
                  <input
                    className="accent-primary size-4"
                    disabled={pending}
                    id={categoryDialogFields.type}
                    type="radio"
                    value="expense"
                    {...form.register("type")}
                  />
                  {classificationFormCopy.expense}
                </label>
                <label className="border-border text-body text-text inline-flex min-h-11 cursor-pointer items-center gap-3 rounded-full border px-4">
                  <input
                    className="accent-primary size-4"
                    disabled={pending}
                    type="radio"
                    value="income"
                    {...form.register("type")}
                  />
                  {classificationFormCopy.income}
                </label>
              </div>
              {typeError ? (
                <p
                  id="category-type-error"
                  className="text-caption text-danger"
                >
                  {typeError}
                </p>
              ) : null}
            </fieldset>
          ) : (
            <p className="text-body-sm text-text-muted">
              {category?.type === "income"
                ? classificationFormCopy.typeImmutableIncome
                : classificationFormCopy.typeImmutableExpense}
            </p>
          )}
        </form>
      </div>
    </DialogShell>
  );
}
