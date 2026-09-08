import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { OrderControls } from "./order-controls";
import { moveDownLabel, moveUpLabel } from "./order-model";

describe("OrderControls", () => {
  it("disables the impossible direction at each end and calls the other", async () => {
    const user = userEvent.setup();
    const onMoveUp = vi.fn();
    const onMoveDown = vi.fn();

    const { rerender } = render(
      <OrderControls
        canMoveDown
        canMoveUp={false}
        name="Alquiler"
        onMoveDown={onMoveDown}
        onMoveUp={onMoveUp}
      />,
    );

    const group = screen.getByRole("group", { name: "Orden de Alquiler" });
    expect(group).toBeVisible();
    expect(
      screen.getByRole("button", { name: moveUpLabel("Alquiler") }),
    ).toBeDisabled();

    await user.click(
      screen.getByRole("button", { name: moveDownLabel("Alquiler") }),
    );
    expect(onMoveDown).toHaveBeenCalledTimes(1);
    expect(onMoveUp).not.toHaveBeenCalled();

    rerender(
      <OrderControls
        canMoveDown={false}
        canMoveUp
        name="Alquiler"
        onMoveDown={onMoveDown}
        onMoveUp={onMoveUp}
      />,
    );

    expect(
      screen.getByRole("button", { name: moveDownLabel("Alquiler") }),
    ).toBeDisabled();
    await user.click(
      screen.getByRole("button", { name: moveUpLabel("Alquiler") }),
    );
    expect(onMoveUp).toHaveBeenCalledTimes(1);
  });

  it("blocks both directions while a save is pending", async () => {
    const user = userEvent.setup();
    const onMoveUp = vi.fn();
    const onMoveDown = vi.fn();

    render(
      <OrderControls
        canMoveDown
        canMoveUp
        disabled
        name="Alquiler"
        onMoveDown={onMoveDown}
        onMoveUp={onMoveUp}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: moveUpLabel("Alquiler") }),
    );
    await user.click(
      screen.getByRole("button", { name: moveDownLabel("Alquiler") }),
    );

    expect(onMoveUp).not.toHaveBeenCalled();
    expect(onMoveDown).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: moveUpLabel("Alquiler") }),
    ).toBeDisabled();
  });

  it("places both directions in the tab order", async () => {
    const user = userEvent.setup();

    render(
      <OrderControls
        canMoveDown
        canMoveUp
        name="Alquiler"
        onMoveDown={vi.fn()}
        onMoveUp={vi.fn()}
      />,
    );

    await user.tab();
    expect(
      screen.getByRole("button", { name: moveUpLabel("Alquiler") }),
    ).toHaveFocus();
    await user.tab();
    expect(
      screen.getByRole("button", { name: moveDownLabel("Alquiler") }),
    ).toHaveFocus();
  });
});
