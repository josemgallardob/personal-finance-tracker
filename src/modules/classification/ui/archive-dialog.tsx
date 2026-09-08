"use client";

/**
 * Archive confirmation for a category or a tag.
 *
 * Archiving is how the product keeps history: the row stays readable and
 * cannot be assigned to new movements. A 409 stays on this dialog with an
 * action that opens the history of that item; the catalog is not emptied
 * around it. Active-recurrence detail remains REC-04.
 */

import { useState } from "react";

import {
  createApiClient,
  type ApiClientFailure,
} from "../../../shared/client/api-client";
import { useFinancialDataRevision } from "../../../shared/client/financial-data-provider";
import { Button } from "../../../shared/ui/button";
import { DialogShell } from "../../../shared/ui/dialog";
import { ErrorSummary } from "../../../shared/ui/error-summary";
import {
  createClassificationApi,
  type ClassificationApi,
} from "../client/classification-api";
import { classificationFailureMessage } from "./classification-copy";

const defaultClassificationApi = createClassificationApi(createApiClient());

export const archiveDialogCopy = {
  cancel: "Cancelar",
  confirm: "Archivar",
  categoryTitle: (name: string) => `¿Archivar ${name}?`,
  tagTitle: (name: string) => `¿Archivar ${name}?`,
  categoryDescription: (name: string) =>
    `${name} dejará de poder asignarse a movimientos nuevos. El histórico y los importes asociados se conservan.`,
  tagDescription: (name: string) =>
    `${name} dejará de poder añadirse a movimientos nuevos. El histórico que ya la usa se conserva.`,
  alreadyArchivedCategory:
    "Esta categoría ya está archivada. Sigue visible para conservar el histórico.",
  alreadyArchivedTag:
    "Esta etiqueta ya está archivada. Sigue visible para conservar el histórico.",
  conflictCategory:
    "No se ha podido archivar la categoría. Revisa los movimientos asociados antes de reintentar.",
  conflictTag:
    "No se ha podido archivar la etiqueta. Revisa los movimientos asociados antes de reintentar.",
  viewCategoryHistory: (name: string) => `Ver movimientos de ${name}`,
  viewTagHistory: (name: string) => `Ver movimientos con ${name}`,
} as const;

export type ArchiveDialogKind = "category" | "tag";

export interface ArchiveDialogTarget {
  readonly id: string;
  readonly name: string;
}

export interface ConfirmArchiveDialogProps {
  readonly api?: ClassificationApi;
  readonly kind: ArchiveDialogKind;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSaved?: (focusId: string) => void;
  readonly open: boolean;
  readonly target: ArchiveDialogTarget | null;
}

export function historyHref(kind: ArchiveDialogKind, id: string): string {
  if (kind === "category") {
    return `/transactions?categoryId=${encodeURIComponent(id)}`;
  }

  return `/transactions?tagId=${encodeURIComponent(id)}`;
}

export function archiveConflictCopy(
  kind: ArchiveDialogKind,
  failure: ApiClientFailure,
): { readonly message: string; readonly showHistory: boolean } {
  if (failure.reason !== "api" || failure.status !== 409) {
    return {
      message: classificationFailureMessage(failure),
      showHistory: false,
    };
  }

  const alreadyArchived = failure.error.details?.some(
    (detail) => detail.code === "alreadyArchived",
  );

  if (alreadyArchived) {
    return {
      message:
        kind === "category"
          ? archiveDialogCopy.alreadyArchivedCategory
          : archiveDialogCopy.alreadyArchivedTag,
      showHistory: true,
    };
  }

  return {
    message:
      kind === "category"
        ? archiveDialogCopy.conflictCategory
        : archiveDialogCopy.conflictTag,
    showHistory: true,
  };
}

export function ConfirmArchiveDialog({
  api = defaultClassificationApi,
  kind,
  onOpenChange,
  onSaved,
  open,
  target,
}: ConfirmArchiveDialogProps) {
  const { announceSuccessfulMutation } = useFinancialDataRevision();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [showHistory, setShowHistory] = useState(false);

  const name = target?.name ?? "";
  const title =
    kind === "category"
      ? archiveDialogCopy.categoryTitle(name)
      : archiveDialogCopy.tagTitle(name);
  const description =
    kind === "category"
      ? archiveDialogCopy.categoryDescription(name)
      : archiveDialogCopy.tagDescription(name);
  const historyLabel =
    kind === "category"
      ? archiveDialogCopy.viewCategoryHistory(name)
      : archiveDialogCopy.viewTagHistory(name);

  function requestClose() {
    if (pending) {
      return;
    }

    setError(undefined);
    setShowHistory(false);
    onOpenChange(false);
  }

  async function handleConfirm() {
    if (pending || target === null) {
      return;
    }

    setPending(true);
    setError(undefined);
    setShowHistory(false);

    const result =
      kind === "category"
        ? await api.archiveCategory(target.id)
        : await api.archiveTag(target.id);

    setPending(false);

    if (result.ok) {
      onSaved?.(target.id);
      onOpenChange(false);
      announceSuccessfulMutation();
      return;
    }

    const mapped = archiveConflictCopy(kind, result);
    setError(mapped.message);
    setShowHistory(mapped.showHistory);
  }

  return (
    <DialogShell
      description={description}
      footer={
        <>
          <Button disabled={pending} variant="secondary" onClick={requestClose}>
            {archiveDialogCopy.cancel}
          </Button>
          <Button
            pending={pending}
            variant="danger"
            onClick={() => {
              void handleConfirm();
            }}
          >
            {archiveDialogCopy.confirm}
          </Button>
        </>
      }
      open={open && target !== null}
      preventClose={pending}
      showCloseButton={false}
      title={title}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          requestClose();
        }
      }}
    >
      {error ? <ErrorSummary errors={[{ message: error }]} /> : null}
      {showHistory && target !== null ? (
        <a
          href={historyHref(kind, target.id)}
          className="border-border text-body-sm text-text mt-3 inline-flex min-h-11 items-center rounded-full border px-4 underline underline-offset-2"
        >
          {historyLabel}
        </a>
      ) : null}
    </DialogShell>
  );
}
