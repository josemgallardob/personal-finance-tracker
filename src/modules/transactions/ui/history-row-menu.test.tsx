import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { historyCopy } from "./history-copy";
import { HistoryRowMenu } from "./history-row-menu";

function Harness() {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState("ninguna");

  return (
    <div>
      <p>accion:{chosen}</p>
      <button type="button">Fuera</button>
      <HistoryRowMenu
        label="Supermercado"
        onAction={(action) => {
          setChosen(action);
        }}
        onOpenChange={setOpen}
        open={open}
      />
    </div>
  );
}

describe("HistoryRowMenu", () => {
  it("names the movement, closes on Escape, and reports the chosen action", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(
      screen.getByRole("button", {
        name: historyCopy.actionsOf("Supermercado"),
      }),
    );
    expect(screen.getByRole("menu")).toBeVisible();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: historyCopy.actionsOf("Supermercado"),
      }),
    );
    await user.click(
      screen.getByRole("menuitem", { name: historyCopy.editAction }),
    );
    expect(screen.getByText("accion:edit")).toBeVisible();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes when the pointer lands outside the menu", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(
      screen.getByRole("button", {
        name: historyCopy.actionsOf("Supermercado"),
      }),
    );
    expect(screen.getByRole("menu")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Fuera" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
