import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Field } from "./field";
import { Input } from "./input";

describe("Field", () => {
  it("associates the visible Spanish label with the control", () => {
    render(
      <Field id="concept" label="Concepto" hint="Opcional">
        <Input name="concept" />
      </Field>,
    );

    const input = screen.getByLabelText("Concepto");

    expect(input).toHaveAccessibleDescription("Opcional");
    expect(input).toBeValid();
    expect(screen.queryByText("*")).not.toBeInTheDocument();
  });

  it("leaves a valid optional field without descriptions", () => {
    render(
      <Field id="note" label="Nota">
        <Input name="note" />
      </Field>,
    );

    const input = screen.getByLabelText("Nota");

    expect(input).toBeValid();
    expect(input).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByText("*")).not.toBeInTheDocument();
  });

  it("marks a required field and announces its error together with the hint", () => {
    render(
      <Field
        id="amount"
        label="Importe"
        hint="Usa coma decimal"
        error="Introduce un importe válido"
        required
      >
        <Input name="amount" inputMode="decimal" tabular />
      </Field>,
    );

    const input = screen.getByLabelText(/Importe/);

    expect(screen.getByText("*")).toHaveClass("text-danger");
    expect(screen.getByText("*")).toHaveAttribute("aria-hidden", "true");
    expect(input).toBeRequired();
    expect(input).toBeInvalid();
    expect(input).toHaveAccessibleDescription(
      "Usa coma decimal Introduce un importe válido",
    );
    expect(input).toHaveAttribute("id", "amount");
    expect(screen.getByText("Introduce un importe válido")).toHaveAttribute(
      "id",
      "amount-error",
    );
  });

  it("lets an explicit input override win over the surrounding field state", () => {
    render(
      <Field id="note" label="Nota" error="La nota es demasiado larga">
        <Input
          name="note"
          invalid={false}
          aria-invalid={false}
          aria-describedby="note-extra"
        />
      </Field>,
    );

    const input = screen.getByLabelText("Nota");

    expect(input).toBeValid();
    expect(input).toHaveAttribute("aria-describedby", "note-extra note-error");
  });
});
