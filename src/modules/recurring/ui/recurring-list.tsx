"use client";

/**
 * Recurrentes tab of the movements page.
 *
 * Active templates are grouped by expense and income, each row stating type,
 * title, amount, tags, monthly ordinal and next due date. The short-month rule
 * is written next to the ordinal instead of being left to be discovered on 28
 * February. Editing and deactivating go through their own dialogs; both
 * announce their result and bump the shared revision, so this list, the
 * history and the dashboard all reload from the API after a change.
 */

import { useMemo, useState } from "react";
import Link from "next/link";

import type { CategoryDto } from "../../classification/contracts/category";
import { CategoryIcon } from "../../classification/ui/category-icon";
import type { TagDto } from "../../classification/contracts/tag";
import {
  createApiClient,
  type ApiClient,
} from "../../../shared/client/api-client";
import { useFinancialDataRevision } from "../../../shared/client/financial-data-provider";
import { useResource } from "../../../shared/client/use-resource";
import { Button } from "../../../shared/ui/button";
import { cx } from "../../../shared/ui/class-names";
import { EmptyState } from "../../../shared/ui/empty-state";
import { LoadingState } from "../../../shared/ui/loading-state";
import { loadHistoryCatalogs } from "../../transactions/ui/history-load";
import { createRecurringApi } from "../client/recurring-api";
import type {
  RecurringRuleDto,
  RecurringRulesListDto,
} from "../contracts/recurring";
import { DeactivateRecurringDialog } from "./deactivate-recurring-dialog";
import { EditRecurringDialog } from "./edit-recurring-dialog";
import { recurringCopy } from "./recurring-copy";
import { recurringFailureMessage } from "./recurring-failure";
import {
  generatedAnnouncement,
  recurringCategoryLabel,
  recurringNextDueLabel,
  recurringPrimaryLabel,
  recurringSignedAmount,
  recurringTagNames,
} from "./recurring-presentation";

const RECURRING_CATALOGS_KEY = "recurring:catalogs";

export interface RecurringListProps {
  /** Browser transport. The default talks to the current origin. */
  readonly client?: ApiClient;
}

type DialogMode = "edit" | "deactivate";

export function RecurringList({ client }: RecurringListProps = {}) {
  const apiClient = useMemo(() => client ?? createApiClient(), [client]);
  const api = useMemo(() => createRecurringApi(apiClient), [apiClient]);
  const { revision, refreshEpoch } = useFinancialDataRevision();
  const [dialog, setDialog] = useState<{
    readonly mode: DialogMode;
    readonly ruleId: string;
  } | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const rules = useResource<RecurringRulesListDto>({
    requestKey: "recurring:rules",
    revision,
    refreshEpoch,
    load: (signal) => api.listRules({ signal }),
  });
  const catalogs = useResource({
    requestKey: RECURRING_CATALOGS_KEY,
    revision,
    refreshEpoch,
    load: (signal) => loadHistoryCatalogs(apiClient, signal),
  });

  const categories: readonly CategoryDto[] = catalogs.data?.categories ?? [];
  const tags: readonly TagDto[] = catalogs.data?.tags ?? [];
  const expenses = rules.data?.expenses ?? [];
  const incomes = rules.data?.incomes ?? [];
  const selectedRule =
    dialog === null
      ? null
      : ([...expenses, ...incomes].find((rule) => rule.id === dialog.ruleId) ??
        null);

  function completeMutation(generatedDueDates: readonly string[]) {
    setDialog(null);
    setAnnouncement(generatedAnnouncement(generatedDueDates));
  }

  const body = (() => {
    if (rules.status === "loading") {
      return <LoadingState label={recurringCopy.loading} />;
    }

    if (rules.status === "error" || rules.data === undefined) {
      return (
        <div
          className="border-danger bg-surface-raised flex w-full max-w-full flex-col items-start gap-3 rounded-lg border p-4 sm:p-6"
          role="alert"
        >
          <p className="text-body text-text font-medium">
            {recurringCopy.errorTitle}
          </p>
          <p className="text-body-sm text-text-muted max-w-xl">
            {rules.error
              ? recurringFailureMessage(rules.error, recurringCopy.errorHint)
              : recurringCopy.errorHint}
          </p>
          <Button variant="secondary" onClick={rules.refetch}>
            {recurringCopy.retry}
          </Button>
        </div>
      );
    }

    if (expenses.length + incomes.length === 0) {
      return (
        <EmptyState
          action={
            <Link
              className="bg-primary text-on-primary focus-visible:outline-primary-bright inline-flex min-h-12 items-center justify-center rounded-full px-5 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-[3px]"
              href="/"
            >
              {recurringCopy.addTransaction}
            </Link>
          }
          description={recurringCopy.emptyDescription}
          title={recurringCopy.emptyTitle}
        />
      );
    }

    return (
      <div
        aria-label={recurringCopy.listLabel}
        className="flex w-full max-w-full min-w-0 flex-col gap-6"
      >
        <RuleGroup
          categories={categories}
          rules={expenses}
          tags={tags}
          title={recurringCopy.expensesGroup}
          onAction={(ruleId, mode) => {
            setAnnouncement(null);
            setDialog({ mode, ruleId });
          }}
        />
        <RuleGroup
          categories={categories}
          rules={incomes}
          tags={tags}
          title={recurringCopy.incomesGroup}
          onAction={(ruleId, mode) => {
            setAnnouncement(null);
            setDialog({ mode, ruleId });
          }}
        />
      </div>
    );
  })();

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-4">
      {announcement ? (
        <p className="text-body-sm text-text" role="status">
          {announcement}
        </p>
      ) : null}
      {body}
      <EditRecurringDialog
        categories={categories}
        client={apiClient}
        open={dialog?.mode === "edit" && selectedRule !== null}
        rule={dialog?.mode === "edit" ? selectedRule : null}
        tags={tags}
        onCompleted={completeMutation}
        onOpenChange={(open) => {
          if (!open) {
            setDialog(null);
          }
        }}
      />
      <DeactivateRecurringDialog
        client={apiClient}
        label={
          selectedRule
            ? recurringPrimaryLabel(selectedRule, categories)
            : recurringCopy.fallbackLabel
        }
        open={dialog?.mode === "deactivate" && selectedRule !== null}
        rule={dialog?.mode === "deactivate" ? selectedRule : null}
        onCompleted={completeMutation}
        onOpenChange={(open) => {
          if (!open) {
            setDialog(null);
          }
        }}
      />
    </div>
  );
}

function RuleGroup({
  categories,
  onAction,
  rules,
  tags,
  title,
}: {
  readonly categories: readonly CategoryDto[];
  readonly onAction: (ruleId: string, mode: DialogMode) => void;
  readonly rules: readonly RecurringRuleDto[];
  readonly tags: readonly TagDto[];
  readonly title: string;
}) {
  if (rules.length === 0) {
    return null;
  }

  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-3">
      <h2 className="text-heading-xs text-text font-medium">{title}</h2>
      <ul className="flex w-full max-w-full min-w-0 flex-col gap-3">
        {rules.map((rule) => (
          <RuleRow
            key={rule.id}
            categories={categories}
            rule={rule}
            tags={tags}
            onAction={onAction}
          />
        ))}
      </ul>
    </section>
  );
}

function RuleRow({
  categories,
  onAction,
  rule,
  tags,
}: {
  readonly categories: readonly CategoryDto[];
  readonly onAction: (ruleId: string, mode: DialogMode) => void;
  readonly rule: RecurringRuleDto;
  readonly tags: readonly TagDto[];
}) {
  const primary = recurringPrimaryLabel(rule, categories);
  const tagNames = recurringTagNames(rule, tags);

  return (
    <li className="border-border bg-surface-raised flex w-full max-w-full min-w-0 flex-col gap-3 rounded-lg border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <CategoryIcon categoryId={rule.categoryId} />
        <div className="min-w-0">
          <p className="text-body text-text font-medium break-words">
            {primary}
          </p>
          <p className="text-body-sm text-text-muted">
            {recurringCategoryLabel(rule, categories)}
          </p>
          <p className="text-body-sm text-text-muted tabular-nums">
            {recurringCopy.monthlyDayLabel(rule.monthlyDay)} ·{" "}
            {recurringNextDueLabel(rule)}
          </p>
          <p className="text-caption text-text-muted">
            {recurringCopy.shortMonthNote}
          </p>
          {tagNames.length === 0 ? (
            <p className="text-caption text-text-muted">
              {recurringCopy.noTags}
            </p>
          ) : (
            <ul
              aria-label={recurringCopy.tagsLabel}
              className="mt-1 flex max-w-full flex-wrap gap-1"
            >
              {tagNames.map((name) => (
                <li
                  key={name}
                  className="border-border text-caption text-text rounded-full border px-2 py-0.5"
                >
                  {name}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="flex w-full max-w-full min-w-0 flex-wrap items-center justify-between gap-2 sm:w-auto sm:justify-end">
        <p
          className={cx(
            "text-body-sm font-semibold tabular-nums",
            rule.type === "expense" ? "text-expense" : "text-income",
          )}
        >
          <span className="sr-only">
            {rule.type === "expense"
              ? recurringCopy.expenseType
              : recurringCopy.incomeType}{" "}
          </span>
          {recurringSignedAmount(rule)}
        </p>
        <div className="flex gap-2">
          <Button
            aria-label={recurringCopy.editActionOf(primary)}
            variant="secondary"
            onClick={() => {
              onAction(rule.id, "edit");
            }}
          >
            {recurringCopy.editAction}
          </Button>
          <Button
            aria-label={recurringCopy.deactivateActionOf(primary)}
            variant="danger"
            onClick={() => {
              onAction(rule.id, "deactivate");
            }}
          >
            {recurringCopy.deactivateAction}
          </Button>
        </div>
      </div>
    </li>
  );
}
