/**
 * Caller-owned unit of work of the recurrence module.
 *
 * Generating one due date writes four things that only make sense together:
 * the reservation of that date, the movement, its tag associations and the new
 * next date of the rule. The caller owns the boundary and passes the same unit
 * to every call, so a due date is either fully materialised or not processed at
 * all, and a retry after a failure finds the database exactly as it was.
 *
 * The module declares its own port instead of borrowing the one of another
 * module: each module owns its contracts. The shape is deliberately the same as
 * the transaction and classification ones, so a single runtime unit satisfies
 * all of them and the generator can write a movement through its owning port
 * inside the same SQL transaction.
 */

/** Work the caller owns and shares between repository calls. */
export interface UnitOfWork {
  /**
   * Tells whether the work already runs inside a SQL transaction that can roll
   * back. A unit that is not transactional commits every statement on its own,
   * so generating a due date rejects it instead of risking a reserved date
   * whose movement was never written.
   */
  readonly isTransactional: boolean;
}
