"use client";

import { useEffect, useRef, useState } from "react";

import type { RecurringApi } from "../client/recurring-api";
import { formatLocalDateAsSpanish } from "../../transactions/ui/transaction-form-schema";

export const repeatMonthlyCopy = {
  label: "Repetir cada mes",
  day: "Día del mes",
  hint: "En meses cortos se usará el último día.",
  invalidDay: "Elige un día entre 1 y 31.",
  preview: "La primera copia será el",
  previewError: "No se ha podido calcular la primera fecha.",
} as const;

export interface RepeatMonthlyFieldsProps {
  readonly api: RecurringApi;
  readonly disabled?: boolean;
  readonly enabled: boolean;
  readonly monthlyDay: number;
  readonly onEnabledChange: (enabled: boolean) => void;
  readonly onMonthlyDayChange: (monthlyDay: number) => void;
}

export function RepeatMonthlyFields({
  api,
  disabled = false,
  enabled,
  monthlyDay,
  onEnabledChange,
  onMonthlyDayChange,
}: RepeatMonthlyFieldsProps) {
  const [nextDueDate, setNextDueDate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const validDay =
    Number.isInteger(monthlyDay) && monthlyDay >= 1 && monthlyDay <= 31;

  useEffect(() => {
    requestVersion.current += 1;
    const version = requestVersion.current;
    if (!enabled || !validDay) {
      return;
    }

    const controller = new AbortController();
    void api
      .previewNextDueDate({ monthlyDay }, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted || version !== requestVersion.current)
          return;
        if (!result.ok) {
          if (result.reason !== "aborted")
            setError(repeatMonthlyCopy.previewError);
          return;
        }
        if (!result.noContent) setNextDueDate(result.data.nextDueDate);
      });
    return () => controller.abort();
  }, [api, enabled, monthlyDay, validDay]);

  return (
    <fieldset className="border-border rounded-md border p-4">
      <label className="text-body-sm text-text flex min-h-11 items-center gap-3">
        <input
          checked={enabled}
          disabled={disabled}
          type="checkbox"
          onChange={(event) => onEnabledChange(event.target.checked)}
        />
        <span className="font-semibold">{repeatMonthlyCopy.label}</span>
      </label>
      {enabled ? (
        <div className="mt-3 flex flex-col gap-2">
          <label
            className="text-body-sm text-text"
            htmlFor="recurrence-monthly-day"
          >
            {repeatMonthlyCopy.day}
          </label>
          <input
            aria-describedby="recurrence-monthly-day-hint"
            aria-invalid={error ? true : undefined}
            disabled={disabled}
            id="recurrence-monthly-day"
            max={31}
            min={1}
            type="number"
            value={monthlyDay}
            onChange={(event) => onMonthlyDayChange(Number(event.target.value))}
          />
          <p
            className="text-caption text-text-muted"
            id="recurrence-monthly-day-hint"
          >
            {repeatMonthlyCopy.hint}
          </p>
          {!validDay ? (
            <p className="text-caption text-danger" role="alert">
              {repeatMonthlyCopy.invalidDay}
            </p>
          ) : error ? (
            <p className="text-caption text-danger" role="alert">
              {error}
            </p>
          ) : null}
          {validDay && nextDueDate ? (
            <p className="text-body-sm text-text" role="status">
              {repeatMonthlyCopy.preview}{" "}
              {formatLocalDateAsSpanish(nextDueDate)}.
            </p>
          ) : null}
        </div>
      ) : null}
    </fieldset>
  );
}
