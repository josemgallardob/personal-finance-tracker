/**
 * Owner of the transaction boundary of one due date.
 *
 * The generator is the only use case of the MVP that owns more than one SQL
 * transaction: each due date must commit on its own so that a failure on the
 * fourth recovered month keeps the three already materialised, and so that a
 * retry resumes instead of starting over. It therefore cannot receive a single
 * open unit from its caller like every other use case; it receives this runner
 * and asks for one boundary per date.
 *
 * The port is declared here so the use case stays free of the driver: the
 * adapter decides what a transaction is, and the use case only decides what
 * belongs inside one.
 */

import type { RecurringResult } from "./recurring-repository";
import type { UnitOfWork } from "./unit-of-work";

/** Runs one unit of work per due date, committing or rolling back each one. */
export interface DueDateRunner<TUnit extends UnitOfWork = UnitOfWork> {
  /**
   * Runs `work` inside one SQL transaction.
   *
   * The transaction commits only when `work` reports success. A refusal rolls
   * every statement back and comes back unchanged, so a rejected due date
   * leaves neither a reservation, nor a movement, nor an advanced rule behind.
   */
  runForDueDate<TValue>(
    work: (unit: TUnit) => RecurringResult<TValue>,
  ): RecurringResult<TValue>;
}
