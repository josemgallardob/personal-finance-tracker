/**
 * Recent movements of the dashboard.
 *
 * The suite pins the row content, the fallback title of a movement without a
 * concept, the empty state, and that each row action opens the dialog that
 * already owns the rule it applies.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { createApiClient } from "../../../shared/client/api-client";
import type { TransactionDto } from "../../transactions/contracts/transaction";
import { FinancialDataProvider } from "../../../shared/client/financial-data-provider";
import { historyCopy } from "../../transactions/ui/history-copy";
import {
  categories,
  maintenanceFetch,
  movement,
  tags,
} from "../../transactions/ui/transaction-dialog-fixtures";
import { transactionMaintenanceCopy } from "../../transactions/ui/transaction-dialog-support";
import { dashboardCopy } from "./dashboard-copy";
import { incomeMovement } from "./dashboard-fixtures";
import { RecentTransactions } from "./recent-transactions";

function renderRecent(
  transactions: readonly TransactionDto[] = [incomeMovement, movement],
): void {
  render(
    <FinancialDataProvider>
      <RecentTransactions
        categories={categories}
        client={createApiClient({ fetch: maintenanceFetch() })}
        tags={tags}
        transactions={transactions}
      />
    </FinancialDataProvider>,
  );
}

function rows(): HTMLElement[] {
  return within(
    screen.getByRole("list", { name: dashboardCopy.recentCaption }),
  ).getAllByRole("listitem");
}

describe("RecentTransactions", () => {
  it("lists the movements newest first with concept, category, date and amount", () => {
    renderRecent();

    const [salary, groceries] = rows();

    // A movement without concept falls back to its category as the title, so
    // the name appears both as the title and as the category line.
    expect(within(salary).getAllByText("Nómina")).toHaveLength(2);
    expect(within(salary).getByText("05/09/2026")).toBeVisible();
    expect(within(salary).getByText("+2500,00 €")).toHaveClass("text-income");
    expect(within(salary).getByText(historyCopy.income)).toBeInTheDocument();

    expect(within(groceries).getByText("Supermercado")).toBeVisible();
    expect(within(groceries).getByText("Alimentación")).toBeVisible();
    expect(within(groceries).getByText("−12,50 €")).toHaveClass("text-expense");
    expect(within(groceries).getByText("Viajes")).toBeVisible();
  });

  it("explains how to start when there is no movement yet", () => {
    renderRecent([]);

    expect(
      screen.getByRole("heading", { name: dashboardCopy.recentEmptyTitle }),
    ).toBeVisible();
    expect(
      screen.queryByRole("list", { name: dashboardCopy.recentCaption }),
    ).not.toBeInTheDocument();
  });

  it("opens the edit dialog of the movement of its own row", async () => {
    renderRecent();

    await userEvent.click(
      screen.getByRole("button", {
        name: historyCopy.actionsOf("Supermercado"),
      }),
    );
    await userEvent.click(
      screen.getByRole("menuitem", { name: historyCopy.editAction }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole("dialog", {
          name: transactionMaintenanceCopy.editTitle,
        }),
      ).toBeInTheDocument();
    });
  });

  it("opens the delete confirmation that identifies the movement", async () => {
    renderRecent();

    await userEvent.click(
      screen.getByRole("button", {
        name: historyCopy.actionsOf("Supermercado"),
      }),
    );
    await userEvent.click(
      screen.getByRole("menuitem", { name: historyCopy.deleteAction }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole("dialog", {
          name: transactionMaintenanceCopy.deleteTitle,
        }),
      ).toBeInTheDocument();
    });
  });

  it("opens the duplicate dialog without creating anything yet", async () => {
    renderRecent();

    await userEvent.click(
      screen.getByRole("button", {
        name: historyCopy.actionsOf("Nómina"),
      }),
    );
    await userEvent.click(
      screen.getByRole("menuitem", { name: historyCopy.duplicateAction }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole("dialog", {
          name: transactionMaintenanceCopy.duplicateTitle,
        }),
      ).toBeInTheDocument();
    });
  });
});
