/**
 * Caller-owned unit of work of the analytics module.
 *
 * A dashboard is not one figure but several: totals of the period, the monthly
 * series, the two expense breakdowns, the first movement and the recent
 * movements. They only add up to the same reality when they observe the same
 * data, so the caller owns the boundary and passes the same unit to every read
 * that must agree.
 *
 * The module declares its own port instead of borrowing the one of another
 * module: each module owns its contracts. The shape is deliberately the same as
 * the transaction and classification ones, so a single runtime unit satisfies
 * all of them.
 */

/** Work the caller owns and shares between repository calls. */
export interface UnitOfWork {
  /**
   * Tells whether the work already runs inside a SQL transaction. A read that
   * receives a unit which is not transactional opens a read snapshot of its
   * own, so that single read is still consistent; only a unit the caller keeps
   * open makes several reads agree with each other.
   */
  readonly isTransactional: boolean;
}
