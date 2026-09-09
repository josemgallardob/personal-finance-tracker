"use client";

/**
 * Todos history of movements.
 *
 * Filters live in the URL. Changing them changes the list request identity, so
 * a slower previous page cannot paint over the current one and accumulated
 * pages from another filter set are discarded. Later cursor pages append
 * through IntersectionObserver with an accessible Cargar más fallback. Desktop
 * uses a compact table; mobile uses stacked rows of the same fields.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { CategoryIcon } from "../../classification/ui/category-icon";
import {
  createApiClient,
  type ApiClient,
} from "../../../shared/client/api-client";
import { useFinancialDataRevision } from "../../../shared/client/financial-data-provider";
import { useResource } from "../../../shared/client/use-resource";
import { Button } from "../../../shared/ui/button";
import { EmptyState, emptyStateCopy } from "../../../shared/ui/empty-state";
import { LoadingState } from "../../../shared/ui/loading-state";
import { cx } from "../../../shared/ui/class-names";
import { createTransactionsApi } from "../client/transactions-api";
import {
  historyQueryRequestKey,
  isHistoryQueryEmpty,
  toTransactionListQuery,
  type HistoryQueryState,
} from "../client/history-query-state";
import { useHistoryQueryState } from "../client/use-history-query-state";
import type { TransactionDto } from "../contracts/transaction";
import { DeleteTransactionDialog } from "./delete-dialog";
import { DuplicateTransactionDialog } from "./duplicate-dialog";
import { EditTransactionDialog } from "./edit-dialog";
import { HistoryFilters } from "./history-filters";
import { historyCopy, HISTORY_LIST_START_ID } from "./history-copy";
import { HistoryPageSentinel } from "./history-page-sentinel";
import { loadHistoryCatalogs } from "./history-load";
import {
  historyCategoryLabel,
  historyDateLabel,
  historyPrimaryLabel,
  historySignedAmount,
  historyTagNames,
  historyTypeLabel,
} from "./history-presentation";
import { HistoryRowMenu, type HistoryRowAction } from "./history-row-menu";
import { apiFailureMessage } from "./transaction-dialog-support";
import {
  useHistoryPages,
  type HistoryPagesSnapshot,
} from "./use-history-pages";

const HISTORY_CATALOGS_KEY = "transactions:history:catalogs";
const DESKTOP_HISTORY_QUERY = "(min-width: 1024px)";

/**
 * True from the `lg` breakpoint, where the compact table replaces stacked rows.
 *
 * The table needs more room than the six columns suggest: the shell already
 * spends 208 px on its side navigation, so below this width the table would
 * push the whole page into a horizontal scroll — exactly what a reader at
 * 200 % zoom sees. Stacked rows carry the same data in one column instead.
 */
export function useDesktopHistoryLayout(): boolean {
  const [isDesktop, setIsDesktop] = useState(() => readDesktopHistoryLayout());

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

  return isDesktop;
}

function readDesktopHistoryLayout(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(DESKTOP_HISTORY_QUERY).matches
  );
}

export interface HistoryListProps {
  /**
   * Browser transport. The default talks to the current origin; tests inject
   * the same client over a replaced `fetch`.
   */
  readonly client?: ApiClient;
  /** Applied filters. Omitted in production; the URL hook supplies them. */
  readonly queryState?: HistoryQueryState;
  readonly onQueryStateChange?: (next: HistoryQueryState) => void;
}

type HistoryDialogMode = HistoryRowAction;

interface HistoryDialogState {
  readonly mode: HistoryDialogMode;
  readonly transactionId: string;
}

/** Renders the Todos history from the real movement and classification APIs. */
export function HistoryList({
  client,
  onQueryStateChange,
  queryState,
}: HistoryListProps = {}) {
  const apiClient = useMemo(() => client ?? createApiClient(), [client]);
  const transactionsApi = useMemo(
    () => createTransactionsApi(apiClient),
    [apiClient],
  );
  const fromUrl = useHistoryQueryState();
  const applied = queryState ?? fromUrl.state;
  const setApplied = onQueryStateChange ?? fromUrl.setState;
  const { revision, refreshEpoch } = useFinancialDataRevision();
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<HistoryDialogState | null>(null);
  const isDesktop = useDesktopHistoryLayout();
  const catalogs = useResource({
    requestKey: HISTORY_CATALOGS_KEY,
    revision,
    refreshEpoch,
    load: (signal) => loadHistoryCatalogs(apiClient, signal),
  });
  const listQuery = toTransactionListQuery(applied);
  const history = useHistoryPages({
    requestKey: historyQueryRequestKey(applied),
    revision,
    refreshEpoch,
    loadPage: (cursor, signal) =>
      transactionsApi.listTransactions(
        cursor === undefined ? listQuery : { ...listQuery, cursor },
        { signal },
      ),
  });

  const handleMenuOpenChange = useCallback(
    (transactionId: string, open: boolean) => {
      setOpenMenuId(open ? transactionId : null);
    },
    [],
  );

  function openDialog(transactionId: string, mode: HistoryDialogMode) {
    setOpenMenuId(null);
    setDialog({ mode, transactionId });
  }

  const categories = catalogs.data?.categories ?? [];
  const tags = catalogs.data?.tags ?? [];
  const snapshotItems = history.items;

  const body = (() => {
    if (history.status === "loading") {
      return <LoadingState label={historyCopy.loading} />;
    }

    if (history.status === "error") {
      return (
        <div
          role="alert"
          className="border-danger bg-surface-raised flex w-full max-w-full flex-col items-start gap-3 rounded-lg border p-4 sm:p-6"
        >
          <p className="text-body text-text font-medium">
            {historyCopy.errorTitle}
          </p>
          <p className="text-body-sm text-text-muted max-w-xl">
            {history.error
              ? apiFailureMessage(history.error, historyCopy.errorHint)
              : historyCopy.errorHint}
          </p>
          <Button
            aria-label={historyCopy.retry}
            onClick={history.refetch}
            variant="secondary"
          >
            {historyCopy.retry}
          </Button>
        </div>
      );
    }

    if (snapshotItems.length === 0) {
      const empty = isHistoryQueryEmpty(applied)
        ? emptyStateCopy.noTransactions
        : emptyStateCopy.noResults;
      return <EmptyState description={empty.description} title={empty.title} />;
    }

    return null;
  })();

  const dialogOpen = dialog !== null;
  const dialogId = dialog?.transactionId ?? null;
  const showRows = history.status === "ready" && snapshotItems.length > 0;

  return (
    <div
      className="flex w-full max-w-full min-w-0 flex-col gap-4"
      id={HISTORY_LIST_START_ID}
      tabIndex={-1}
    >
      <HistoryFilters
        categories={categories}
        onChange={setApplied}
        tags={tags}
        value={applied}
      />
      {body}
      {showRows ? (
        <>
          {isDesktop ? (
            <div
              className="w-full max-w-full min-w-0 overflow-x-auto"
              data-history-layout="desktop"
            >
              <table className="w-full max-w-full min-w-0 border-collapse text-left">
                <caption className="sr-only">{historyCopy.caption}</caption>
                <thead>
                  <tr className="border-border text-caption text-text-muted border-b">
                    <th className="px-3 py-2 font-medium" scope="col">
                      {historyCopy.conceptColumn}
                    </th>
                    <th className="px-3 py-2 font-medium" scope="col">
                      {historyCopy.categoryColumn}
                    </th>
                    <th className="px-3 py-2 font-medium" scope="col">
                      {historyCopy.dateColumn}
                    </th>
                    <th className="px-3 py-2 font-medium" scope="col">
                      {historyCopy.tagsColumn}
                    </th>
                    <th
                      className="px-3 py-2 text-right font-medium"
                      scope="col"
                    >
                      {historyCopy.amountColumn}
                    </th>
                    <th className="px-3 py-2 font-medium" scope="col">
                      {historyCopy.actions}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {snapshotItems.map((transaction) => (
                    <HistoryDesktopRow
                      key={transaction.id}
                      categories={categories}
                      menuOpen={openMenuId === transaction.id}
                      onAction={(action) => {
                        openDialog(transaction.id, action);
                      }}
                      onMenuOpenChange={(open) => {
                        handleMenuOpenChange(transaction.id, open);
                      }}
                      tags={tags}
                      transaction={transaction}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div data-history-layout="mobile">
              <ol
                aria-label={historyCopy.caption}
                className="flex w-full max-w-full flex-col gap-3"
              >
                {snapshotItems.map((transaction) => (
                  <HistoryMobileRow
                    key={transaction.id}
                    categories={categories}
                    menuOpen={openMenuId === transaction.id}
                    onAction={(action) => {
                      openDialog(transaction.id, action);
                    }}
                    onMenuOpenChange={(open) => {
                      handleMenuOpenChange(transaction.id, open);
                    }}
                    tags={tags}
                    transaction={transaction}
                  />
                ))}
              </ol>
            </div>
          )}
          <HistoryPagesFooter pages={history} />
        </>
      ) : null}
      <EditTransactionDialog
        client={apiClient}
        onOpenChange={(open) => {
          if (!open) {
            setDialog(null);
          }
        }}
        open={dialogOpen && dialog?.mode === "edit"}
        transactionId={dialog?.mode === "edit" ? dialogId : null}
      />
      <DuplicateTransactionDialog
        client={apiClient}
        onOpenChange={(open) => {
          if (!open) {
            setDialog(null);
          }
        }}
        open={dialogOpen && dialog?.mode === "duplicate"}
        transactionId={dialog?.mode === "duplicate" ? dialogId : null}
      />
      <DeleteTransactionDialog
        client={apiClient}
        onOpenChange={(open) => {
          if (!open) {
            setDialog(null);
          }
        }}
        open={dialogOpen && dialog?.mode === "delete"}
        transactionId={dialog?.mode === "delete" ? dialogId : null}
      />
    </div>
  );
}

function HistoryPagesFooter({
  pages,
}: {
  readonly pages: HistoryPagesSnapshot;
}) {
  return (
    <div className="flex w-full max-w-full min-w-0 flex-col items-start gap-3">
      {pages.isLoadingMore ? (
        <LoadingState label={historyCopy.loadingMore} />
      ) : null}
      {pages.pageError ? (
        <div
          role="alert"
          className="border-danger bg-surface-raised flex w-full max-w-full flex-col items-start gap-3 rounded-lg border p-4 sm:p-6"
        >
          <p className="text-body text-text font-medium">
            {historyCopy.pageErrorTitle}
          </p>
          <p className="text-body-sm text-text-muted max-w-xl">
            {apiFailureMessage(pages.pageError, historyCopy.errorHint)}
          </p>
          <Button
            aria-label={historyCopy.retry}
            onClick={pages.retryPage}
            variant="secondary"
          >
            {historyCopy.retry}
          </Button>
        </div>
      ) : null}
      {pages.hasMore && !pages.isLoadingMore ? (
        <Button onClick={pages.loadMore} variant="secondary">
          {historyCopy.loadMore}
        </Button>
      ) : null}
      {pages.endReached ? (
        <p
          aria-label={historyCopy.endOfList}
          className="text-body-sm text-text-muted"
          role="status"
        >
          {historyCopy.endOfList}
        </p>
      ) : null}
      {pages.hasMore ? (
        <HistoryPageSentinel
          enabled={pages.hasMore}
          onIntersect={pages.loadMore}
        />
      ) : null}
    </div>
  );
}

function HistoryDesktopRow({
  categories,
  menuOpen,
  onAction,
  onMenuOpenChange,
  tags,
  transaction,
}: HistoryRowViewProps) {
  const primary = historyPrimaryLabel(transaction, categories);
  const category = historyCategoryLabel(transaction, categories);
  const tagNames = historyTagNames(transaction, tags);

  return (
    <tr className="border-border border-b last:border-b-0">
      <th className="text-body-sm text-text px-3 py-3 font-medium" scope="row">
        <span className="flex min-w-0 items-center gap-3">
          <CategoryIcon categoryId={transaction.categoryId} />
          <span className="min-w-0 break-words">
            {primary}
            <GeneratedRecurringIndicator transaction={transaction} />
          </span>
        </span>
      </th>
      <td className="text-body-sm text-text-muted px-3 py-3">{category}</td>
      <td className="text-body-sm text-text-muted px-3 py-3 tabular-nums">
        {historyDateLabel(transaction)}
      </td>
      <td className="px-3 py-3">
        <TagList names={tagNames} />
      </td>
      <td className="px-3 py-3 text-right">
        <SignedAmount transaction={transaction} />
      </td>
      <td className="px-3 py-3">
        <HistoryRowMenu
          label={primary}
          onAction={onAction}
          onOpenChange={onMenuOpenChange}
          open={menuOpen}
        />
      </td>
    </tr>
  );
}

function HistoryMobileRow({
  categories,
  menuOpen,
  onAction,
  onMenuOpenChange,
  tags,
  transaction,
}: HistoryRowViewProps) {
  const primary = historyPrimaryLabel(transaction, categories);
  const category = historyCategoryLabel(transaction, categories);
  const tagNames = historyTagNames(transaction, tags);

  return (
    <li className="border-border bg-surface-raised flex w-full max-w-full min-w-0 flex-col gap-2 rounded-lg border px-4 py-3">
      <div className="flex w-full max-w-full min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <CategoryIcon categoryId={transaction.categoryId} />
          <div className="min-w-0">
            <p className="text-body text-text font-medium break-words">
              {primary}
              <GeneratedRecurringIndicator transaction={transaction} />
            </p>
            <p className="text-body-sm text-text-muted">{category}</p>
          </div>
        </div>
        <HistoryRowMenu
          label={primary}
          onAction={onAction}
          onOpenChange={onMenuOpenChange}
          open={menuOpen}
        />
      </div>
      <div className="flex w-full max-w-full min-w-0 flex-wrap items-center justify-between gap-2">
        <p className="text-body-sm text-text-muted tabular-nums">
          {historyDateLabel(transaction)}
        </p>
        <SignedAmount transaction={transaction} />
      </div>
      <TagList names={tagNames} />
    </li>
  );
}

interface HistoryRowViewProps {
  readonly categories: HistorySnapshotCategories;
  readonly menuOpen: boolean;
  readonly onAction: (action: HistoryRowAction) => void;
  readonly onMenuOpenChange: (open: boolean) => void;
  readonly tags: HistorySnapshotTags;
  readonly transaction: TransactionDto;
}

type HistorySnapshotCategories = Parameters<typeof historyCategoryLabel>[1];
type HistorySnapshotTags = Parameters<typeof historyTagNames>[1];

function GeneratedRecurringIndicator({
  transaction,
}: {
  readonly transaction: TransactionDto;
}) {
  if (
    transaction.recurringRuleId === undefined ||
    transaction.recurringRuleId === null
  ) {
    return null;
  }

  return (
    <span
      aria-label="Generado por recurrencia"
      className="text-caption text-text-muted ml-2"
    >
      ↻
    </span>
  );
}

function TagList({ names }: { readonly names: readonly string[] }) {
  if (names.length === 0) {
    return <p className="text-caption text-text-muted">{historyCopy.noTags}</p>;
  }

  return (
    <ul className="flex max-w-full flex-wrap gap-1">
      {names.map((name) => (
        <li
          key={name}
          className="border-border text-caption text-text rounded-full border px-2 py-0.5"
        >
          {name}
        </li>
      ))}
    </ul>
  );
}

function SignedAmount({
  transaction,
}: {
  readonly transaction: TransactionDto;
}) {
  return (
    <p
      className={cx(
        "text-body-sm font-semibold tabular-nums",
        transaction.type === "expense" ? "text-expense" : "text-income",
      )}
    >
      <span className="sr-only">{historyTypeLabel(transaction)} </span>
      {historySignedAmount(transaction)}
    </p>
  );
}
