import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { CategoryDto } from "../../classification/contracts/category";
import type { TagDto } from "../../classification/contracts/tag";
import { TransactionForm } from "./transaction-form";
import {
  createTransactionFormSchema,
  defaultTransactionFormValues,
  formatLocalDateAsSpanish,
  toTransactionWriteBody,
  transactionFormCopy,
  type TransactionFormValues,
} from "./transaction-form-schema";

const today = "2026-09-08";

const categories: CategoryDto[] = [
  { id: "cat-food", name: "Alimentación", type: "expense", isArchived: false },
  { id: "cat-home", name: "Casa", type: "expense", isArchived: false },
  { id: "cat-old", name: "Antigua", type: "expense", isArchived: true },
  { id: "cat-salary", name: "Nómina", type: "income", isArchived: false },
];

const tags: TagDto[] = [
  { id: "tag-trips", name: "Viajes", isArchived: false },
  { id: "tag-home", name: "Casa", isArchived: false },
];

function renderForm(
  props: Partial<Parameters<typeof TransactionForm>[0]> = {},
) {
  const onSubmit = props.onSubmit ?? vi.fn();
  const onCancel = props.onCancel ?? vi.fn();
  render(
    <TransactionForm
      categories={categories}
      tags={tags}
      today={today}
      onCancel={onCancel}
      onSubmit={onSubmit}
      {...props}
    />,
  );
  return { onSubmit, onCancel };
}

async function fillRequired(
  user: ReturnType<typeof userEvent.setup>,
  options?: { amount?: string; category?: string },
) {
  await user.type(screen.getByLabelText(/Importe/), options?.amount ?? "12,50");
  await user.selectOptions(
    screen.getByLabelText(/Categoría/),
    options?.category ?? "cat-food",
  );
}

describe("transaction form schema", () => {
  const schema = createTransactionFormSchema({
    today,
    categories,
    tags,
  });

  it("accepts the four required fields and optional extras", () => {
    const values: TransactionFormValues = {
      ...defaultTransactionFormValues(today),
      amountText: "1.234,5",
      categoryId: "cat-food",
      concept: "Supermercado",
      note: "Compra semanal",
      tagSelections: [
        { kind: "existing", tagId: "tag-trips", name: "Viajes" },
        { kind: "pending", name: "Café" },
      ],
    };

    expect(defaultTransactionFormValues(today, values).tagSelections).toEqual(
      values.tagSelections,
    );

    const parsed = schema.safeParse(values);
    expect(parsed.success).toBe(true);
    expect(toTransactionWriteBody(values)).toEqual({
      type: "expense",
      amountMinor: 123450,
      date: today,
      categoryId: "cat-food",
      concept: "Supermercado",
      note: "Compra semanal",
      tagInputs: [{ tagId: "tag-trips" }, { name: "Café" }],
    });
  });

  it("rejects empty required fields, invalid decimals and future dates", () => {
    const empty = schema.safeParse(defaultTransactionFormValues(today));
    expect(empty.success).toBe(false);
    if (empty.success) {
      return;
    }
    expect(empty.error.issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        transactionFormCopy.amountRequired,
        transactionFormCopy.categoryRequired,
      ]),
    );

    const invalidAmount = schema.safeParse({
      ...defaultTransactionFormValues(today),
      amountText: "12.50",
      categoryId: "cat-food",
    });
    expect(invalidAmount.success).toBe(false);

    const tooManyDecimals = schema.safeParse({
      ...defaultTransactionFormValues(today),
      amountText: "12,345",
      categoryId: "cat-food",
    });
    expect(tooManyDecimals.success).toBe(false);

    const future = schema.safeParse({
      ...defaultTransactionFormValues(today),
      amountText: "12,50",
      date: "2026-09-09",
      categoryId: "cat-food",
    });
    expect(future.success).toBe(false);

    const zero = schema.safeParse({
      ...defaultTransactionFormValues(today),
      amountText: "0,00",
      categoryId: "cat-food",
    });
    expect(zero.success).toBe(false);

    const huge = schema.safeParse({
      ...defaultTransactionFormValues(today),
      amountText: "1.000.000.000,00",
      categoryId: "cat-food",
    });
    expect(huge.success).toBe(false);

    const invalidDate = schema.safeParse({
      ...defaultTransactionFormValues(today),
      amountText: "12,50",
      date: "08/09/2026",
      categoryId: "cat-food",
    });
    expect(invalidDate.success).toBe(false);

    const emptyDate = schema.safeParse({
      ...defaultTransactionFormValues(today),
      amountText: "12,50",
      date: "",
      categoryId: "cat-food",
    });
    expect(emptyDate.success).toBe(false);
  });

  it("rejects an income type with an expense category", () => {
    const parsed = schema.safeParse({
      ...defaultTransactionFormValues(today),
      type: "income",
      amountText: "12,50",
      categoryId: "cat-food",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects duplicate tags and more than twenty selections", () => {
    const duplicates = schema.safeParse({
      ...defaultTransactionFormValues(today),
      amountText: "12,50",
      categoryId: "cat-food",
      tagSelections: [
        { kind: "pending", name: "Café" },
        { kind: "pending", name: "café" },
      ],
    });
    expect(duplicates.success).toBe(false);

    const tooMany = schema.safeParse({
      ...defaultTransactionFormValues(today),
      amountText: "12,50",
      categoryId: "cat-food",
      tagSelections: Array.from({ length: 21 }, (_, index) => ({
        kind: "pending" as const,
        name: `Tag ${index}`,
      })),
    });
    expect(tooMany.success).toBe(false);

    const unknownTag = schema.safeParse({
      ...defaultTransactionFormValues(today),
      amountText: "12,50",
      categoryId: "cat-food",
      tagSelections: [{ kind: "existing", tagId: "missing", name: "Nada" }],
    });
    expect(unknownTag.success).toBe(false);

    const invalidPending = schema.safeParse({
      ...defaultTransactionFormValues(today),
      amountText: "12,50",
      categoryId: "cat-food",
      tagSelections: [{ kind: "pending", name: "" }],
    });
    expect(invalidPending.success).toBe(false);

    const longConcept = schema.safeParse({
      ...defaultTransactionFormValues(today),
      amountText: "12,50",
      categoryId: "cat-food",
      concept: "a".repeat(201),
    });
    expect(longConcept.success).toBe(false);

    const controlConcept = schema.safeParse({
      ...defaultTransactionFormValues(today),
      amountText: "12,50",
      categoryId: "cat-food",
      concept: "Hola\u0007",
    });
    expect(controlConcept.success).toBe(false);

    const longNote = schema.safeParse({
      ...defaultTransactionFormValues(today),
      amountText: "12,50",
      categoryId: "cat-food",
      note: "a".repeat(2001),
    });
    expect(longNote.success).toBe(false);

    const controlNote = schema.safeParse({
      ...defaultTransactionFormValues(today),
      amountText: "12,50",
      categoryId: "cat-food",
      note: "Hola\u0007",
    });
    expect(controlNote.success).toBe(false);
  });

  it("allows a retained archived category on edit", () => {
    const schemaWithRetained = createTransactionFormSchema({
      today,
      categories,
      tags,
      retainedCategoryId: "cat-old",
    });
    const parsed = schemaWithRetained.safeParse({
      ...defaultTransactionFormValues(today),
      amountText: "12,50",
      categoryId: "cat-old",
    });
    expect(parsed.success).toBe(true);
  });

  it("formats the Madrid today value as Spanish display text", () => {
    expect(formatLocalDateAsSpanish(today)).toBe("08/09/2026");
    expect(formatLocalDateAsSpanish("no-date")).toBe("no-date");
  });

  it("keeps the mapper from silently coercing an invalid amount", () => {
    expect(() =>
      toTransactionWriteBody(defaultTransactionFormValues(today)),
    ).toThrow(/Validated amount was rejected/);
  });

  it("clears optional blank concept and note", () => {
    expect(
      toTransactionWriteBody({
        ...defaultTransactionFormValues(today),
        amountText: "0,01",
        categoryId: "cat-food",
        concept: "  ",
        note: "\n",
      }),
    ).toMatchObject({ concept: null, note: null, amountMinor: 1 });
  });
});

describe("TransactionForm", () => {
  it("defaults the date to preferences.today and expense type", () => {
    renderForm();

    expect(screen.getByLabelText(/Fecha/)).toHaveValue(today);
    expect(screen.getByLabelText("Gasto")).toBeChecked();
    expect(screen.getByLabelText("Ingreso")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Añadir gasto" })).toBeEnabled();
    expect(screen.queryByText(/Formato dd\/mm\/aaaa/)).not.toBeInTheDocument();
  });

  it("requires the four fields and shows them in the accessible summary", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm();

    await user.click(screen.getByRole("button", { name: "Añadir gasto" }));

    expect(onSubmit).not.toHaveBeenCalled();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(transactionFormCopy.amountRequired);
    expect(alert).toHaveTextContent(transactionFormCopy.categoryRequired);
    expect(screen.getByLabelText(/Importe/)).toBeInvalid();
    expect(screen.getByLabelText(/Categoría/)).toBeInvalid();
  });

  it("rejects Spanish amounts with more than two decimals", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm();

    await fillRequired(user, { amount: "12,345" });
    await user.click(screen.getByRole("button", { name: "Añadir gasto" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      transactionFormCopy.amountInvalid,
    );
    expect(screen.getByLabelText(/Importe/)).toBeInvalid();
  });

  it("changes the compatible category catalog when the type changes", async () => {
    const user = userEvent.setup();
    renderForm();

    const category = screen.getByLabelText(/Categoría/);
    expect(category).toHaveTextContent("Alimentación");
    expect(category).not.toHaveTextContent("Nómina");

    await user.selectOptions(category, "cat-food");
    await user.click(screen.getByLabelText("Ingreso"));

    expect(category).toHaveValue("");
    expect(category).toHaveTextContent("Nómina");
    expect(category).not.toHaveTextContent("Alimentación");
    expect(
      screen.getByRole("button", { name: "Añadir ingreso" }),
    ).toBeVisible();

    await user.click(screen.getByLabelText("Gasto"));
    expect(category).toHaveTextContent("Alimentación");
    expect(category).not.toHaveTextContent("Nómina");
    expect(screen.getByRole("button", { name: "Añadir gasto" })).toBeVisible();
  });

  it("submits existing and pending tags without calling transport", async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    const { onSubmit } = renderForm();

    await fillRequired(user);
    await user.click(screen.getByRole("option", { name: "Viajes" }));
    await user.type(
      screen.getByRole("combobox", { name: "Etiquetas" }),
      "Café",
    );
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("button", { name: "Añadir gasto" }));

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(onSubmit).toHaveBeenCalledWith({
      type: "expense",
      amountMinor: 1250,
      date: today,
      categoryId: "cat-food",
      concept: null,
      note: null,
      tagInputs: [{ tagId: "tag-trips" }, { name: "Café" }],
    });
    vi.unstubAllGlobals();
  });

  it("does not submit or persist when cancelled after typing", async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    const { onSubmit, onCancel } = renderForm();

    await fillRequired(user);
    await user.type(screen.getByLabelText("Concepto"), "Prueba");
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("focuses the amount field and uses a decimal keypad", () => {
    renderForm();

    const amount = screen.getByLabelText(/Importe/);
    const amountControl = amount.parentElement;

    expect(amount).toHaveFocus();
    expect(amount).toHaveAttribute("inputMode", "decimal");
    expect(amount).toHaveAttribute("aria-required", "true");
    expect(amount).toHaveClass("pr-12");
    expect(within(amountControl as HTMLElement).getByText("€")).toBeVisible();
    expect(
      screen.queryByText(transactionFormCopy.amountHint),
    ).not.toBeInTheDocument();
    expect(screen.getByText(transactionFormCopy.requiredFields)).toBeVisible();
    expect(screen.getAllByText("*")).toHaveLength(5);
  });

  it("orders the compact fields and keeps the date centered and narrow", () => {
    renderForm();

    const fields = [
      screen.getByLabelText(/Importe/),
      screen.getByLabelText("Concepto"),
      screen.getByLabelText(/Categoría/),
      screen.getByLabelText(/Fecha/),
      screen.getByRole("combobox", { name: "Etiquetas" }),
    ];

    for (let index = 0; index < fields.length - 1; index += 1) {
      expect(
        fields[index].compareDocumentPosition(fields[index + 1]) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    expect(fields[3]).toHaveClass("h-12", "max-w-64", "text-center");
  });

  it("can be completed with the keyboard on a compact form", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm();

    await user.keyboard("30,00");
    await user.tab();
    expect(screen.getByLabelText("Concepto")).toHaveFocus();
    await user.tab();
    expect(screen.getByLabelText(/Categoría/)).toHaveFocus();
    await user.selectOptions(screen.getByLabelText(/Categoría/), "cat-food");
    await user.tab();
    expect(screen.getByLabelText(/Fecha/)).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("combobox", { name: "Etiquetas" })).toHaveFocus();
    await user.tab();
    expect(screen.getByLabelText("Nota")).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Cancelar" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Añadir gasto" })).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "expense",
        amountMinor: 3000,
        categoryId: "cat-food",
        date: today,
      }),
    );
  });

  it("keeps optional fields optional and excludes archived categories from a new expense", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm();

    expect(screen.getByLabelText("Concepto")).toBeValid();
    expect(screen.getByLabelText("Nota")).toBeValid();
    expect(
      within(screen.getByLabelText(/Categoría/)).queryByRole("option", {
        name: "Antigua",
      }),
    ).not.toBeInTheDocument();

    await fillRequired(user);
    await user.type(screen.getByLabelText("Concepto"), "Pan");
    await user.type(screen.getByLabelText("Nota"), "Barrio");
    await user.click(screen.getByRole("button", { name: "Añadir gasto" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        concept: "Pan",
        note: "Barrio",
      }),
    );
  });

  it("rejects a future date from the form", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm();

    await fillRequired(user);
    await user.clear(screen.getByLabelText(/Fecha/));
    await user.type(screen.getByLabelText(/Fecha/), "2026-09-09");
    await user.click(screen.getByRole("button", { name: "Añadir gasto" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      transactionFormCopy.dateFuture,
    );
  });
});
