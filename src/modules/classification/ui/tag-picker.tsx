"use client";

import { useId, useMemo, useState, type KeyboardEvent } from "react";

import type { TagInput } from "../../transactions/contracts/http";
import { MAX_TAG_NAME_LENGTH } from "../domain/tag";
import type { TagDto } from "../contracts/tag";
import { Button } from "../../../shared/ui/button";
import { Field } from "../../../shared/ui/field";
import { Input } from "../../../shared/ui/input";
import {
  areNamesEquivalent,
  characterLength,
  containsControlCharacters,
  nameKey,
  normalizeName,
} from "../../../shared/domain/text";
import { MAX_TAGS_PER_TRANSACTION } from "../../transactions/domain/transaction";

export const tagPickerCopy = {
  add: "Añadir",
  create: "Crear",
  empty: "No hay etiquetas que coincidan",
  hint: "Opcional. Las etiquetas nuevas se guardan solo al confirmar el movimiento.",
  label: "Etiquetas",
  pending: "pendiente",
  placeholder: "Buscar o crear una etiqueta",
  remove: "Quitar",
  selected: "Etiquetas seleccionadas",
  suggestions: "Sugerencias de etiquetas",
} as const;

export type ExistingTagSelection = {
  readonly kind: "existing";
  readonly tagId: string;
  readonly name: string;
};

export type PendingTagSelection = {
  readonly kind: "pending";
  readonly name: string;
};

export type TagSelection = ExistingTagSelection | PendingTagSelection;

export interface TagPickerProps {
  readonly error?: string;
  readonly id?: string;
  readonly onChange: (selections: TagSelection[]) => void;
  readonly retainedTagIds?: readonly string[];
  readonly tags: readonly TagDto[];
  readonly value: readonly TagSelection[];
}

export function isAssignableTag(
  tag: TagDto,
  retainedTagIds: readonly string[] = [],
): boolean {
  return !tag.isArchived || retainedTagIds.includes(tag.id);
}

export function toTagInputs(selections: readonly TagSelection[]): TagInput[] {
  return selections.map((selection) =>
    selection.kind === "existing"
      ? { tagId: selection.tagId }
      : { name: selection.name },
  );
}

export function selectionKey(selection: TagSelection): string {
  if (selection.kind === "existing") {
    return `id:${selection.tagId}`;
  }

  return `name:${nameKey(selection.name)}`;
}

function hasSelection(
  selections: readonly TagSelection[],
  candidate: TagSelection,
): boolean {
  const key = selectionKey(candidate);
  return selections.some((selection) => selectionKey(selection) === key);
}

function validatePendingName(raw: string): string | null {
  const name = normalizeName(raw);

  if (name === "") {
    return null;
  }

  if (characterLength(name) > MAX_TAG_NAME_LENGTH) {
    return null;
  }

  if (containsControlCharacters(name, false)) {
    return null;
  }

  return name;
}

function resolveTypedName(
  raw: string,
  tags: readonly TagDto[],
  retainedTagIds: readonly string[],
): TagSelection | null {
  const name = validatePendingName(raw);

  if (name === null) {
    return null;
  }

  const existing = tags.find(
    (tag) =>
      areNamesEquivalent(tag.name, name) &&
      isAssignableTag(tag, retainedTagIds),
  );

  if (existing) {
    return { kind: "existing", tagId: existing.id, name: existing.name };
  }

  return { kind: "pending", name };
}

export function TagPicker({
  error,
  id,
  onChange,
  retainedTagIds = [],
  tags,
  value,
}: TagPickerProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const listboxId = `${fieldId}-suggestions`;
  const [query, setQuery] = useState("");
  const atLimit = value.length >= MAX_TAGS_PER_TRANSACTION;

  const suggestions = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("es");
    return tags.filter((tag) => {
      if (!isAssignableTag(tag, retainedTagIds)) {
        return false;
      }

      if (
        value.some(
          (selection) =>
            selection.kind === "existing" && selection.tagId === tag.id,
        )
      ) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      return tag.name.toLocaleLowerCase("es").includes(normalizedQuery);
    });
  }, [query, retainedTagIds, tags, value]);

  const typedSelection = resolveTypedName(query, tags, retainedTagIds);
  const canCreatePending =
    typedSelection?.kind === "pending" && !hasSelection(value, typedSelection);

  function addSelection(selection: TagSelection | null) {
    if (!selection || atLimit || hasSelection(value, selection)) {
      return;
    }

    onChange([...value, selection]);
    setQuery("");
  }

  function addFromQuery() {
    addSelection(typedSelection);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      addFromQuery();
    }
  }

  function removeSelection(key: string) {
    onChange(value.filter((selection) => selectionKey(selection) !== key));
  }

  return (
    <Field
      error={error}
      hint={tagPickerCopy.hint}
      id={fieldId}
      label={tagPickerCopy.label}
    >
      <div className="flex w-full max-w-full flex-col gap-2">
        {value.length > 0 ? (
          <ul
            aria-label={tagPickerCopy.selected}
            className="flex w-full max-w-full flex-wrap gap-2"
          >
            {value.map((selection) => {
              const key = selectionKey(selection);
              const label =
                selection.kind === "pending"
                  ? `${selection.name} (${tagPickerCopy.pending})`
                  : selection.name;

              return (
                <li key={key}>
                  <span className="border-border bg-surface-deep inline-flex min-h-11 max-w-full items-center gap-2 rounded-full border px-3">
                    <span className="text-caption text-text">{label}</span>
                    <button
                      aria-label={`${tagPickerCopy.remove} ${label}`}
                      className="text-caption text-text-muted min-h-11 min-w-11"
                      type="button"
                      onClick={() => {
                        removeSelection(key);
                      }}
                    >
                      ×
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : null}
        <div className="flex w-full max-w-full flex-col gap-2 sm:flex-row">
          <Input
            aria-autocomplete="list"
            aria-controls={listboxId}
            aria-expanded={suggestions.length > 0 || canCreatePending}
            autoComplete="off"
            disabled={atLimit}
            placeholder={tagPickerCopy.placeholder}
            role="combobox"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            onKeyDown={handleKeyDown}
          />
          <Button
            disabled={atLimit || typedSelection === null}
            type="button"
            variant="secondary"
            onClick={addFromQuery}
          >
            {canCreatePending ? tagPickerCopy.create : tagPickerCopy.add}
          </Button>
        </div>
        <ul
          aria-label={tagPickerCopy.suggestions}
          id={listboxId}
          role="listbox"
          className="max-h-[min(40vh,16rem)] overflow-y-auto"
        >
          {suggestions.map((tag) => (
            <li key={tag.id} role="presentation">
              <button
                aria-selected={false}
                className="text-body text-text hover:bg-surface-hover flex min-h-11 w-full max-w-full items-center rounded-md px-3 text-left"
                role="option"
                tabIndex={-1}
                type="button"
                onClick={() => {
                  addSelection({
                    kind: "existing",
                    tagId: tag.id,
                    name: tag.name,
                  });
                }}
              >
                {tag.name}
              </button>
            </li>
          ))}
          {canCreatePending && typedSelection ? (
            <li role="presentation">
              <button
                aria-selected={false}
                className="text-body text-text hover:bg-surface-hover flex min-h-11 w-full max-w-full items-center rounded-md px-3 text-left"
                role="option"
                tabIndex={-1}
                type="button"
                onClick={() => {
                  addSelection(typedSelection);
                }}
              >
                {`${tagPickerCopy.create} «${typedSelection.name}»`}
              </button>
            </li>
          ) : null}
          {suggestions.length === 0 && !canCreatePending ? (
            <li className="text-caption text-text-muted px-3 py-2">
              {tagPickerCopy.empty}
            </li>
          ) : null}
        </ul>
      </div>
    </Field>
  );
}
