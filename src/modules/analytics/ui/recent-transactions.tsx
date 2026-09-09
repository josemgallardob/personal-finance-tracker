"use client";

/**
 * Five most recent movements of the dashboard.
 *
 * The rows are the same representation the history shows and they carry the
 * same actions, so editing, duplicating or deleting from Inicio goes through
 * the dialogs that already own those rules. A successful mutation announces
 * itself to the shell, which is what refreshes the cards above without a manual
 * reload.
 *
 * The list stays a single stacked column at every width: five rows never need a
 * table, and stacked rows stay readable from 320 px and at 200 % zoom.
 */

import { useCallback, useState } from "react";

import { CategoryIcon } from "../../classification/ui/category-icon";
import type { CategoryDto } from "../../classification/contracts/category";
import type { TagDto } from "../../classification/contracts/tag";
import { DeleteTransactionDialog } from "../../transactions/ui/delete-dialog";
import { DuplicateTransactionDialog } from "../../transactions/ui/duplicate-dialog";
import { EditTransactionDialog } from "../../transactions/ui/edit-dialog";
import {
  HistoryRowMenu,
  type HistoryRowAction,
} from "../../transactions/ui/history-row-menu";
import {
  historyCategoryLabel,
  historyDateLabel,
  historyPrimaryLabel,
  historySignedAmount,
  historyTagNames,
  historyTypeLabel,
} from "../../transactions/ui/history-presentation";
import type { TransactionDto } from "../../transactions/contracts/transaction";
import type { ApiClient } from "../../../shared/client/api-client";
import { cx } from "../../../shared/ui/class-names";
import { EmptyState } from "../../../shared/ui/empty-state";
import { dashboardCopy } from "./dashboard-copy";

/** Identifier of the heading that labels the recent movements block. */
export const RECENT_TITLE_ID = "dashboard-recent-title";

export interface RecentTransactionsProps {
  readonly categories: readonly CategoryDto[];
  readonly client: ApiClient;
  readonly tags: readonly TagDto[];
  readonly transactions: readonly TransactionDto[];
}

interface RecentDialogState {
  readonly mode: HistoryRowAction;
  readonly transactionId: string;
}

/** Recent movements with the edit, duplicate and delete actions. */
export function RecentTransactions({
  categories,
  client,
  tags,
  transactions,
}: RecentTransactionsProps) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<RecentDialogState | null>(null);

  const handleMenuOpenChange = useCallback(
    (transactionId: string, open: boolean) => {
      setOpenMenuId(open ? transactionId : null);
    },
    [],
  );

  function closeDialog(open: boolean) {
    if (!open) {
      setDialog(null);
    }
  }

  const dialogId = dialog?.transactionId ?? null;

  return (
    <section
      aria-labelledby={RECENT_TITLE_ID}
      className="flex w-full max-w-full min-w-0 flex-col gap-3"
    >
      <h2
        className="text-heading-sm text-text font-medium"
        id={RECENT_TITLE_ID}
      >
        {dashboardCopy.recentTitle}
      </h2>
      {transactions.length === 0 ? (
        <EmptyState
          description={dashboardCopy.recentEmptyDescription}
          title={dashboardCopy.recentEmptyTitle}
        />
      ) : (
        <ol
          aria-label={dashboardCopy.recentCaption}
          className="flex w-full max-w-full min-w-0 flex-col gap-3"
        >
          {transactions.map((transaction) => {
            const primary = historyPrimaryLabel(transaction, categories);

            return (
              <li
                className="border-border bg-surface-raised flex w-full max-w-full min-w-0 flex-col gap-2 rounded-lg border px-4 py-3"
                key={transaction.id}
              >
                <div className="flex w-full max-w-full min-w-0 items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <CategoryIcon categoryId={transaction.categoryId} />
                    <div className="min-w-0">
                      <p className="text-body text-text font-medium break-words">
                        {primary}
                      </p>
                      <p className="text-body-sm text-text-muted">
                        {historyCategoryLabel(transaction, categories)}
                      </p>
                    </div>
                  </div>
                  <HistoryRowMenu
                    label={primary}
                    onAction={(action) => {
                      setOpenMenuId(null);
                      setDialog({
                        mode: action,
                        transactionId: transaction.id,
                      });
                    }}
                    onOpenChange={(open) => {
                      handleMenuOpenChange(transaction.id, open);
                    }}
                    open={openMenuId === transaction.id}
                  />
                </div>
                <div className="flex w-full max-w-full min-w-0 flex-wrap items-center justify-between gap-2">
                  <p className="text-body-sm text-text-muted tabular-nums">
                    {historyDateLabel(transaction)}
                  </p>
                  <p
                    className={cx(
                      "text-body-sm font-semibold tabular-nums",
                      transaction.type === "expense"
                        ? "text-expense"
                        : "text-income",
                    )}
                  >
                    <span className="sr-only">
                      {historyTypeLabel(transaction)}{" "}
                    </span>
                    {historySignedAmount(transaction)}
                  </p>
                </div>
                <RecentTagList names={historyTagNames(transaction, tags)} />
              </li>
            );
          })}
        </ol>
      )}
      <EditTransactionDialog
        client={client}
        onOpenChange={closeDialog}
        open={dialog?.mode === "edit"}
        transactionId={dialog?.mode === "edit" ? dialogId : null}
      />
      <DuplicateTransactionDialog
        client={client}
        onOpenChange={closeDialog}
        open={dialog?.mode === "duplicate"}
        transactionId={dialog?.mode === "duplicate" ? dialogId : null}
      />
      <DeleteTransactionDialog
        client={client}
        onOpenChange={closeDialog}
        open={dialog?.mode === "delete"}
        transactionId={dialog?.mode === "delete" ? dialogId : null}
      />
    </section>
  );
}

function RecentTagList({ names }: { readonly names: readonly string[] }) {
  if (names.length === 0) {
    return null;
  }

  return (
    <ul className="flex max-w-full flex-wrap gap-1">
      {names.map((name) => (
        <li
          className="border-border text-caption text-text rounded-full border px-2 py-0.5"
          key={name}
        >
          {name}
        </li>
      ))}
    </ul>
  );
}
