"use client";

import { useEffect, useId, useRef } from "react";

import { Button } from "../../../shared/ui/button";
import { historyCopy } from "./history-copy";

export type HistoryRowAction = "edit" | "duplicate" | "delete";

export interface HistoryRowMenuProps {
  readonly label: string;
  readonly onAction: (action: HistoryRowAction) => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
}

/**
 * Per-row actions menu of a history movement.
 *
 * The trigger names the movement so each row stays distinguishable. Escape and
 * a pointer outside close it; choosing an item both closes and reports the
 * action so the parent can open the matching dialog with that row's id.
 */
export function HistoryRowMenu({
  label,
  onAction,
  onOpenChange,
  open,
}: HistoryRowMenuProps) {
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onOpenChange(false);
      }
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (
        target instanceof Node &&
        rootRef.current !== null &&
        !rootRef.current.contains(target)
      ) {
        onOpenChange(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [open, onOpenChange]);

  function choose(action: HistoryRowAction) {
    onOpenChange(false);
    onAction(action);
  }

  return (
    <div className="relative" ref={rootRef}>
      <Button
        aria-controls={open ? menuId : undefined}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={historyCopy.actionsOf(label)}
        className="h-11 min-h-11 w-auto shrink-0 px-3 text-sm"
        onClick={() => {
          onOpenChange(!open);
        }}
        variant="secondary"
      >
        {historyCopy.actions}
      </Button>
      {open ? (
        <ul
          className="border-border bg-surface-raised absolute right-0 z-20 mt-1 flex min-w-44 flex-col gap-1 rounded-lg border p-1 shadow-lg"
          id={menuId}
          role="menu"
          aria-label={historyCopy.actionsOf(label)}
        >
          <li role="none">
            <button
              className="text-body-sm text-text hover:bg-surface-hover focus-visible:outline-primary-bright w-full rounded-md px-3 py-2 text-left focus-visible:outline-2"
              onClick={() => {
                choose("edit");
              }}
              role="menuitem"
              type="button"
            >
              {historyCopy.editAction}
            </button>
          </li>
          <li role="none">
            <button
              className="text-body-sm text-text hover:bg-surface-hover focus-visible:outline-primary-bright w-full rounded-md px-3 py-2 text-left focus-visible:outline-2"
              onClick={() => {
                choose("duplicate");
              }}
              role="menuitem"
              type="button"
            >
              {historyCopy.duplicateAction}
            </button>
          </li>
          <li role="none">
            <button
              className="text-body-sm text-danger hover:bg-surface-hover focus-visible:outline-primary-bright w-full rounded-md px-3 py-2 text-left focus-visible:outline-2"
              onClick={() => {
                choose("delete");
              }}
              role="menuitem"
              type="button"
            >
              {historyCopy.deleteAction}
            </button>
          </li>
        </ul>
      ) : null}
    </div>
  );
}
