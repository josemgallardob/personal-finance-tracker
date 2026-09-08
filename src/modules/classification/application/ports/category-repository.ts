/**
 * Category port.
 *
 * The port exposes exactly the operations the category stories need: a scoped
 * list, the two lookups uniqueness and editing depend on, and the four
 * mutations of the MVP. It is not a generic CRUD repository: a category is
 * never deleted, its type is never updated, and no caller can ask for rows
 * outside the workspace it is scoped to.
 *
 * Every method takes the caller-owned unit of work first, so a use case can run
 * a lookup and the write that depends on it inside one transaction.
 */

import type { Timestamp } from "../../../../shared/domain/timestamp";
import type { TransactionType } from "../../../transactions/domain/transaction-type";
import type { Category, CategoryId } from "../../domain/category";
import type {
  ClassificationResult,
  ClassificationStatus,
  WorkspaceScope,
} from "./classification-repository";
import type { UnitOfWork } from "./unit-of-work";

/** Scoped list of categories, optionally narrowed to a single type. */
export interface CategoryListQuery extends WorkspaceScope {
  readonly status: ClassificationStatus;
  readonly type?: TransactionType;
}

/** Lookup of a single category by identifier. */
export interface CategoryByIdQuery extends WorkspaceScope {
  readonly categoryId: CategoryId;
}

/** Lookup of the active category that owns a normalized name in a type. */
export interface CategoryByNameQuery extends WorkspaceScope {
  readonly type: TransactionType;
  readonly normalizedName: string;
}

/** Insertion of a category the domain already validated. */
export interface InsertCategoryCommand extends WorkspaceScope {
  readonly category: Category;
}

/**
 * Rename of an existing category.
 *
 * The name comes from the domain contract that accepted it. The adapter stores
 * its normalized written form together with the comparison key uniqueness uses,
 * so both stay consistent. A rename never changes the type, the order or the
 * archival mark.
 */
export interface RenameCategoryCommand extends WorkspaceScope {
  readonly categoryId: CategoryId;
  readonly name: string;
}

/**
 * New order of the active categories of one type.
 *
 * The list must be the complete set of active identifiers of that type, without
 * duplicates and without identifiers of another type, another workspace or an
 * archived category.
 */
export interface ReorderCategoriesCommand extends WorkspaceScope {
  readonly type: TransactionType;
  readonly orderedCategoryIds: readonly CategoryId[];
}

/** Archival of a category, which keeps its history readable. */
export interface ArchiveCategoryCommand extends WorkspaceScope {
  readonly categoryId: CategoryId;
  readonly archivedAt: Timestamp;
}

/** Focused storage contract of categories. */
export interface CategoryRepository<
  TUnitOfWork extends UnitOfWork = UnitOfWork,
> {
  /**
   * Lists the categories of a workspace in a stable order: active rows first,
   * then by order, normalized name and identifier, so two calls that see the
   * same rows return the same sequence.
   */
  listCategories(
    unit: TUnitOfWork,
    query: CategoryListQuery,
  ): ClassificationResult<readonly Category[]>;

  /** Reads one category of the workspace, or `null` when it has none. */
  findCategoryById(
    unit: TUnitOfWork,
    query: CategoryByIdQuery,
  ): ClassificationResult<Category | null>;

  /**
   * Reads the active category that holds a normalized name inside a type.
   * Archived categories are ignored on purpose: their names may repeat once the
   * active collision is gone, so only an active row can block a new name.
   */
  findActiveCategoryByNormalizedName(
    unit: TUnitOfWork,
    query: CategoryByNameQuery,
  ): ClassificationResult<Category | null>;

  /**
   * Inserts a category and returns the stored row. A name already taken by an
   * active category of the same type is refused by the database constraint, so
   * two concurrent writers cannot both win.
   */
  insertCategory(
    unit: TUnitOfWork,
    command: InsertCategoryCommand,
  ): ClassificationResult<Category>;

  /** Renames a category and returns the stored row. */
  renameCategory(
    unit: TUnitOfWork,
    command: RenameCategoryCommand,
  ): ClassificationResult<Category>;

  /**
   * Applies a new order to the active categories of one type and returns them
   * in that order. It writes one row per category, so it requires a
   * transactional unit and never leaves a half-applied order behind.
   */
  reorderCategories(
    unit: TUnitOfWork,
    command: ReorderCategoriesCommand,
  ): ClassificationResult<readonly Category[]>;

  /**
   * Archives an active category and returns the stored row. Archiving a
   * category that is already archived changes nothing and is refused.
   */
  archiveCategory(
    unit: TUnitOfWork,
    command: ArchiveCategoryCommand,
  ): ClassificationResult<Category>;
}
