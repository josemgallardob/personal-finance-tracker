"use client";

import { useMemo } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import type { CategoryDto } from "../../classification/contracts/category";
import type { TagDto } from "../../classification/contracts/tag";
import { TagPicker } from "../../classification/ui/tag-picker";
import { ErrorSummary, type FormError } from "../../../shared/ui/error-summary";
import { Button } from "../../../shared/ui/button";
import { Field } from "../../../shared/ui/field";
import { Input } from "../../../shared/ui/input";
import { cx } from "../../../shared/ui/class-names";
import type { TransactionWriteBody } from "../contracts/http";
import type { TransactionType } from "../domain/transaction-type";
import {
  compatibleCategories,
  createTransactionFormSchema,
  defaultTransactionFormValues,
  formatLocalDateAsSpanish,
  transactionFormCopy,
  toTransactionWriteBody,
  type TransactionFormValues,
} from "./transaction-form-schema";

export interface TransactionFormProps {
  readonly categories: readonly CategoryDto[];
  readonly initialValues?: Partial<TransactionFormValues>;
  readonly onCancel?: () => void;
  readonly onSubmit: (body: TransactionWriteBody) => void | Promise<void>;
  readonly pending?: boolean;
  readonly retainedCategoryId?: string;
  readonly retainedTagIds?: readonly string[];
  readonly submitLabel?: string;
  readonly tags: readonly TagDto[];
  readonly today: string;
}

function collectFormErrors(
  errors: ReturnType<
    typeof useForm<TransactionFormValues>
  >["formState"]["errors"],
): FormError[] {
  const collected: FormError[] = [];
  const fields: Array<[keyof TransactionFormValues, string]> = [
    ["type", "transaction-type"],
    ["amountText", "transaction-amount"],
    ["date", "transaction-date"],
    ["categoryId", "transaction-category"],
    ["concept", "transaction-concept"],
    ["note", "transaction-note"],
    ["tagSelections", "transaction-tags"],
  ];

  for (const [name, fieldId] of fields) {
    const error = errors[name];
    if (error?.message) {
      collected.push({ fieldId, message: String(error.message) });
    }
  }

  return collected;
}

export function TransactionForm({
  categories,
  initialValues,
  onCancel,
  onSubmit,
  pending = false,
  retainedCategoryId,
  retainedTagIds,
  submitLabel,
  tags,
  today,
}: TransactionFormProps) {
  const schema = useMemo(
    () =>
      createTransactionFormSchema({
        today,
        categories,
        tags,
        retainedCategoryId,
        retainedTagIds,
      }),
    [categories, retainedCategoryId, retainedTagIds, tags, today],
  );

  const { control, formState, getValues, handleSubmit, register, setValue } =
    useForm<TransactionFormValues>({
      resolver: zodResolver(schema),
      defaultValues: defaultTransactionFormValues(today, initialValues),
      mode: "onSubmit",
    });

  const summaryErrors = collectFormErrors(formState.errors);

  function selectType(nextType: TransactionType) {
    const currentCategoryId = getValues("categoryId");
    if (
      !compatibleCategories(categories, nextType, retainedCategoryId).some(
        (category) => category.id === currentCategoryId,
      )
    ) {
      setValue("categoryId", "");
    }
  }

  return (
    <form
      className="flex w-full max-w-full flex-col gap-4"
      noValidate
      onSubmit={handleSubmit((values) =>
        onSubmit(toTransactionWriteBody(values)),
      )}
    >
      <ErrorSummary errors={summaryErrors} />
      <Controller
        control={control}
        name="type"
        render={({ field }) => (
          <fieldset className="min-w-0">
            <legend className="text-body-sm text-text font-semibold">
              {transactionFormCopy.typeLabel}
              <span className="text-text-muted font-normal">
                {" "}
                · obligatorio
              </span>
            </legend>
            <div
              aria-required="true"
              className="mt-1.5 grid grid-cols-2 gap-2"
              id="transaction-type"
              role="radiogroup"
            >
              <label
                className={cx(
                  "border-border focus-within:outline-primary-bright inline-flex min-h-12 items-center justify-center rounded-full border px-4 text-base font-semibold focus-within:outline-2 focus-within:outline-offset-[3px]",
                  field.value === "expense" && "bg-surface-hover",
                )}
              >
                <input
                  checked={field.value === "expense"}
                  className="sr-only"
                  name={field.name}
                  ref={field.ref}
                  type="radio"
                  value="expense"
                  onBlur={field.onBlur}
                  onChange={() => {
                    field.onChange("expense");
                    selectType("expense");
                  }}
                />
                {transactionFormCopy.expense}
              </label>
              <label
                className={cx(
                  "border-border focus-within:outline-primary-bright inline-flex min-h-12 items-center justify-center rounded-full border px-4 text-base font-semibold focus-within:outline-2 focus-within:outline-offset-[3px]",
                  field.value === "income" && "bg-surface-hover",
                )}
              >
                <input
                  checked={field.value === "income"}
                  className="sr-only"
                  name={field.name}
                  type="radio"
                  value="income"
                  onBlur={field.onBlur}
                  onChange={() => {
                    field.onChange("income");
                    selectType("income");
                  }}
                />
                {transactionFormCopy.income}
              </label>
            </div>
            {formState.errors.type?.message ? (
              <p
                className="text-caption text-danger mt-1.5"
                id="transaction-type-error"
              >
                {formState.errors.type.message}
              </p>
            ) : null}
          </fieldset>
        )}
      />
      <Field
        error={formState.errors.amountText?.message}
        hint={transactionFormCopy.amountHint}
        id="transaction-amount"
        label="Importe"
        required
      >
        <Input
          autoComplete="off"
          autoFocus
          inputMode="decimal"
          placeholder="0,00"
          tabular
          {...register("amountText")}
        />
      </Field>
      <Field
        error={formState.errors.date?.message}
        hint={`${transactionFormCopy.dateHint} Hoy: ${formatLocalDateAsSpanish(today)}.`}
        id="transaction-date"
        label={transactionFormCopy.dateLabel}
        required
      >
        <Input max={today} type="date" {...register("date")} />
      </Field>
      <Controller
        control={control}
        name="type"
        render={({ field: typeField }) => (
          <Field
            error={formState.errors.categoryId?.message}
            id="transaction-category"
            label={transactionFormCopy.categoryLabel}
            required
          >
            <select
              aria-invalid={formState.errors.categoryId ? true : undefined}
              aria-required="true"
              className="border-border bg-surface-raised text-text focus-visible:outline-primary-bright block h-14 min-h-14 w-full max-w-full rounded-md border px-4 text-base focus-visible:outline-2 focus-visible:outline-offset-[3px]"
              id="transaction-category"
              {...register("categoryId")}
            >
              <option value="">
                {transactionFormCopy.categoryPlaceholder}
              </option>
              {compatibleCategories(
                categories,
                typeField.value,
                retainedCategoryId,
              ).map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </Field>
        )}
      />
      <Field
        error={formState.errors.concept?.message}
        hint={transactionFormCopy.conceptHint}
        id="transaction-concept"
        label={transactionFormCopy.conceptLabel}
      >
        <Input autoComplete="off" {...register("concept")} />
      </Field>
      <Field
        error={formState.errors.note?.message}
        hint={transactionFormCopy.noteHint}
        id="transaction-note"
        label={transactionFormCopy.noteLabel}
      >
        <textarea
          aria-invalid={formState.errors.note ? true : undefined}
          className="border-border bg-surface-raised text-text focus-visible:outline-primary-bright block min-h-24 w-full max-w-full rounded-md border px-4 py-3 text-base focus-visible:outline-2 focus-visible:outline-offset-[3px]"
          id="transaction-note"
          rows={3}
          {...register("note")}
        />
      </Field>
      <Controller
        control={control}
        name="tagSelections"
        render={({ field, fieldState }) => (
          <TagPicker
            error={fieldState.error?.message}
            id="transaction-tags"
            retainedTagIds={retainedTagIds}
            tags={tags}
            value={field.value}
            onChange={field.onChange}
          />
        )}
      />
      <div className="flex w-full max-w-full flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        {onCancel ? (
          <Button
            disabled={pending}
            type="button"
            variant="secondary"
            onClick={onCancel}
          >
            {transactionFormCopy.cancel}
          </Button>
        ) : null}
        <Controller
          control={control}
          name="type"
          render={({ field }) => (
            <Button pending={pending} type="submit">
              {submitLabel ??
                (field.value === "income"
                  ? transactionFormCopy.submitIncome
                  : transactionFormCopy.submitExpense)}
            </Button>
          )}
        />
      </div>
    </form>
  );
}
