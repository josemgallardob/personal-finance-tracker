"use client";

/**
 * Inclusive history date range. Draft lives in the dialog until Aplicar; Cancel
 * and dismiss leave the URL unchanged. Mobile uses the shared bottom sheet.
 */

import { useEffect, useId, useRef, useState, type RefObject } from "react";

import { parseLocalDate, type LocalDate } from "../../../shared/domain/dates";
import { Button } from "../../../shared/ui/button";
import { DialogShell } from "../../../shared/ui/dialog";
import { Field } from "../../../shared/ui/field";
import { Input } from "../../../shared/ui/input";
import { HISTORY_LIST_START_ID, historyCopy } from "./history-copy";
import {
  historyDateCalendarValue,
  historyDateInputValue,
  historyDateRangeTriggerLabel,
  validateHistoryDateRange,
  type HistoryDateRange,
} from "./history-date-range";

const DESKTOP_HISTORY_QUERY = "(min-width: 640px)";

export interface DateRangeDialogProps {
  readonly disabled?: boolean;
  readonly onApply: (next: HistoryDateRange) => void;
  readonly value: HistoryDateRange;
}

export function DateRangeDialog({
  disabled = false,
  onApply,
  value,
}: DateRangeDialogProps) {
  const [open, setOpen] = useState(false);
  const [fromText, setFromText] = useState("");
  const [toText, setToText] = useState("");
  const [fromError, setFromError] = useState<string | null>(null);
  const [toError, setToError] = useState<string | null>(null);
  const [isDesktop, setIsDesktop] = useState(() => readDesktopLayout());
  const fromInputRef = useRef<HTMLInputElement>(null);
  const toInputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }

    const media = window.matchMedia(DESKTOP_HISTORY_QUERY);
    const sync = () => {
      setIsDesktop(media.matches);
    };
    sync();
    media.addEventListener("change", sync);
    return () => {
      media.removeEventListener("change", sync);
    };
  }, []);

  function openDialog() {
    setFromText(historyDateInputValue(value.dateFrom));
    setToText(historyDateInputValue(value.dateTo));
    setFromError(null);
    setToError(null);
    setOpen(true);
    window.setTimeout(() => {
      fromInputRef.current?.focus();
    }, 0);
  }

  function handleApply() {
    const result = validateHistoryDateRange(fromText, toText);
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

    onApply(result.value);
    setOpen(false);
    window.setTimeout(() => {
      document.getElementById(HISTORY_LIST_START_ID)?.focus();
    }, 0);
  }

  return (
    <div className="min-w-0 sm:w-56">
      <p className="text-body-sm text-text mb-1.5 font-semibold" id={titleId}>
        {historyCopy.dateRangeLabel}
      </p>
      <Button
        aria-describedby={titleId}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="w-full max-w-full"
        disabled={disabled}
        onClick={openDialog}
        variant="secondary"
      >
        {historyDateRangeTriggerLabel(value)}
      </Button>
      <DialogShell
        closeLabel={historyCopy.dateRangeCancel}
        description={historyCopy.dateRangeDescription}
        footer={
          <Button onClick={handleApply}>{historyCopy.dateRangeApply}</Button>
        }
        onOpenChange={setOpen}
        open={open}
        title={historyCopy.dateRangeTitle}
      >
        <div
          className="flex w-full max-w-full min-w-0 flex-col gap-4"
          data-date-range-layout={isDesktop ? "desktop" : "mobile"}
        >
          <DateBoundFields
            calendarLabel={historyCopy.dateFromCalendar}
            error={fromError}
            id="history-date-from"
            inputRef={fromInputRef}
            label={historyCopy.dateFromLabel}
            onIsoChange={(date) => {
              setFromText(historyDateInputValue(date));
              setFromError(null);
            }}
            onTextChange={(next) => {
              setFromText(next);
              setFromError(null);
            }}
            text={fromText}
          />
          <DateBoundFields
            calendarLabel={historyCopy.dateToCalendar}
            error={toError}
            id="history-date-to"
            inputRef={toInputRef}
            label={historyCopy.dateToLabel}
            onIsoChange={(date) => {
              setToText(historyDateInputValue(date));
              setToError(null);
            }}
            onTextChange={(next) => {
              setToText(next);
              setToError(null);
            }}
            text={toText}
          />
        </div>
      </DialogShell>
    </div>
  );
}

function DateBoundFields({
  calendarLabel,
  error,
  id,
  inputRef,
  label,
  onIsoChange,
  onTextChange,
  text,
}: {
  readonly calendarLabel: string;
  readonly error: string | null;
  readonly id: string;
  readonly inputRef: RefObject<HTMLInputElement | null>;
  readonly label: string;
  readonly onIsoChange: (date: LocalDate | null) => void;
  readonly onTextChange: (text: string) => void;
  readonly text: string;
}) {
  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-3 sm:flex-row">
      <div className="min-w-0 flex-1">
        <Field
          error={error ?? undefined}
          hint={historyCopy.dateHint}
          id={id}
          label={label}
        >
          <Input
            autoComplete="off"
            inputMode="numeric"
            onChange={(event) => {
              onTextChange(event.target.value);
            }}
            placeholder="dd/mm/aaaa"
            ref={inputRef}
            value={text}
          />
        </Field>
      </div>
      <div className="min-w-0 flex-1">
        <Field id={`${id}-calendar`} label={calendarLabel}>
          <Input
            onChange={(event) => {
              const iso = event.target.value;
              if (iso === "") {
                onIsoChange(null);
                return;
              }

              const parsed = parseLocalDate(iso);
              if (parsed.ok) {
                onIsoChange(parsed.value);
              }
            }}
            type="date"
            value={historyDateCalendarValue(text)}
          />
        </Field>
      </div>
    </div>
  );
}

function readDesktopLayout(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(DESKTOP_HISTORY_QUERY).matches
  );
}
