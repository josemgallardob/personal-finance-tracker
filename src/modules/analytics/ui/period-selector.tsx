"use client";

/**
 * Period selection of the dashboard cards.
 *
 * The four presets are toggle buttons: the pressed one is the applied period,
 * announced through `aria-pressed` so the selection is not carried by colour
 * alone. The custom range opens a dialog whose draft lives inside it until
 * Aplicar, so cancelling or dismissing leaves the cards on the period they were
 * already showing.
 */

import { useEffect, useRef, useState } from "react";

import { Button } from "../../../shared/ui/button";
import { cx } from "../../../shared/ui/class-names";
import { DialogShell } from "../../../shared/ui/dialog";
import { Field } from "../../../shared/ui/field";
import { Input } from "../../../shared/ui/input";
import type { DashboardPeriod } from "../domain/periods";
import { dashboardCopy } from "./dashboard-copy";
import {
  DASHBOARD_PERIOD_PRESETS,
  dashboardPeriodLabel,
  dashboardPresetLabel,
  monthRangeInputValues,
  validateMonthRange,
} from "./dashboard-period";

export interface PeriodSelectorProps {
  readonly disabled?: boolean;
  readonly onChange: (next: DashboardPeriod) => void;
  readonly value: DashboardPeriod;
}

/** Preset buttons plus the custom month range of the dashboard. */
export function PeriodSelector({
  disabled = false,
  onChange,
  value,
}: PeriodSelectorProps) {
  const [open, setOpen] = useState(false);
  const [fromText, setFromText] = useState("");
  const [toText, setToText] = useState("");
  const [fromError, setFromError] = useState<string | null>(null);
  const [toError, setToError] = useState<string | null>(null);
  const fromInputRef = useRef<HTMLInputElement>(null);
  const toInputRef = useRef<HTMLInputElement>(null);
  const isCustom = value.kind === "customMonthRange";

  useEffect(() => {
    if (!open) {
      return;
    }

    const timer = window.setTimeout(() => {
      fromInputRef.current?.focus();
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [open]);

  function openDialog() {
    const initial = monthRangeInputValues(value);
    setFromText(initial.from);
    setToText(initial.to);
    setFromError(null);
    setToError(null);
    setOpen(true);
  }

  function handleApply() {
    const result = validateMonthRange(fromText, toText);

    if (!result.ok) {
      setFromError(result.fromError);
      setToError(result.toError);

      if (result.fromError !== null) {
        fromInputRef.current?.focus();
      } else {
        toInputRef.current?.focus();
      }

      return;
    }

    onChange({
      kind: "customMonthRange",
      from: result.from,
      to: result.to,
    });
    setOpen(false);
  }

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-2">
      <p className="text-body-sm text-text font-semibold" id="dashboard-period">
        {dashboardCopy.periodLabel}
      </p>
      <div
        aria-label={dashboardCopy.periodGroupLabel}
        className="flex w-full max-w-full min-w-0 flex-wrap gap-2"
        role="group"
      >
        {DASHBOARD_PERIOD_PRESETS.map((preset) => {
          const pressed = value.kind === preset;

          return (
            <PeriodButton
              key={preset}
              disabled={disabled}
              label={dashboardPresetLabel(preset)}
              onClick={() => {
                onChange({ kind: preset });
              }}
              pressed={pressed}
            />
          );
        })}
        <PeriodButton
          ariaHasPopup="dialog"
          disabled={disabled}
          expanded={open}
          label={
            isCustom
              ? `${dashboardCopy.customMonthRange}: ${dashboardPeriodLabel(value)}`
              : dashboardCopy.customMonthRange
          }
          onClick={openDialog}
          pressed={isCustom}
        />
      </div>
      <DialogShell
        closeLabel={dashboardCopy.monthRangeCancel}
        description={dashboardCopy.monthRangeDescription}
        footer={
          <Button onClick={handleApply}>{dashboardCopy.monthRangeApply}</Button>
        }
        onOpenChange={setOpen}
        open={open}
        title={dashboardCopy.monthRangeTitle}
      >
        <div className="flex w-full max-w-full min-w-0 flex-col gap-4 sm:flex-row">
          <div className="min-w-0 flex-1">
            <Field
              error={fromError ?? undefined}
              hint={dashboardCopy.monthHint}
              id="dashboard-month-from"
              label={dashboardCopy.monthFromLabel}
            >
              <Input
                onChange={(event) => {
                  setFromText(event.target.value);
                  setFromError(null);
                }}
                ref={fromInputRef}
                type="month"
                value={fromText}
              />
            </Field>
          </div>
          <div className="min-w-0 flex-1">
            <Field
              error={toError ?? undefined}
              hint={dashboardCopy.monthHint}
              id="dashboard-month-to"
              label={dashboardCopy.monthToLabel}
            >
              <Input
                onChange={(event) => {
                  setToText(event.target.value);
                  setToError(null);
                }}
                ref={toInputRef}
                type="month"
                value={toText}
              />
            </Field>
          </div>
        </div>
      </DialogShell>
    </div>
  );
}

function PeriodButton({
  ariaHasPopup,
  disabled,
  expanded,
  label,
  onClick,
  pressed,
}: {
  readonly ariaHasPopup?: "dialog";
  readonly disabled: boolean;
  readonly expanded?: boolean;
  readonly label: string;
  readonly onClick: () => void;
  readonly pressed: boolean;
}) {
  return (
    <button
      aria-describedby="dashboard-period"
      aria-expanded={expanded}
      aria-haspopup={ariaHasPopup}
      aria-pressed={pressed}
      className={cx(
        "text-body-sm inline-flex min-h-11 max-w-full items-center justify-center rounded-full border px-4 font-semibold",
        "focus-visible:outline-primary-bright transition-colors focus-visible:outline-2 focus-visible:outline-offset-[3px]",
        "disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none",
        pressed
          ? "border-primary bg-primary text-text"
          : "border-border text-text-muted hover:bg-surface-hover hover:text-text",
      )}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}
