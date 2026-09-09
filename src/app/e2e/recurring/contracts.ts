/** Serializable result of the E2E-only recurrence command. */
export interface E2eRecurringRunResult {
  readonly ok: boolean;
  readonly generated: number;
  readonly skipped: number;
  readonly failed: number;
  readonly message: string | null;
}
