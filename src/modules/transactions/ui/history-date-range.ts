/**
 * History date-range draft: civil LocalDate values, never instants.
 *
 * Typed `dd/mm/yyyy` and calendar `YYYY-MM-DD` both parse through
 * {@link parseLocalDate}, so a DST transition cannot shift the day.
 */

import {
  compareLocalDates,
  parseLocalDate,
  type LocalDate,
} from "../../../shared/domain/dates";
import { formatLocalDateAsSpanish } from "./transaction-form-schema";
import { historyCopy } from "./history-copy";

const SPANISH_DATE_PATTERN = /^(\d{2})\/(\d{2})\/(\d{4})$/;

/** Inclusive From/To bounds stored on the history URL. */
export interface HistoryDateRange {
  readonly dateFrom: LocalDate | null;
  readonly dateTo: LocalDate | null;
}

export const emptyHistoryDateRange: HistoryDateRange = {
  dateFrom: null,
  dateTo: null,
};

/** Parses a typed or calendar field; blank is an open endpoint. */
export function parseHistoryDateText(
  text: string,
): { ok: true; value: LocalDate | null } | { ok: false } {
  const trimmed = text.trim();
  if (trimmed === "") {
    return { ok: true, value: null };
  }

  const iso = parseLocalDate(trimmed);
  if (iso.ok) {
    return iso;
  }

  const spanish = SPANISH_DATE_PATTERN.exec(trimmed);
  if (spanish === null) {
    return { ok: false };
  }

  return parseLocalDate(`${spanish[3]}-${spanish[2]}-${spanish[1]}`);
}

export function historyDateInputValue(date: LocalDate | null): string {
  return date === null ? "" : formatLocalDateAsSpanish(date);
}

export function historyDateCalendarValue(text: string): string {
  const parsed = parseHistoryDateText(text);
  return parsed.ok && parsed.value !== null ? parsed.value : "";
}

export type HistoryDateRangeValidation =
  | { readonly ok: true; readonly value: HistoryDateRange }
  | {
      readonly ok: false;
      readonly fromError: string | null;
      readonly toError: string | null;
    };

/**
 * Validates From/To independently, then rejects an inverted closed range.
 * Field text is not cleared when this fails.
 */
export function validateHistoryDateRange(
  fromText: string,
  toText: string,
): HistoryDateRangeValidation {
  const from = parseHistoryDateText(fromText);
  const to = parseHistoryDateText(toText);
  let fromError: string | null = from.ok ? null : historyCopy.dateInvalid;
  let toError: string | null = to.ok ? null : historyCopy.dateInvalid;

  if (
    from.ok &&
    to.ok &&
    from.value !== null &&
    to.value !== null &&
    compareLocalDates(from.value, to.value) > 0
  ) {
    fromError = historyCopy.dateInverted;
    toError = historyCopy.dateInverted;
  }

  if (fromError !== null || toError !== null || !from.ok || !to.ok) {
    return {
      ok: false,
      fromError: fromError ?? historyCopy.dateInvalid,
      toError: toError ?? historyCopy.dateInvalid,
    };
  }

  return {
    ok: true,
    value: { dateFrom: from.value, dateTo: to.value },
  };
}

export function historyDateRangeTriggerLabel(range: HistoryDateRange): string {
  const from =
    range.dateFrom === null ? null : formatLocalDateAsSpanish(range.dateFrom);
  const to =
    range.dateTo === null ? null : formatLocalDateAsSpanish(range.dateTo);

  if (from !== null && to !== null) {
    return historyCopy.dateRangeTriggerBoth(from, to);
  }

  if (from !== null) {
    return historyCopy.dateRangeTriggerFrom(from);
  }

  if (to !== null) {
    return historyCopy.dateRangeTriggerTo(to);
  }

  return historyCopy.dateRangeLabel;
}
