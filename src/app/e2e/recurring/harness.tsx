"use client";

import { useState } from "react";

import { Button } from "../../../shared/ui/button";
import { Field } from "../../../shared/ui/field";
import { Input } from "../../../shared/ui/input";
import type { E2eRecurringRunResult } from "./contracts";

export const e2eRecurringHarnessCopy = {
  dateHint: "Usa el formato aaaa-mm-dd.",
  dateLabel: "Fecha de prueba",
  description:
    "Ejecuta la recuperación de recurrencias con un reloj aislado de prueba.",
  run: "Ejecutar recuperación",
  running: "Ejecutando recuperación…",
  title: "Recurrencias de prueba",
} as const;

/** Client control for the E2E-only server action, not a production endpoint. */
export function E2eRecurringHarness() {
  const [date, setDate] = useState("2026-09-08");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function run(): Promise<void> {
    setPending(true);
    setResult(null);
    const response = await fetch("/e2e/recurring/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ today: date }),
    });
    const outcome = (await response.json()) as E2eRecurringRunResult;
    setPending(false);
    setResult(
      outcome.message ??
        `Generadas: ${outcome.generated}; omitidas: ${outcome.skipped}; fallidas: ${outcome.failed}.`,
    );
  }

  return (
    <section
      aria-labelledby="e2e-recurring-title"
      className="flex w-full max-w-xl flex-col gap-4"
    >
      <header>
        <h1
          className="text-heading-sm text-text font-medium"
          id="e2e-recurring-title"
        >
          {e2eRecurringHarnessCopy.title}
        </h1>
        <p className="text-body text-text-muted mt-2">
          {e2eRecurringHarnessCopy.description}
        </p>
      </header>
      <Field
        hint={e2eRecurringHarnessCopy.dateHint}
        id="e2e-recurring-date"
        label={e2eRecurringHarnessCopy.dateLabel}
      >
        <Input
          disabled={pending}
          id="e2e-recurring-date"
          type="date"
          value={date}
          onChange={(event) => {
            setDate(event.target.value);
          }}
        />
      </Field>
      <Button
        pending={pending}
        type="button"
        onClick={() => {
          void run();
        }}
      >
        {pending
          ? e2eRecurringHarnessCopy.running
          : e2eRecurringHarnessCopy.run}
      </Button>
      {result ? (
        <p className="text-body-sm text-text" role="status">
          {result}
        </p>
      ) : null}
    </section>
  );
}
