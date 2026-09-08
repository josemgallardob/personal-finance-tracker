/**
 * Caller-owned unit of work.
 *
 * A classification repository never opens, commits or rolls back a transaction
 * of its own. The caller decides the boundary and passes the same unit to every
 * repository call that must succeed or fail together, so a rename and the write
 * beside it cannot end up half applied. Only the infrastructure adapter knows
 * what backs the unit; the application layer only knows whether the work it was
 * given can still be rolled back.
 */

/** Work the caller owns and shares between repository calls. */
export interface UnitOfWork {
  /**
   * Tells whether the work already runs inside a transaction that can roll
   * back. A unit that is not transactional commits every statement on its own,
   * so a repository operation that writes more than one row rejects it instead
   * of leaving a partial result behind.
   */
  readonly isTransactional: boolean;
}
