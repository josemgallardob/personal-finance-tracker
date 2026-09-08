/**
 * Caller-owned unit of work of the transaction module.
 *
 * A transaction repository never opens, commits or rolls back a SQL
 * transaction of its own. The caller decides the boundary and passes the same
 * unit to every repository call that must succeed or fail together, so a
 * movement and its tag associations cannot end up half applied.
 *
 * The module declares its own port instead of borrowing the one of another
 * module: each module owns its contracts. The shape is deliberately the same
 * as the classification one, so a single runtime unit satisfies both and one
 * save can resolve tags and write the movement inside one transaction.
 */

/** Work the caller owns and shares between repository calls. */
export interface UnitOfWork {
  /**
   * Tells whether the work already runs inside a SQL transaction that can roll
   * back. A unit that is not transactional commits every statement on its own,
   * so an operation that writes more than one row rejects it instead of
   * leaving a movement without its associations behind.
   */
  readonly isTransactional: boolean;
}
