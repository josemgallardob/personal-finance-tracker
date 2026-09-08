import { Suspense } from "react";

import { HistoryList } from "../../modules/transactions/ui/history-list";
import {
  HistoryTabs,
  RecurringHistoryPlaceholder,
} from "../../modules/transactions/ui/history-tabs";
import {
  HISTORY_ALL_TAB,
  historyCopy,
  readHistoryTab,
} from "../../modules/transactions/ui/history-copy";
import { LoadingState } from "../../shared/ui/loading-state";

interface TransactionsPageProps {
  readonly searchParams: Promise<{
    readonly tab?: string | string[];
  }>;
}

export default async function TransactionsPage({
  searchParams,
}: TransactionsPageProps) {
  const params = await searchParams;
  const tab = readHistoryTab(params.tab);

  return (
    <section
      aria-labelledby="transactions-title"
      className="flex w-full max-w-5xl min-w-0 flex-col gap-6"
    >
      <header className="flex w-full max-w-full min-w-0 flex-col gap-2">
        <h1
          id="transactions-title"
          className="text-heading-sm text-text font-medium"
        >
          Movimientos
        </h1>
        <p className="text-body text-text-muted max-w-xl">
          {historyCopy.description}
        </p>
      </header>
      <Suspense fallback={<LoadingState label={historyCopy.loading} />}>
        <HistoryTabs activeTab={tab} />
        {tab === HISTORY_ALL_TAB ? (
          <HistoryList />
        ) : (
          <RecurringHistoryPlaceholder />
        )}
      </Suspense>
    </section>
  );
}
