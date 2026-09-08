/**
 * Public category representation of the HTTP API.
 *
 * The DTO is the only shape a client may see: an identifier, the written name,
 * the immutable type and whether the category can still be assigned. Archive
 * is a boolean flag derived from the domain timestamp, so a response never
 * carries `archivedAt`, a workspace identifier, a comparison key or a
 * storage row.
 */

import type { TransactionType } from "../../transactions/domain/transaction-type";
import { type Category, isCategoryActive } from "../domain/category";

/** Category as the API returns it. */
export interface CategoryDto {
  readonly id: string;
  readonly name: string;
  readonly type: TransactionType;
  readonly isArchived: boolean;
}

/** Maps a domain category to the documented HTTP representation. */
export function toCategoryDto(category: Category): CategoryDto {
  return {
    id: category.id,
    name: category.name,
    type: category.type,
    isArchived: !isCategoryActive(category),
  };
}
