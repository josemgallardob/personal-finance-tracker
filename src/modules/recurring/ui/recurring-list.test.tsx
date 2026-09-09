/**
 * Recurrentes tab against the real adapters with only `fetch` replaced.
 *
 * The component is exercised through the documented endpoints, so grouping,
 * the overdue confirmation, the irreversible deactivation, the refusal
 * guidance and the reload after a mutation are all checked against the shapes
 * the API really answers instead of against a hand-written double.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createApiClient,
  type FetchLike,
} from "../../../shared/client/api-client";
import { FinancialDataProvider } from "../../../shared/client/financial-data-provider";
import { REQUEST_ID_HEADER } from "../../../shared/contracts/http";
import { transactionFormCopy } from "../../transactions/ui/transaction-form-schema";
import type { RecurringRuleDto } from "../contracts/recurring";
import { RecurringList } from "./recurring-list";
import { recurringConflictCopy, recurringCopy } from "./recurring-copy";

const REQUEST_ID = "req-recurring";

const expenseRule: RecurringRuleDto = {
  id: "rule-rent",
  sourceTransactionId: "tx-1",
  type: "expense",
  amountMinor: 125_000,
  categoryId: "cat-rent",
  concept: "Alquiler piso",
  note: null,
  tagIds: ["tag-home"],
  monthlyDay: 31,
  nextDueDate: "2026-10-31",
  templateVersion: 1,
};

const incomeRule: RecurringRuleDto = {
  id: "rule-salary",
  sourceTransactionId: "tx-2",
  type: "income",
  amountMinor: 200_000,
  categoryId: "cat-salary",
  concept: "Nómina mensual",
  note: null,
  tagIds: [],
  monthlyDay: 1,
  nextDueDate: "2026-10-01",
  templateVersion: 3,
};

function dataResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data: body, requestId: REQUEST_ID }), {
    status,
    headers: {
      "content-type": "application/json",
      [REQUEST_ID_HEADER]: REQUEST_ID,
    },
  });
}

function errorResponse(
  status: number,
  code: string,
  details?: ReadonlyArray<{ field: string; code: string }>,
): Response {
  return new Response(
    JSON.stringify({
      error: {
        code,
        message: "Mensaje del servidor",
        requestId: REQUEST_ID,
        ...(details ? { details } : {}),
      },
    }),
    {
      status,
      headers: {
        "content-type": "application/json",
        [REQUEST_ID_HEADER]: REQUEST_ID,
      },
    },
  );
}

interface StubOptions {
  readonly rules?: readonly RecurringRuleDto[][];
  readonly pendingDueDates?: readonly string[];
  readonly failList?: boolean;
  readonly failCatchUp?: boolean;
  readonly onUpdate?: (body: unknown) => Response;
  readonly onDeactivate?: (body: unknown) => Response;
}

function stubFetch(options: StubOptions = {}) {
  const pages = options.rules ?? [[expenseRule, incomeRule]];
  let listCalls = 0;

  const fetchImpl = vi.fn<FetchLike>((input, init) => {
    const body =
      init.body === undefined ? undefined : JSON.parse(String(init.body));

    if (input === "/api/recurring-rules" && init.method === "GET") {
      if (options.failList) {
        return Promise.resolve(errorResponse(503, "serviceUnavailable"));
      }
      const page = pages[Math.min(listCalls, pages.length - 1)] ?? [];
      listCalls += 1;
      return Promise.resolve(
        dataResponse({
          expenses: page.filter((rule) => rule.type === "expense"),
          incomes: page.filter((rule) => rule.type === "income"),
        }),
      );
    }

    if (input.startsWith("/api/categories")) {
      return Promise.resolve(
        dataResponse([
          {
            id: "cat-rent",
            name: "Alquiler",
            type: "expense",
            isArchived: false,
          },
          {
            id: "cat-food",
            name: "Comida",
            type: "expense",
            isArchived: false,
          },
          {
            id: "cat-salary",
            name: "Sueldo",
            type: "income",
            isArchived: false,
          },
        ]),
      );
    }

    if (input.startsWith("/api/tags")) {
      return Promise.resolve(
        dataResponse([{ id: "tag-home", name: "Hogar", isArchived: false }]),
      );
    }

    if (input.endsWith("/preview")) {
      if (options.failCatchUp) {
        return Promise.resolve(errorResponse(503, "serviceUnavailable"));
      }
      return Promise.resolve(
        dataResponse({
          rule: expenseRule,
          pendingDueDates: options.pendingDueDates ?? [],
        }),
      );
    }

    if (input.endsWith("/deactivate")) {
      return Promise.resolve(
        options.onDeactivate?.(body) ??
          dataResponse({ rule: expenseRule, generatedDueDates: [] }),
      );
    }

    if (init.method === "PUT") {
      return Promise.resolve(
        options.onUpdate?.(body) ??
          dataResponse({
            rule: { ...expenseRule, templateVersion: 2 },
            generatedDueDates: [],
          }),
      );
    }

    throw new Error(`unexpected request: ${init.method ?? ""} ${input}`);
  });

  return fetchImpl;
}

function renderList(fetchImpl: ReturnType<typeof stubFetch>) {
  return render(
    <FinancialDataProvider
      environment={{
        addFocusListener: vi.fn(),
        removeFocusListener: vi.fn(),
        addVisibilityListener: vi.fn(),
        removeVisibilityListener: vi.fn(),
        isDocumentVisible: () => false,
        setInterval: vi.fn(() => 0),
        clearInterval: vi.fn(),
      }}
    >
      <RecurringList client={createApiClient({ fetch: fetchImpl })} />
    </FinancialDataProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RecurringList", () => {
  it("announces loading and then groups active templates by expense and income", async () => {
    const fetchImpl = stubFetch();
    renderList(fetchImpl);

    expect(screen.getByRole("status")).toHaveTextContent(recurringCopy.loading);

    const expenses = await screen.findByRole("region", {
      name: recurringCopy.expensesGroup,
    });
    const incomes = screen.getByRole("region", {
      name: recurringCopy.incomesGroup,
    });
    expect(within(expenses).getByText("Alquiler piso")).toBeVisible();
    expect(within(incomes).getByText("Nómina mensual")).toBeVisible();
    expect(within(incomes).getByText("Sueldo")).toBeVisible();
    expect(
      within(expenses).queryByText("Nómina mensual"),
    ).not.toBeInTheDocument();
    expect(
      within(expenses).getByText(recurringCopy.monthlyDayLabel(31), {
        exact: false,
      }),
    ).toBeVisible();
    expect(within(expenses).getByText(/Próxima: 31\/10\/2026/)).toBeVisible();
    expect(
      within(expenses).getByText(recurringCopy.shortMonthNote),
    ).toBeVisible();
    expect(
      within(expenses).getByRole("list", { name: recurringCopy.tagsLabel }),
    ).toHaveTextContent("Hogar");
    expect(within(incomes).getByText(recurringCopy.noTags)).toBeVisible();
  });

  it("hides an empty group instead of showing a header with nothing under it", async () => {
    renderList(stubFetch({ rules: [[expenseRule]] }));

    await screen.findByRole("region", { name: recurringCopy.expensesGroup });
    expect(
      screen.queryByRole("region", { name: recurringCopy.incomesGroup }),
    ).not.toBeInTheDocument();
  });

  it("guides the owner to the entry point when there is no active template", async () => {
    renderList(stubFetch({ rules: [[]] }));

    expect(
      await screen.findByRole("region", { name: recurringCopy.emptyTitle }),
    ).toBeVisible();
    expect(screen.getByText(recurringCopy.emptyDescription)).toBeVisible();
    expect(
      screen.getByRole("link", { name: recurringCopy.addTransaction }),
    ).toHaveAttribute("href", "/");
  });

  it("explains a failed load and reloads the same list when asked to retry", async () => {
    const user = userEvent.setup();
    let failing = true;
    const fetchImpl = vi.fn<FetchLike>((input, init) => {
      if (input === "/api/recurring-rules" && init.method === "GET") {
        if (failing) {
          return Promise.resolve(errorResponse(503, "serviceUnavailable"));
        }
        return Promise.resolve(
          dataResponse({ expenses: [expenseRule], incomes: [] }),
        );
      }
      return Promise.resolve(dataResponse([]));
    });
    renderList(fetchImpl as ReturnType<typeof stubFetch>);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(recurringCopy.errorTitle);
    expect(alert).toHaveTextContent(recurringConflictCopy.unavailable);

    failing = false;
    await user.click(screen.getByRole("button", { name: recurringCopy.retry }));

    expect(
      await screen.findByRole("region", { name: recurringCopy.expensesGroup }),
    ).toBeVisible();
  });

  it("states how many overdue entries an edit creates and saves only future values", async () => {
    const user = userEvent.setup();
    const updates: unknown[] = [];
    const fetchImpl = stubFetch({
      pendingDueDates: ["2026-08-31", "2026-09-30"],
      rules: [
        [expenseRule, incomeRule],
        [{ ...expenseRule, concept: "Alquiler nuevo", templateVersion: 2 }],
      ],
      onUpdate: (body) => {
        updates.push(body);
        return dataResponse({
          rule: { ...expenseRule, templateVersion: 2 },
          generatedDueDates: ["2026-08-31", "2026-09-30"],
        });
      },
    });
    renderList(fetchImpl);

    await user.click(
      await screen.findByRole("button", {
        name: recurringCopy.editActionOf("Alquiler piso"),
      }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: recurringCopy.editTitle,
    });
    expect(dialog).toHaveTextContent(recurringCopy.editDescription);
    expect(
      await within(dialog).findByText(/Se crearán 2 entradas atrasadas/),
    ).toHaveTextContent("31/08/2026, 30/09/2026");

    await user.clear(within(dialog).getByLabelText(/Concepto/));
    await user.type(
      within(dialog).getByLabelText(/Concepto/),
      "Alquiler nuevo",
    );
    await user.click(
      within(dialog).getByRole("button", { name: recurringCopy.save }),
    );

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(updates).toEqual([
      {
        templateVersion: 1,
        type: "expense",
        amountMinor: 125_000,
        categoryId: "cat-rent",
        concept: "Alquiler nuevo",
        note: null,
        tagInputs: [{ tagId: "tag-home" }],
        monthlyDay: 31,
      },
    ]);
    expect(await screen.findByText(recurringCopy.createdMany(2))).toBeVisible();
    expect(await screen.findByText("Alquiler nuevo")).toBeVisible();
  });

  it("keeps the dialog open with guidance when the category is archived", async () => {
    const user = userEvent.setup();
    const fetchImpl = stubFetch({
      onUpdate: () =>
        errorResponse(409, "conflict", [
          { field: "categoryId", code: "archived" },
        ]),
    });
    renderList(fetchImpl);

    await user.click(
      await screen.findByRole("button", {
        name: recurringCopy.editActionOf("Alquiler piso"),
      }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: recurringCopy.editTitle,
    });
    await user.click(
      within(dialog).getByRole("button", { name: recurringCopy.save }),
    );

    expect(
      await within(dialog).findByText(recurringConflictCopy.categoryArchived),
    ).toBeVisible();
    expect(
      screen.getByRole("dialog", { name: recurringCopy.editTitle }),
    ).toBeVisible();
  });

  it("refuses to submit an invalid amount or monthly day before calling the API", async () => {
    const user = userEvent.setup();
    const fetchImpl = stubFetch({
      onUpdate: () => {
        throw new Error("the form must not submit invalid values");
      },
    });
    renderList(fetchImpl);

    await user.click(
      await screen.findByRole("button", {
        name: recurringCopy.editActionOf("Alquiler piso"),
      }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: recurringCopy.editTitle,
    });
    await user.clear(within(dialog).getByLabelText(/Importe/));
    await user.click(
      within(dialog).getByRole("button", { name: recurringCopy.save }),
    );

    // The message appears in the error summary and next to the field itself.
    expect(
      await within(dialog).findAllByText(transactionFormCopy.amountRequired),
    ).toHaveLength(2);
    expect(
      fetchImpl.mock.calls.filter((call) => call[1].method === "PUT"),
    ).toHaveLength(0);
  });

  it("clears the chosen category when the type no longer matches it", async () => {
    const user = userEvent.setup();
    renderList(stubFetch());

    await user.click(
      await screen.findByRole("button", {
        name: recurringCopy.editActionOf("Alquiler piso"),
      }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: recurringCopy.editTitle,
    });
    expect(within(dialog).getByLabelText(/Categoría/)).toHaveValue("cat-rent");

    await user.click(
      within(dialog).getByRole("radio", { name: transactionFormCopy.income }),
    );

    expect(within(dialog).getByLabelText(/Categoría/)).toHaveValue("");
    expect(
      within(dialog).getByRole("option", { name: "Sueldo" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("option", { name: "Alquiler" }),
    ).not.toBeInTheDocument();
  });

  it("confirms a deactivation as irreversible and lists the entries it recovers", async () => {
    const user = userEvent.setup();
    const deactivations: unknown[] = [];
    const fetchImpl = stubFetch({
      pendingDueDates: ["2026-09-30"],
      rules: [[expenseRule, incomeRule], [incomeRule]],
      onDeactivate: (body) => {
        deactivations.push(body);
        return dataResponse({
          rule: expenseRule,
          generatedDueDates: ["2026-09-30"],
        });
      },
    });
    renderList(fetchImpl);

    await user.click(
      await screen.findByRole("button", {
        name: recurringCopy.deactivateActionOf("Alquiler piso"),
      }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: recurringCopy.deactivateTitle,
    });
    expect(dialog).toHaveTextContent(recurringCopy.deactivateIrreversible);
    expect(dialog).toHaveTextContent(recurringCopy.deactivateDescription);
    expect(dialog).toHaveTextContent("Alquiler piso");
    expect(
      await within(dialog).findByText(/Se creará 1 entrada atrasada/),
    ).toHaveTextContent("30/09/2026");

    await user.click(
      within(dialog).getByRole("button", {
        name: recurringCopy.deactivateConfirm,
      }),
    );

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(deactivations).toEqual([{ templateVersion: 1 }]);
    expect(await screen.findByText(recurringCopy.createdOne)).toBeVisible();
    await waitFor(() => {
      expect(screen.queryByText("Alquiler piso")).not.toBeInTheDocument();
    });
    expect(
      screen.getByRole("region", { name: recurringCopy.incomesGroup }),
    ).toBeVisible();
  });

  it("keeps the rule when the confirmation is cancelled and calls nothing", async () => {
    const user = userEvent.setup();
    const fetchImpl = stubFetch();
    renderList(fetchImpl);

    await user.click(
      await screen.findByRole("button", {
        name: recurringCopy.deactivateActionOf("Alquiler piso"),
      }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: recurringCopy.deactivateTitle,
    });
    await user.click(
      within(dialog).getByRole("button", { name: recurringCopy.cancel }),
    );

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(
      fetchImpl.mock.calls.filter((call) =>
        String(call[0]).endsWith("/deactivate"),
      ),
    ).toHaveLength(0);
    expect(screen.getByText("Alquiler piso")).toBeVisible();
  });

  it("explains a stale template version and keeps the rule listed", async () => {
    const user = userEvent.setup();
    const fetchImpl = stubFetch({
      onDeactivate: () =>
        errorResponse(422, "validationFailed", [
          { field: "templateVersion", code: "invalidTemplateVersion" },
        ]),
    });
    renderList(fetchImpl);

    await user.click(
      await screen.findByRole("button", {
        name: recurringCopy.deactivateActionOf("Alquiler piso"),
      }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: recurringCopy.deactivateTitle,
    });
    await user.click(
      within(dialog).getByRole("button", {
        name: recurringCopy.deactivateConfirm,
      }),
    );

    expect(
      await within(dialog).findByText(recurringConflictCopy.staleTemplate),
    ).toBeVisible();

    await user.click(
      within(dialog).getByRole("button", { name: recurringCopy.cancel }),
    );

    expect(
      within(
        await screen.findByRole("region", {
          name: recurringCopy.expensesGroup,
        }),
      ).getByText("Alquiler piso"),
    ).toBeVisible();
  });

  it("still allows the change when the overdue preview itself fails", async () => {
    const user = userEvent.setup();
    renderList(stubFetch({ failCatchUp: true }));

    await user.click(
      await screen.findByRole("button", {
        name: recurringCopy.deactivateActionOf("Alquiler piso"),
      }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: recurringCopy.deactivateTitle,
    });

    expect(
      await within(dialog).findByText(recurringCopy.catchUpUnavailable),
    ).toBeVisible();
    expect(
      within(dialog).getByRole("button", {
        name: recurringCopy.deactivateConfirm,
      }),
    ).toBeEnabled();
  });

  it("names every row action and renders without a viewport media query", async () => {
    // The tab is mobile-first: no breakpoint listener decides what it renders.
    vi.stubGlobal("matchMedia", undefined);
    renderList(stubFetch());

    const items = await screen.findAllByRole("listitem");
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    for (const label of ["Alquiler piso", "Nómina mensual"]) {
      expect(
        screen.getByRole("button", { name: recurringCopy.editActionOf(label) }),
      ).toBeVisible();
      expect(
        screen.getByRole("button", {
          name: recurringCopy.deactivateActionOf(label),
        }),
      ).toBeVisible();
    }
    expect(screen.getByText(recurringCopy.expenseType)).toBeInTheDocument();
    expect(screen.getByText(recurringCopy.incomeType)).toBeInTheDocument();
  });
});
