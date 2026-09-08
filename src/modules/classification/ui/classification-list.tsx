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
 * while one of the two is empty.
 */

import { useMemo } from "react";

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
import { CategoryIcon } from "./category-icon";
import {
  activeArchivedSummary,
  classificationCopy,
  classificationFailureMessage,
} from "./classification-copy";

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
  readonly title: string;
}

function CategoryTypeSection({
  categories,
  emptyLabel,
  headingId,
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
          className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2"
        >
          {categories.map((category) => (
            <li
              key={category.id}
              className="border-border bg-surface-raised flex min-h-14 w-full max-w-full min-w-0 items-center gap-3 rounded-md border p-3"
            >
              <CategoryIcon categoryId={category.id} />
              <span className="text-body text-text min-w-0 flex-1 break-words">
                {category.name}
              </span>
              {category.isArchived ? <ArchivedBadge /> : null}
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
}: {
  categories: readonly CategoryDto[];
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
        title={classificationCopy.expenseTitle}
      />
      <CategoryTypeSection
        categories={grouped.income}
        emptyLabel={classificationCopy.incomeEmpty}
        headingId="categories-income-heading"
        title={classificationCopy.incomeTitle}
      />
    </div>
  );
}

function TagCatalog({ tags }: { tags: readonly TagDto[] }) {
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

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-8">
      <section
        aria-labelledby="categories-heading"
        className="flex w-full max-w-full min-w-0 flex-col gap-4"
      >
        <h2
          id="categories-heading"
          className="text-heading-sm text-text font-medium"
        >
          {classificationCopy.categoriesTitle}
        </h2>
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
          <CategoryCatalog categories={categories.data ?? []} />
        ) : null}
      </section>

      <section
        aria-labelledby="tags-heading"
        className="flex w-full max-w-full min-w-0 flex-col gap-4"
      >
        <h2 id="tags-heading" className="text-heading-sm text-text font-medium">
          {classificationCopy.tagsTitle}
        </h2>
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
        {tags.status === "ready" ? <TagCatalog tags={tags.data ?? []} /> : null}
      </section>
    </div>
  );
}
