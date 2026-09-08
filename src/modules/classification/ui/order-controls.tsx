"use client";

/**
 * Accessible up/down controls for an active category.
 *
 * Drag is not required: each step is a labelled button, the first and last
 * rows disable the impossible direction, and a pending save disables both so
 * a second click cannot queue another incomplete order.
 */

import { Button } from "../../../shared/ui/button";
import { moveDownLabel, moveUpLabel, orderControlsCopy } from "./order-model";

export interface OrderControlsProps {
  readonly canMoveDown: boolean;
  readonly canMoveUp: boolean;
  readonly disabled?: boolean;
  readonly name: string;
  readonly onMoveDown: () => void;
  readonly onMoveUp: () => void;
}

export function OrderControls({
  canMoveDown,
  canMoveUp,
  disabled = false,
  name,
  onMoveDown,
  onMoveUp,
}: OrderControlsProps) {
  return (
    <div
      role="group"
      aria-label={`Orden de ${name}`}
      className="flex w-auto shrink-0 gap-2"
    >
      <Button
        aria-label={moveUpLabel(name)}
        className="w-auto px-4"
        disabled={disabled || !canMoveUp}
        variant="secondary"
        onClick={onMoveUp}
      >
        {orderControlsCopy.moveUp}
      </Button>
      <Button
        aria-label={moveDownLabel(name)}
        className="w-auto px-4"
        disabled={disabled || !canMoveDown}
        variant="secondary"
        onClick={onMoveDown}
      >
        {orderControlsCopy.moveDown}
      </Button>
    </div>
  );
}
