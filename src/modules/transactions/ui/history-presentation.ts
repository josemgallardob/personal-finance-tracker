/**
 * Presentation of one history row from the public movement DTO.
 *
 * The list never re-sorts the page: the API already returns newest first.
 * Concept falls back to the category name, then to a generic label, so a
 * movement without free text still has an identifiable title.
 */

import type { CategoryDto } from "../../classification/contracts/category";
import type { TagDto } from "../../classification/contracts/tag";
import {
  formatMoneyMinorAsEur,
  type MoneyMinor,
} from "../../../shared/domain/money";
import { formatLocalDateAsSpanish } from "./transaction-form-schema";
import type { TransactionDto } from "../contracts/transaction";
import { historyCopy } from "./history-copy";

function asMoneyMinor(amountMinor: number): MoneyMinor {
  return amountMinor as MoneyMinor;
}

/** Category name of a movement, or the generic fallback when it is unknown. */
export function historyCategoryLabel(
  transaction: TransactionDto,
  categories: readonly CategoryDto[],
): string {
  return (
    categories.find((category) => category.id === transaction.categoryId)
      ?.name ?? historyCopy.fallbackLabel
  );
}

/**
 * Visible title of a row: trimmed concept, otherwise the category, otherwise
 * the generic fallback.
 */
export function historyPrimaryLabel(
  transaction: TransactionDto,
  categories: readonly CategoryDto[],
): string {
  const concept = transaction.concept?.trim();
  if (concept) {
    return concept;
  }

  return historyCategoryLabel(transaction, categories);
}

/** Signed EUR amount with a visible `+` or `−`, independent of color. */
export function historySignedAmount(transaction: TransactionDto): string {
  const amount = formatMoneyMinorAsEur(asMoneyMinor(transaction.amountMinor));
  return transaction.type === "expense" ? `−${amount}` : `+${amount}`;
}

/** Type word that accompanies the signed amount so color is never the only cue. */
export function historyTypeLabel(transaction: TransactionDto): string {
  return transaction.type === "expense"
    ? historyCopy.expense
    : historyCopy.income;
}

/** Tag names in the order of the movement, skipping identifiers without a name. */
export function historyTagNames(
  transaction: TransactionDto,
  tags: readonly TagDto[],
): readonly string[] {
  const tagsById = new Map(tags.map((tag) => [tag.id, tag.name]));
  return transaction.tagIds.flatMap((tagId) => {
    const name = tagsById.get(tagId);
    return name === undefined ? [] : [name];
  });
}

/** Spanish civil date of a movement. */
export function historyDateLabel(transaction: TransactionDto): string {
  return formatLocalDateAsSpanish(transaction.date);
}
