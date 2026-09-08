/**
 * Reorder helpers for active classification rows.
 *
 * Only active items of one list participate. Archived rows stay after them, so
 * a failed save can restore the previous active sequence without inventing a
 * new place for an archived category.
 */

export const orderControlsCopy = {
  moveUp: "Subir",
  moveDown: "Bajar",
  saveFailed:
    "No se ha podido guardar el orden. La lista ha vuelto a la posición anterior.",
  retry: "Reintentar el orden",
} as const;

/** Accessible name of the control that moves a row up. */
export function moveUpLabel(name: string): string {
  return `Subir ${name}`;
}

/** Accessible name of the control that moves a row down. */
export function moveDownLabel(name: string): string {
  return `Bajar ${name}`;
}

export interface OrderableItem {
  readonly id: string;
  readonly isArchived: boolean;
}

/**
 * Moves an active row one step among the other active rows.
 *
 * Returns `null` at the ends of the active sequence so the caller can leave
 * the list unchanged instead of sending an incomplete order.
 */
export function moveActiveItem<TItem extends OrderableItem>(
  items: readonly TItem[],
  id: string,
  direction: -1 | 1,
): TItem[] | null {
  const active = items.filter((item) => !item.isArchived);
  const archived = items.filter((item) => item.isArchived);
  const index = active.findIndex((item) => item.id === id);
  const target = index + direction;

  if (index < 0 || target < 0 || target >= active.length) {
    return null;
  }

  const nextActive = [...active];
  const current = nextActive[index];
  const neighbour = nextActive[target];

  if (current === undefined || neighbour === undefined) {
    return null;
  }

  nextActive[index] = neighbour;
  nextActive[target] = current;

  return [...nextActive, ...archived];
}

/** Active identifiers in the order a reorder request must send. */
export function activeItemIds(
  items: readonly OrderableItem[],
): readonly string[] {
  return items.filter((item) => !item.isArchived).map((item) => item.id);
}
