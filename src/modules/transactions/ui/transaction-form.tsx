"use client";

import { useMemo } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import type { CategoryDto } from "../../classification/contracts/category";
import type { TagDto } from "../../classification/contracts/tag";
import { TagPicker } from "../../classification/ui/tag-picker";
import type { RecurringApi } from "../../recurring/client/recurring-api";
import { RepeatMonthlyFields } from "../../recurring/ui/repeat-monthly-fields";
import { ErrorSummary, type FormError } from "../../../shared/ui/error-summary";
import { Button } from "../../../shared/ui/button";
import { Field } from "../../../shared/ui/field";
import { Input } from "../../../shared/ui/input";
import { cx } from "../../../shared/ui/class-names";
import type { TransactionCreateBody } from "../contracts/http";
import type { TransactionType } from "../domain/transaction-type";
import {
  compatibleCategories,
  createTransactionFormSchema,
  defaultTransactionFormValues,
  transactionFormCopy,
  toTransactionWriteBody,
  type TransactionFormValues,
} from "./transaction-form-schema";

export interface TransactionFormProps {
  readonly categories: readonly CategoryDto[];
  readonly initialValues?: Partial<TransactionFormValues>;
  readonly onCancel?: () => void;
  readonly onSubmit: (body: TransactionCreateBody) => void | Promise<void>;
  readonly onSubmitAndAddAnother?: (
    body: TransactionCreateBody,
  ) => void | Promise<void>;
  readonly pending?: boolean;
  readonly retainedCategoryId?: string;
  readonly retainedTagIds?: readonly string[];
  readonly recurringApi?: RecurringApi;
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
    ["monthlyDay", "recurrence-monthly-day"],
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
  onSubmitAndAddAnother,
  pending = false,
  retainedCategoryId,
  retainedTagIds,
  recurringApi,
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
      onSubmit={handleSubmit((values, event) => {
        const submitter = (event?.nativeEvent as SubmitEvent | undefined)
          ?.submitter;
        const addAnother =
          Boolean(onSubmitAndAddAnother) &&
          submitter instanceof HTMLButtonElement &&
          submitter.value === "add-another";
        const body = toTransactionWriteBody(values);
        if (addAnother && onSubmitAndAddAnother) {
          return onSubmitAndAddAnother(body);
        }
        return onSubmit(body);
      })}
    >
      <ErrorSummary errors={summaryErrors} />
      <Controller
        control={control}
        name="type"
        render={({ field }) => (
          <fieldset className="min-w-0">
            <legend className="text-body-sm text-text font-semibold">
              {transactionFormCopy.typeLabel}
              <span aria-hidden="true" className="text-danger">
                {" "}
                *
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
        error={formState.errors.concept?.message}
        id="transaction-concept"
        label={transactionFormCopy.conceptLabel}
      >
        <Input autoComplete="off" {...register("concept")} />
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
        error={formState.errors.date?.message}
        id="transaction-date"
        label={transactionFormCopy.dateLabel}
        required
      >
        <Input
          className="transaction-date-input h-12 min-h-12 max-w-64 px-3 text-center"
          max={today}
          type="date"
          {...register("date")}
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
      <Field
        error={formState.errors.note?.message}
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
      {recurringApi ? (
        <Controller
          control={control}
          name="recurrenceEnabled"
          render={({ field: enabledField }) => (
            <Controller
              control={control}
              name="monthlyDay"
              render={({ field: dayField }) => (
                <RepeatMonthlyFields
                  api={recurringApi}
                  disabled={pending}
                  enabled={enabledField.value}
                  monthlyDay={dayField.value}
                  onEnabledChange={enabledField.onChange}
                  onMonthlyDayChange={dayField.onChange}
                />
              )}
            />
          )}
        />
      ) : null}
      <p className="text-caption text-text-muted">
        <span aria-hidden="true" className="text-danger">
          *
        </span>{" "}
        {transactionFormCopy.requiredFields}
      </p>
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
        {onSubmitAndAddAnother ? (
          <Button
            disabled={pending}
            name="intent"
            pending={pending}
            type="submit"
            value="add-another"
            variant="secondary"
          >
            {transactionFormCopy.saveAndAddAnother}
          </Button>
        ) : null}
        <Controller
          control={control}
          name="type"
          render={({ field }) => (
            <Button name="intent" pending={pending} type="submit" value="save">
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
