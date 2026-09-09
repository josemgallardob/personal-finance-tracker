"use client";

import { useMemo, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import type { CategoryDto } from "../../classification/contracts/category";
import type { TagDto } from "../../classification/contracts/tag";
import { TagPicker } from "../../classification/ui/tag-picker";
import {
  createApiClient,
  type ApiClient,
} from "../../../shared/client/api-client";
import { useFinancialDataRevision } from "../../../shared/client/financial-data-provider";
import { useResource } from "../../../shared/client/use-resource";
import { Button } from "../../../shared/ui/button";
import { cx } from "../../../shared/ui/class-names";
import { DialogShell } from "../../../shared/ui/dialog";
import { ErrorSummary, type FormError } from "../../../shared/ui/error-summary";
import { Field } from "../../../shared/ui/field";
import { Input } from "../../../shared/ui/input";
import { LoadingState } from "../../../shared/ui/loading-state";
import {
  compatibleCategories,
  transactionFormCopy,
} from "../../transactions/ui/transaction-form-schema";
import type { TransactionType } from "../../transactions/domain/transaction-type";
import { createRecurringApi } from "../client/recurring-api";
import type { RecurringRuleDto } from "../contracts/recurring";
import { recurringCopy } from "./recurring-copy";
import { recurringFailureMessage } from "./recurring-failure";
import { catchUpAnnouncement } from "./recurring-presentation";
import {
  createRecurringRuleFormSchema,
  recurringRuleToFormValues,
  toRecurringRuleWriteBody,
  type RecurringRuleFormValues,
} from "./recurring-rule-form-schema";

export interface EditRecurringDialogProps {
  readonly categories: readonly CategoryDto[];
  readonly client?: ApiClient;
  /** Reports the dates the accepted change materialised, empty list included. */
  readonly onCompleted?: (generatedDueDates: readonly string[]) => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
  readonly rule: RecurringRuleDto | null;
  readonly tags: readonly TagDto[];
}

const FIELD_IDS: ReadonlyArray<[keyof RecurringRuleFormValues, string]> = [
  ["type", "recurring-type"],
  ["amountText", "recurring-amount"],
  ["categoryId", "recurring-category"],
  ["concept", "recurring-concept"],
  ["note", "recurring-note"],
  ["tagSelections", "recurring-tags"],
  ["monthlyDay", "recurring-monthly-day"],
];

/**
 * Edits one active template.
 *
 * The dialog reads the overdue dates before the owner decides, because the
 * change materialises them with the previous template: a confirmation that
 * hides them would create movements the owner believed were cancelled. The
 * template version travels with the write, so a rule another window already
 * changed is refused instead of silently overwritten.
 */
export function EditRecurringDialog({
  categories,
  client,
  onCompleted,
  onOpenChange,
  open,
  rule,
  tags,
}: EditRecurringDialogProps) {
  const apiClient = useMemo(() => client ?? createApiClient(), [client]);
  const api = useMemo(() => createRecurringApi(apiClient), [apiClient]);
  const { announceSuccessfulMutation } = useFinancialDataRevision();
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const ruleId = rule?.id ?? null;
  const catchUp = useResource({
    enabled: open && ruleId !== null,
    requestKey: `recurring-catch-up:${ruleId ?? ""}`,
    revision: 0,
    refreshEpoch: 0,
    load: (signal) => {
      if (ruleId === null) {
        return Promise.resolve({
          ok: false as const,
          reason: "invalidResponse" as const,
          status: 204,
        });
      }

      return api.previewCatchUp(ruleId, { signal });
    },
  });

  const schema = useMemo(
    () =>
      createRecurringRuleFormSchema({
        categories,
        retainedCategoryId: rule?.categoryId,
        retainedTagIds: rule?.tagIds,
        tags,
      }),
    [categories, rule?.categoryId, rule?.tagIds, tags],
  );

  const { control, formState, getValues, handleSubmit, register, setValue } =
    useForm<RecurringRuleFormValues>({
      resolver: zodResolver(schema),
      values: rule
        ? recurringRuleToFormValues(rule, tags)
        : {
            type: "expense",
            amountText: "",
            categoryId: "",
            concept: "",
            note: "",
            tagSelections: [],
            monthlyDay: 1,
          },
      mode: "onSubmit",
    });

  const summaryErrors: FormError[] = FIELD_IDS.flatMap(([name, fieldId]) => {
    const message = formState.errors[name]?.message;
    return message ? [{ fieldId, message: String(message) }] : [];
  });

  function selectType(nextType: TransactionType) {
    const current = getValues("categoryId");
    if (
      !compatibleCategories(categories, nextType, rule?.categoryId).some(
        (category) => category.id === current,
      )
    ) {
      setValue("categoryId", "");
    }
  }

  function requestClose(nextOpen: boolean) {
    if (pendingRef.current && !nextOpen) {
      return;
    }

    if (!nextOpen) {
      pendingRef.current = false;
      setPending(false);
      setSaveError(null);
    }

    onOpenChange(nextOpen);
  }

  async function save(values: RecurringRuleFormValues): Promise<void> {
    if (pendingRef.current || rule === null) {
      return;
    }

    pendingRef.current = true;
    setPending(true);
    setSaveError(null);

    const result = await api.updateRule(
      rule.id,
      toRecurringRuleWriteBody(values, rule.templateVersion),
    );

    pendingRef.current = false;
    setPending(false);

    if (!result.ok) {
      if (result.reason !== "aborted") {
        setSaveError(recurringFailureMessage(result, recurringCopy.editError));
      }
      return;
    }

    announceSuccessfulMutation();
    onCompleted?.(result.noContent ? [] : result.data.generatedDueDates);
    onOpenChange(false);
  }

  const pendingDates = catchUp.data?.pendingDueDates ?? [];
  const catchUpMessage = catchUpAnnouncement(pendingDates);

  return (
    <DialogShell
      description={recurringCopy.editDescription}
      open={open}
      preventClose={pending}
      showCloseButton={false}
      title={recurringCopy.editTitle}
      onOpenChange={requestClose}
    >
      {rule === null ? (
        <p className="text-body-sm text-text-muted">
          {recurringCopy.loadError}
        </p>
      ) : (
        <form
          className="flex w-full max-w-full flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            void handleSubmit(save)(event);
          }}
        >
          <ErrorSummary errors={summaryErrors} />
          {saveError ? (
            <p className="text-body-sm text-danger" role="alert">
              {saveError}
            </p>
          ) : null}
          <CatchUpNotice
            message={catchUpMessage}
            status={catchUp.status}
            unavailable={catchUp.status === "error"}
          />
          <Controller
            control={control}
            name="type"
            render={({ field }) => (
              <fieldset className="min-w-0">
                <legend className="text-body-sm text-text font-semibold">
                  {transactionFormCopy.typeLabel}
                </legend>
                <div
                  className="mt-1.5 grid grid-cols-2 gap-2"
                  id="recurring-type"
                  role="radiogroup"
                >
                  {(["expense", "income"] as const).map((option) => (
                    <label
                      key={option}
                      className={cx(
                        "border-border focus-within:outline-primary-bright inline-flex min-h-12 items-center justify-center rounded-full border px-4 text-base font-semibold focus-within:outline-2 focus-within:outline-offset-[3px]",
                        field.value === option && "bg-surface-hover",
                      )}
                    >
                      <input
                        checked={field.value === option}
                        className="sr-only"
                        disabled={pending}
                        name={field.name}
                        type="radio"
                        value={option}
                        onBlur={field.onBlur}
                        onChange={() => {
                          field.onChange(option);
                          selectType(option);
                        }}
                      />
                      {option === "expense"
                        ? transactionFormCopy.expense
                        : transactionFormCopy.income}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
          />
          <Field
            error={formState.errors.amountText?.message}
            hint={transactionFormCopy.amountHint}
            id="recurring-amount"
            label={recurringCopy.amountLabel}
            required
          >
            <Input
              autoComplete="off"
              disabled={pending}
              inputMode="decimal"
              tabular
              {...register("amountText")}
            />
          </Field>
          <Controller
            control={control}
            name="type"
            render={({ field: typeField }) => (
              <Field
                error={formState.errors.categoryId?.message}
                id="recurring-category"
                label={transactionFormCopy.categoryLabel}
                required
              >
                <select
                  aria-invalid={formState.errors.categoryId ? true : undefined}
                  aria-required="true"
                  className="border-border bg-surface-raised text-text focus-visible:outline-primary-bright block h-14 min-h-14 w-full max-w-full rounded-md border px-4 text-base focus-visible:outline-2 focus-visible:outline-offset-[3px]"
                  disabled={pending}
                  id="recurring-category"
                  {...register("categoryId")}
                >
                  <option value="">
                    {transactionFormCopy.categoryPlaceholder}
                  </option>
                  {compatibleCategories(
                    categories,
                    typeField.value,
                    rule.categoryId,
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
            id="recurring-concept"
            label={transactionFormCopy.conceptLabel}
          >
            <Input
              autoComplete="off"
              disabled={pending}
              {...register("concept")}
            />
          </Field>
          <Field
            error={formState.errors.note?.message}
            hint={transactionFormCopy.noteHint}
            id="recurring-note"
            label={transactionFormCopy.noteLabel}
          >
            <textarea
              aria-invalid={formState.errors.note ? true : undefined}
              className="border-border bg-surface-raised text-text focus-visible:outline-primary-bright block min-h-24 w-full max-w-full rounded-md border px-4 py-3 text-base focus-visible:outline-2 focus-visible:outline-offset-[3px]"
              disabled={pending}
              id="recurring-note"
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
                id="recurring-tags"
                retainedTagIds={rule.tagIds}
                tags={tags}
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />
          <Field
            error={formState.errors.monthlyDay?.message}
            hint={recurringCopy.monthlyDayHint}
            id="recurring-monthly-day"
            label={recurringCopy.monthlyDayField}
            required
          >
            <Input
              disabled={pending}
              inputMode="numeric"
              max={31}
              min={1}
              type="number"
              {...register("monthlyDay", { valueAsNumber: true })}
            />
          </Field>
          <div className="flex w-full max-w-full flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button
              disabled={pending}
              type="button"
              variant="secondary"
              onClick={() => {
                requestClose(false);
              }}
            >
              {recurringCopy.cancel}
            </Button>
            <Button pending={pending} type="submit">
              {recurringCopy.save}
            </Button>
          </div>
        </form>
      )}
    </DialogShell>
  );
}

function CatchUpNotice({
  message,
  status,
  unavailable,
}: {
  readonly message: string | null;
  readonly status: "loading" | "ready" | "error";
  readonly unavailable: boolean;
}) {
  if (status === "loading") {
    return <LoadingState label={recurringCopy.catchUpLoading} />;
  }

  if (unavailable) {
    return (
      <p className="text-body-sm text-text-muted" role="status">
        {recurringCopy.catchUpUnavailable}
      </p>
    );
  }

  return (
    <p className="text-body-sm text-text" role="status">
      {message ?? recurringCopy.catchUpNone}
    </p>
  );
}
