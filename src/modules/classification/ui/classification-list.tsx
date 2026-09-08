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
 * while one of the two is empty. Active rows of one type can move up or down;
 * a failed order save restores the previous sequence. Archive asks for
 * confirmation and never hides a row that the server refused with 409.
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
import { OrderControls } from "./order-controls";
import {
  activeItemIds,
  moveActiveItem,
  orderControlsCopy,
} from "./order-model";
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

function categoryOrdersEqual(
  left: readonly CategoryDto[],
  right: readonly CategoryDto[],
): boolean {
  return (
    left.length === right.length &&
    left.every((item, index) => item.id === right[index]?.id)
  );
}

function countArchived(
  items: readonly { readonly isArchived: boolean }[],
): number {
  return items.filter((item) => item.isArchived).length;
}

function replaceTypeOrder(
  categories: readonly CategoryDto[],
  type: TransactionType,
  nextOfType: readonly CategoryDto[],
): CategoryDto[] {
  const result: CategoryDto[] = [];
  let replaced = false;

  for (const item of categories) {
    if (item.type !== type) {
      result.push(item);
      continue;
    }

    if (!replaced) {
      result.push(...nextOfType);
      replaced = true;
    }
  }

  if (!replaced) {
    result.push(...nextOfType);
  }

  return result;
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
  readonly onMove: (category: CategoryDto, direction: -1 | 1) => void;
  readonly onRename: (category: CategoryDto) => void;
  readonly onRetryOrder?: () => void;
  readonly orderError?: string;
  readonly orderPending: boolean;
  readonly title: string;
}

function CategoryTypeSection({
  categories,
  emptyLabel,
  headingId,
  onArchive,
  onMove,
  onRename,
  onRetryOrder,
  orderError,
  orderPending,
  title,
}: CategoryTypeSectionProps) {
  const archived = countArchived(categories);
  const active = categories.filter((category) => !category.isArchived);

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
      {orderError ? (
        <div
          role="alert"
          className="border-danger bg-surface-raised mt-3 flex w-full max-w-full flex-col items-start gap-3 rounded-lg border p-4"
        >
          <p className="text-body-sm text-text">{orderError}</p>
          {onRetryOrder ? (
            <Button
              aria-label={orderControlsCopy.retry}
              variant="secondary"
              onClick={onRetryOrder}
            >
              {classificationCopy.retry}
            </Button>
          ) : null}
        </div>
      ) : null}
      {categories.length === 0 ? (
        <p className="text-body-sm text-text-muted mt-3">{emptyLabel}</p>
      ) : (
        <ul
          aria-labelledby={headingId}
          className="mt-3 flex w-full max-w-full min-w-0 flex-col gap-2"
        >
          {categories.map((category) => {
            const activeIndex = active.findIndex(
              (item) => item.id === category.id,
            );

            return (
              <li
                key={category.id}
                className="border-border bg-surface-raised flex min-h-14 w-full max-w-full min-w-0 flex-wrap items-center gap-3 rounded-md border p-3"
              >
                <CategoryIcon categoryId={category.id} />
                <span className="text-body text-text min-w-0 flex-1 break-words">
                  {category.name}
                </span>
                {category.isArchived ? <ArchivedBadge /> : null}
                {!category.isArchived ? (
                  <OrderControls
                    canMoveDown={activeIndex < active.length - 1}
                    canMoveUp={activeIndex > 0}
                    disabled={orderPending}
                    name={category.name}
                    onMoveDown={() => {
                      onMove(category, 1);
                    }}
                    onMoveUp={() => {
                      onMove(category, -1);
                    }}
                  />
                ) : null}
                <Button
                  aria-label={renameCategoryLabel(category.name)}
                  className="w-auto shrink-0 px-4"
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
                    className="w-auto shrink-0 px-4"
                    variant="danger"
                    onClick={() => {
                      onArchive(category);
                    }}
                  >
                    {classificationCopy.archiveAction}
                  </Button>
                ) : null}
              </li>
            );
          })}
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
  onMove,
  onRename,
  onRetryOrder,
  orderError,
  orderErrorType,
  orderPending,
}: {
  categories: readonly CategoryDto[];
  onArchive: (category: CategoryDto) => void;
  onMove: (category: CategoryDto, direction: -1 | 1) => void;
  onRename: (category: CategoryDto) => void;
  onRetryOrder?: () => void;
  orderError?: string;
  orderErrorType?: TransactionType;
  orderPending: boolean;
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
        onMove={onMove}
        onRename={onRename}
        onRetryOrder={orderErrorType === "expense" ? onRetryOrder : undefined}
        orderError={orderErrorType === "expense" ? orderError : undefined}
        orderPending={orderPending}
        title={classificationCopy.expenseTitle}
      />
      <CategoryTypeSection
        categories={grouped.income}
        emptyLabel={classificationCopy.incomeEmpty}
        headingId="categories-income-heading"
        onArchive={onArchive}
        onMove={onMove}
        onRename={onRename}
        onRetryOrder={orderErrorType === "income" ? onRetryOrder : undefined}
        orderError={orderErrorType === "income" ? orderError : undefined}
        orderPending={orderPending}
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
            className="border-border bg-surface-raised text-body-sm text-text flex min-h-11 max-w-full min-w-0 items-center gap-2 rounded-full border px-4"
          >
            <span className="min-w-0 break-words">{tag.name}</span>
            {tag.isArchived ? <ArchivedBadge /> : null}
            <Button
              aria-label={renameTagLabel(tag.name)}
              className="h-11 min-h-11 w-auto shrink-0 px-3 text-sm"
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
                className="h-11 min-h-11 w-auto shrink-0 px-3 text-sm"
                variant="danger"
                onClick={() => {
                  onArchive(tag);
                }}
              >
                {classificationCopy.archiveAction}
              </Button>
            ) : null}
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

interface PendingReorder {
  readonly type: TransactionType;
  readonly categories: readonly CategoryDto[];
}

/** Renders the category catalog and the tag view of the management page. */
export function ClassificationList({
  api = defaultClassificationApi,
}: ClassificationListProps = {}) {
  const { announceSuccessfulMutation, revision, refreshEpoch } =
    useFinancialDataRevision();
  const [categoryDialog, setCategoryDialog] =
    useState<CategoryDialogMode | null>(null);
  const [tagDialog, setTagDialog] = useState<TagDialogMode | null>(null);
  const [archiveKind, setArchiveKind] = useState<ArchiveDialogKind>("category");
  const [archiveTarget, setArchiveTarget] =
    useState<ArchiveDialogTarget | null>(null);
  const [categoryDraft, setCategoryDraft] = useState<
    readonly CategoryDto[] | null
  >(null);
  const [orderPhase, setOrderPhase] = useState<"idle" | "saving">("idle");
  const [orderError, setOrderError] = useState<string | undefined>();
  const [failedReorder, setFailedReorder] = useState<PendingReorder | null>(
    null,
  );
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

  if (
    categoryDraft !== null &&
    categories.status === "ready" &&
    categories.data !== undefined &&
    categoryOrdersEqual(categoryDraft, categories.data)
  ) {
    setCategoryDraft(null);
  }

  const orderBusy = orderPhase === "saving";
  const displayedCategories = categoryDraft ?? categories.data ?? [];

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

  async function saveOrder(
    type: TransactionType,
    nextCategories: readonly CategoryDto[],
  ) {
    const ofType = nextCategories.filter((category) => category.type === type);
    setCategoryDraft(nextCategories);
    setOrderPhase("saving");
    setOrderError(undefined);
    setFailedReorder(null);

    const result = await api.reorderCategories({
      type,
      orderedCategoryIds: [...activeItemIds(ofType)],
    });

    if (result.ok) {
      setOrderPhase("idle");
      announceSuccessfulMutation();
      return;
    }

    setOrderPhase("idle");
    setCategoryDraft(null);
    setOrderError(orderControlsCopy.saveFailed);
    setFailedReorder({ type, categories: nextCategories });
  }

  function handleMove(category: CategoryDto, direction: -1 | 1) {
    if (orderBusy) {
      return;
    }

    const ofType = displayedCategories.filter(
      (item) => item.type === category.type,
    );
    const moved = moveActiveItem(ofType, category.id, direction);

    if (moved === null) {
      return;
    }

    void saveOrder(
      category.type,
      replaceTypeOrder(displayedCategories, category.type, moved),
    );
  }

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
        {categories.status === "ready" || categoryDraft !== null ? (
          <CategoryCatalog
            categories={displayedCategories}
            onArchive={(category) => {
              setArchiveKind("category");
              setArchiveTarget({ id: category.id, name: category.name });
            }}
            onMove={handleMove}
            onRename={(category) => {
              setCategoryDialog({ kind: "rename", category });
            }}
            onRetryOrder={() => {
              if (failedReorder) {
                void saveOrder(failedReorder.type, failedReorder.categories);
              }
            }}
            orderError={orderError}
            orderErrorType={failedReorder?.type}
            orderPending={orderBusy}
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
