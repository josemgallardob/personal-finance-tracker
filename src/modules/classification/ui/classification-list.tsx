"use client";

/**
 * Category and tag management view.
 *
 * The screen reads the two documented collections through the browser
 * adapters, with `status: "all"` so archived rows stay visible: archiving is
 * how the product keeps a category that already has movements, and hiding it
 * here would suggest it was deleted. Categories and tags load independently,
 * so a failure in one collection never blanks the other, and each one keeps
 * its own loading, error, retry and empty state.
 *
 * The type of a category is immutable, so expense and income are separate
 * lists with their own headings and counts. Nothing merges them, not even
 * while one of the two is empty. Archive asks for confirmation and never hides
 * a row that the server refused with 409.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import { createApiClient } from "../../../shared/client/api-client";
import { useFinancialDataRevision } from "../../../shared/client/financial-data-provider";
import { useResource } from "../../../shared/client/use-resource";
import { Button } from "../../../shared/ui/button";
import { EmptyState } from "../../../shared/ui/empty-state";
import { LoadingState } from "../../../shared/ui/loading-state";
import type { TransactionType } from "../../transactions/domain/transaction-type";
import {
  createClassificationApi,
  type ClassificationApi,
} from "../client/classification-api";
import type { CategoryDto } from "../contracts/category";
import type { TagDto } from "../contracts/tag";
import {
  ConfirmArchiveDialog,
  type ArchiveDialogKind,
  type ArchiveDialogTarget,
} from "./archive-dialog";
import { CategoryDialog, type CategoryDialogMode } from "./category-dialog";
import { CategoryIcon } from "./category-icon";
import {
  activeArchivedSummary,
  archiveCategoryLabel,
  archiveTagLabel,
  classificationCopy,
  classificationFailureMessage,
  renameCategoryLabel,
  renameTagLabel,
} from "./classification-copy";
import { TagDialog, type TagDialogMode } from "./tag-dialog";

const CATEGORY_REQUEST_KEY = "classification:categories:all";
const TAG_REQUEST_KEY = "classification:tags:all";

const defaultClassificationApi = createClassificationApi(createApiClient());

/** Splits a catalog into the two immutable types, preserving server order. */
export function groupCategoriesByType(
  categories: readonly CategoryDto[],
): Readonly<Record<TransactionType, readonly CategoryDto[]>> {
  return {
    expense: categories.filter((category) => category.type === "expense"),
    income: categories.filter((category) => category.type === "income"),
  };
}

function countArchived(
  items: readonly { readonly isArchived: boolean }[],
): number {
  return items.filter((item) => item.isArchived).length;
}

function ArchivedBadge() {
  return (
    <span className="border-border text-caption text-text-muted rounded-full border px-2 py-0.5">
      {classificationCopy.archivedBadge}
    </span>
  );
}

interface LoadFailureProps {
  readonly title: string;
  readonly message: string;
  readonly retryLabel: string;
  readonly onRetry: () => void;
}

function LoadFailure({
  title,
  message,
  retryLabel,
  onRetry,
}: LoadFailureProps) {
  return (
    <div
      role="alert"
      className="border-danger bg-surface-raised flex w-full max-w-full flex-col items-start gap-3 rounded-lg border p-4 sm:p-6"
    >
      <p className="text-body text-text font-medium">{title}</p>
      <p className="text-body-sm text-text-muted max-w-xl">{message}</p>
      <Button aria-label={retryLabel} onClick={onRetry} variant="secondary">
        {classificationCopy.retry}
      </Button>
    </div>
  );
}

interface CategoryTypeSectionProps {
  readonly categories: readonly CategoryDto[];
  readonly emptyLabel: string;
  readonly headingId: string;
  readonly onArchive: (category: CategoryDto) => void;
  readonly onRename: (category: CategoryDto) => void;
  readonly title: string;
}

function CategoryTypeSection({
  categories,
  emptyLabel,
  headingId,
  onArchive,
  onRename,
  title,
}: CategoryTypeSectionProps) {
  const archived = countArchived(categories);

  return (
    <section aria-labelledby={headingId} className="w-full max-w-full min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 id={headingId} className="text-body-lg text-text font-medium">
          {title}
        </h3>
        <p className="text-caption text-text-muted">
          {activeArchivedSummary(categories.length - archived, archived)}
        </p>
      </div>
      {categories.length === 0 ? (
        <p className="text-body-sm text-text-muted mt-3">{emptyLabel}</p>
      ) : (
        <ul
          aria-labelledby={headingId}
          className="mt-3 flex w-full max-w-full min-w-0 flex-col gap-2"
        >
          {categories.map((category) => (
            <li
              key={category.id}
              className="border-border bg-surface-raised flex min-h-14 w-full max-w-full min-w-0 flex-col items-stretch gap-3 rounded-md border p-3 sm:flex-row sm:items-center"
            >
              <div className="flex min-w-0 items-center gap-3 sm:flex-1">
                <CategoryIcon categoryId={category.id} />
                <span className="text-body text-text min-w-0 flex-1 break-words">
                  {category.name}
                </span>
                {category.isArchived ? <ArchivedBadge /> : null}
              </div>
              <div className="flex w-full min-w-0 gap-2 sm:w-auto sm:shrink-0">
                <Button
                  aria-label={renameCategoryLabel(category.name)}
                  className="min-w-0 flex-1 px-4 sm:w-auto sm:flex-none"
                  data-classification-focus={category.id}
                  onClick={() => {
                    onRename(category);
                  }}
                  variant="secondary"
                >
                  {classificationCopy.renameAction}
                </Button>
                {!category.isArchived ? (
                  <Button
                    aria-label={archiveCategoryLabel(category.name)}
                    className="min-w-0 flex-1 px-4 sm:w-auto sm:flex-none"
                    variant="danger"
                    onClick={() => {
                      onArchive(category);
                    }}
                  >
                    {classificationCopy.archiveAction}
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {archived > 0 ? (
        <p className="text-caption text-text-muted mt-3 max-w-xl">
          {classificationCopy.categoriesArchivedNote}
        </p>
      ) : null}
    </section>
  );
}

function CategoryCatalog({
  categories,
  onArchive,
  onRename,
}: {
  categories: readonly CategoryDto[];
  onArchive: (category: CategoryDto) => void;
  onRename: (category: CategoryDto) => void;
}) {
  const grouped = useMemo(
    () => groupCategoriesByType(categories),
    [categories],
  );

  if (categories.length === 0) {
    return (
      <EmptyState
        title={classificationCopy.categoriesEmptyTitle}
        description={classificationCopy.categoriesEmptyDescription}
      />
    );
  }

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <CategoryTypeSection
        categories={grouped.expense}
        emptyLabel={classificationCopy.expenseEmpty}
        headingId="categories-expense-heading"
        onArchive={onArchive}
        onRename={onRename}
        title={classificationCopy.expenseTitle}
      />
      <CategoryTypeSection
        categories={grouped.income}
        emptyLabel={classificationCopy.incomeEmpty}
        headingId="categories-income-heading"
        onArchive={onArchive}
        onRename={onRename}
        title={classificationCopy.incomeTitle}
      />
    </div>
  );
}

function TagCatalog({
  tags,
  onArchive,
  onRename,
}: {
  tags: readonly TagDto[];
  onArchive: (tag: TagDto) => void;
  onRename: (tag: TagDto) => void;
}) {
  const archived = countArchived(tags);

  if (tags.length === 0) {
    return (
      <EmptyState
        title={classificationCopy.tagsEmptyTitle}
        description={classificationCopy.tagsEmptyDescription}
      />
    );
  }

  return (
    <div className="w-full max-w-full min-w-0">
      <p className="text-caption text-text-muted">
        {activeArchivedSummary(tags.length - archived, archived)}
      </p>
      <ul
        aria-labelledby="tags-heading"
        className="mt-3 flex w-full max-w-full flex-wrap gap-2"
      >
        {tags.map((tag) => (
          <li
            key={tag.id}
            className="border-border bg-surface-raised text-body-sm text-text flex min-h-11 w-full max-w-full min-w-0 flex-col items-stretch gap-3 rounded-md border p-3 sm:w-auto sm:flex-row sm:items-center sm:rounded-full sm:px-4"
          >
            <div className="flex min-w-0 items-center gap-2 sm:flex-1">
              <span className="min-w-0 flex-1 break-words">{tag.name}</span>
              {tag.isArchived ? <ArchivedBadge /> : null}
            </div>
            <div className="flex w-full min-w-0 gap-2 sm:w-auto sm:shrink-0">
              <Button
                aria-label={renameTagLabel(tag.name)}
                className="h-11 min-h-11 min-w-0 flex-1 px-3 text-sm sm:w-auto sm:flex-none"
                data-classification-focus={tag.id}
                onClick={() => {
                  onRename(tag);
                }}
                variant="secondary"
              >
                {classificationCopy.renameAction}
              </Button>
              {!tag.isArchived ? (
                <Button
                  aria-label={archiveTagLabel(tag.name)}
                  className="h-11 min-h-11 min-w-0 flex-1 px-3 text-sm sm:w-auto sm:flex-none"
                  variant="danger"
                  onClick={() => {
                    onArchive(tag);
                  }}
                >
                  {classificationCopy.archiveAction}
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {archived > 0 ? (
        <p className="text-caption text-text-muted mt-3 max-w-xl">
          {classificationCopy.tagsArchivedNote}
        </p>
      ) : null}
    </div>
  );
}

export interface ClassificationListProps {
  /**
   * Adapter used to reach the documented endpoints. The default talks to the
   * current origin; a test supplies the same adapter over a replaced `fetch`.
   */
  readonly api?: ClassificationApi;
}

/** Renders the category catalog and the tag view of the management page. */
export function ClassificationList({
  api = defaultClassificationApi,
}: ClassificationListProps = {}) {
  const { revision, refreshEpoch } = useFinancialDataRevision();
  const [categoryDialog, setCategoryDialog] =
    useState<CategoryDialogMode | null>(null);
  const [tagDialog, setTagDialog] = useState<TagDialogMode | null>(null);
  const [archiveKind, setArchiveKind] = useState<ArchiveDialogKind>("category");
  const [archiveTarget, setArchiveTarget] =
    useState<ArchiveDialogTarget | null>(null);
  const restoreFocusId = useRef<string | null>(null);

  const categories = useResource<readonly CategoryDto[]>({
    load: (signal) => api.listCategories({ status: "all" }, { signal }),
    requestKey: CATEGORY_REQUEST_KEY,
    revision,
    refreshEpoch,
  });

  const tags = useResource<readonly TagDto[]>({
    load: (signal) => api.listTags({ status: "all" }, { signal }),
    requestKey: TAG_REQUEST_KEY,
    revision,
    refreshEpoch,
  });

  const displayedCategories = categories.data ?? [];

  useEffect(() => {
    const focusId = restoreFocusId.current;
    if (
      focusId === null ||
      categories.status !== "ready" ||
      tags.status !== "ready"
    ) {
      return;
    }

    const target = document.querySelector<HTMLButtonElement>(
      `[data-classification-focus="${CSS.escape(focusId)}"]`,
    );
    if (target === null) {
      return;
    }

    restoreFocusId.current = null;
    target.focus();
  }, [categories.data, categories.status, tags.data, tags.status]);

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-8">
      <section
        aria-labelledby="categories-heading"
        className="flex w-full max-w-full min-w-0 flex-col gap-4"
      >
        <div className="flex w-full max-w-full min-w-0 flex-wrap items-center justify-between gap-3">
          <h2
            id="categories-heading"
            className="text-heading-sm text-text font-medium"
          >
            {classificationCopy.categoriesTitle}
          </h2>
          <Button
            onClick={() => {
              setCategoryDialog({ kind: "create" });
            }}
          >
            {classificationCopy.createCategory}
          </Button>
        </div>
        {categories.status === "loading" ? (
          <LoadingState label={classificationCopy.categoriesLoading} />
        ) : null}
        {categories.status === "error" && categories.error !== undefined ? (
          <LoadFailure
            title={classificationCopy.categoriesErrorTitle}
            message={classificationFailureMessage(categories.error)}
            retryLabel={classificationCopy.categoriesRetryLabel}
            onRetry={categories.refetch}
          />
        ) : null}
        {categories.status === "ready" ? (
          <CategoryCatalog
            categories={displayedCategories}
            onArchive={(category) => {
              setArchiveKind("category");
              setArchiveTarget({ id: category.id, name: category.name });
            }}
            onRename={(category) => {
              setCategoryDialog({ kind: "rename", category });
            }}
          />
        ) : null}
      </section>

      <section
        aria-labelledby="tags-heading"
        className="flex w-full max-w-full min-w-0 flex-col gap-4"
      >
        <div className="flex w-full max-w-full min-w-0 flex-wrap items-center justify-between gap-3">
          <h2
            id="tags-heading"
            className="text-heading-sm text-text font-medium"
          >
            {classificationCopy.tagsTitle}
          </h2>
          <Button
            onClick={() => {
              setTagDialog({ kind: "create" });
            }}
            variant="secondary"
          >
            {classificationCopy.createTag}
          </Button>
        </div>
        {tags.status === "loading" ? (
          <LoadingState label={classificationCopy.tagsLoading} />
        ) : null}
        {tags.status === "error" && tags.error !== undefined ? (
          <LoadFailure
            title={classificationCopy.tagsErrorTitle}
            message={classificationFailureMessage(tags.error)}
            retryLabel={classificationCopy.tagsRetryLabel}
            onRetry={tags.refetch}
          />
        ) : null}
        {tags.status === "ready" ? (
          <TagCatalog
            tags={tags.data ?? []}
            onArchive={(tag) => {
              setArchiveKind("tag");
              setArchiveTarget({ id: tag.id, name: tag.name });
            }}
            onRename={(tag) => {
              setTagDialog({ kind: "rename", tag });
            }}
          />
        ) : null}
      </section>

      <CategoryDialog
        api={api}
        existingCategories={displayedCategories}
        mode={categoryDialog}
        open={categoryDialog !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setCategoryDialog(null);
          }
        }}
        onSaved={(focusId) => {
          restoreFocusId.current = focusId ?? null;
        }}
      />
      <TagDialog
        api={api}
        existingTags={tags.data ?? []}
        mode={tagDialog}
        open={tagDialog !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setTagDialog(null);
          }
        }}
        onSaved={(focusId) => {
          restoreFocusId.current = focusId ?? null;
        }}
      />
      <ConfirmArchiveDialog
        api={api}
        kind={archiveKind}
        open={archiveTarget !== null}
        target={archiveTarget}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setArchiveTarget(null);
          }
        }}
        onSaved={(focusId) => {
          restoreFocusId.current = focusId;
        }}
      />
    </div>
  );
}
