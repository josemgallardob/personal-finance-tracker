"use client";

/**
 * Visible Todos filters. The URL holds the applied values; the search box is
 * the only control that waits 300 ms after the last keystroke before writing.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import type { CategoryDto } from "../../classification/contracts/category";
import type { TagDto } from "../../classification/contracts/tag";
import { Button } from "../../../shared/ui/button";
import { Field } from "../../../shared/ui/field";
import { Input } from "../../../shared/ui/input";
import { MultiSelect } from "../../../shared/ui/multi-select";
import {
  HISTORY_SEARCH_DEBOUNCE_MS,
  emptyHistoryQueryState,
  historyQueryEquals,
  uniqueTagIds,
  withoutHistoryChip,
  type HistoryChip,
  type HistoryQueryState,
} from "../client/history-query-state";
import { DateRangeDialog } from "./date-range-dialog";
import { historyCopy } from "./history-copy";
import { formatLocalDateAsSpanish } from "./transaction-form-schema";

export interface HistoryFiltersProps {
  readonly categories: readonly CategoryDto[];
  readonly disabled?: boolean;
  readonly onChange: (next: HistoryQueryState) => void;
  readonly tags: readonly TagDto[];
  readonly value: HistoryQueryState;
}

export function HistoryFilters({
  categories,
  disabled = false,
  onChange,
  tags,
  value,
}: HistoryFiltersProps) {
  const [draftQ, setDraftQ] = useState(value.q);
  const [syncedQ, setSyncedQ] = useState(value.q);
  const valueRef = useRef(value);

  if (value.q !== syncedQ) {
    setSyncedQ(value.q);
    setDraftQ(value.q);
  }

  useEffect(() => {
    valueRef.current = value;
  });

  useEffect(() => {
    const nextQ = draftQ.trim();
    if (nextQ === valueRef.current.q) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      onChange({ ...valueRef.current, q: nextQ });
    }, HISTORY_SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [draftQ, onChange]);

  const chips = useMemo(
    () => historyChips(value, categories, tags),
    [categories, tags, value],
  );

  const categoryOptions = categories.filter(
    (category) =>
      value.type === null ||
      category.type === value.type ||
      category.id === value.categoryId,
  );

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-4">
      <div
        aria-label={historyCopy.filtersLabel}
        className="flex w-full max-w-full min-w-0 flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end"
        role="group"
      >
        <div className="min-w-0 flex-1 sm:max-w-sm">
          <Field id="history-search" label={historyCopy.searchLabel}>
            <Input
              autoComplete="off"
              disabled={disabled}
              onChange={(event) => {
                setDraftQ(event.target.value);
              }}
              placeholder={historyCopy.searchPlaceholder}
              type="search"
              value={draftQ}
            />
          </Field>
        </div>
        <div className="min-w-0 sm:w-56">
          <DateRangeDialog
            disabled={disabled}
            onApply={(range) => {
              onChange({
                ...value,
                dateFrom: range.dateFrom,
                dateTo: range.dateTo,
              });
            }}
            value={{ dateFrom: value.dateFrom, dateTo: value.dateTo }}
          />
        </div>
        <div className="min-w-0 sm:w-48">
          <Field id="history-type" label={historyCopy.typeLabel}>
            <select
              className="border-border bg-surface-raised text-text h-14 min-h-14 w-full max-w-full rounded-md border px-4"
              disabled={disabled}
              id="history-type"
              onChange={(event) => {
                const nextType =
                  event.target.value === "expense" ||
                  event.target.value === "income"
                    ? event.target.value
                    : null;
                const selectedCategory = categories.find(
                  (category) => category.id === value.categoryId,
                );
                const categoryStillFits =
                  selectedCategory === undefined ||
                  nextType === null ||
                  selectedCategory.type === nextType;

                onChange({
                  ...value,
                  type: nextType,
                  categoryId: categoryStillFits ? value.categoryId : null,
                });
              }}
              value={value.type ?? ""}
            >
              <option value="">{historyCopy.typeAll}</option>
              <option value="expense">{historyCopy.expense}</option>
              <option value="income">{historyCopy.income}</option>
            </select>
          </Field>
        </div>
        <div className="min-w-0 sm:w-56">
          <Field id="history-category" label={historyCopy.categoryLabel}>
            <select
              className="border-border bg-surface-raised text-text h-14 min-h-14 w-full max-w-full rounded-md border px-4"
              disabled={disabled}
              id="history-category"
              onChange={(event) => {
                onChange({
                  ...value,
                  categoryId:
                    event.target.value === "" ? null : event.target.value,
                });
              }}
              value={value.categoryId ?? ""}
            >
              <option value="">{historyCopy.categoryAll}</option>
              {categoryOptions.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="min-w-0 sm:w-56">
          <MultiSelect
            archivedBehavior="selectable"
            onChange={(tagIds) => {
              onChange({ ...value, tagIds: uniqueTagIds(tagIds) });
            }}
            options={tags.map((tag) => ({
              archived: tag.isArchived,
              id: tag.id,
              label: tag.name,
            }))}
            title={historyCopy.tagsFilterTitle}
            triggerLabel={historyCopy.tagsFilterLabel}
            value={value.tagIds}
          />
        </div>
      </div>
      {chips.length > 0 ? (
        <div className="flex w-full max-w-full min-w-0 flex-col gap-2">
          <p className="text-caption text-text-muted">
            {historyCopy.chipsLabel}
          </p>
          <ul
            aria-label={historyCopy.chipsLabel}
            className="flex w-full max-w-full min-w-0 flex-wrap gap-2"
          >
            {chips.map((chip) => (
              <li key={chipKey(chip)}>
                <button
                  aria-label={historyCopy.removeFilter(chip.label)}
                  className="border-border text-body-sm text-text hover:bg-surface-hover min-h-11 rounded-full border px-3"
                  onClick={() => {
                    onChange(withoutHistoryChip(value, chip));
                  }}
                  type="button"
                >
                  {chip.label}
                  <span aria-hidden="true"> ×</span>
                </button>
              </li>
            ))}
          </ul>
          <Button
            className="w-auto"
            disabled={disabled}
            onClick={() => {
              if (!historyQueryEquals(value, emptyHistoryQueryState)) {
                onChange(emptyHistoryQueryState);
              }
            }}
            variant="secondary"
          >
            {historyCopy.clearFilters}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function historyChips(
  state: HistoryQueryState,
  categories: readonly CategoryDto[],
  tags: readonly TagDto[],
): readonly HistoryChip[] {
  const chips: HistoryChip[] = [];

  if (state.q !== "") {
    chips.push({ kind: "q", label: historyCopy.searchChip(state.q) });
  }

  if (state.dateFrom !== null) {
    chips.push({
      kind: "dateFrom",
      label: historyCopy.dateFromChip(formatLocalDateAsSpanish(state.dateFrom)),
    });
  }

  if (state.dateTo !== null) {
    chips.push({
      kind: "dateTo",
      label: historyCopy.dateToChip(formatLocalDateAsSpanish(state.dateTo)),
    });
  }

  if (state.type !== null) {
    chips.push({
      kind: "type",
      label:
        state.type === "expense" ? historyCopy.expense : historyCopy.income,
    });
  }

  if (state.categoryId !== null) {
    chips.push({
      kind: "category",
      label:
        categories.find((category) => category.id === state.categoryId)?.name ??
        state.categoryId,
    });
  }

  for (const tagId of uniqueTagIds(state.tagIds)) {
    chips.push({
      kind: "tag",
      tagId,
      label: tags.find((tag) => tag.id === tagId)?.name ?? tagId,
    });
  }

  return chips;
}

function chipKey(chip: HistoryChip): string {
  return chip.kind === "tag" ? `tag:${chip.tagId}` : chip.kind;
}
