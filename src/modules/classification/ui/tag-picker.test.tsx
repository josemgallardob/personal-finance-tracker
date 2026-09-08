import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type { TagDto } from "../contracts/tag";
import {
  TagPicker,
  tagPickerCopy,
  toTagInputs,
  type TagSelection,
} from "./tag-picker";

const tags: TagDto[] = [
  { id: "tag-trips", name: "Viajes", isArchived: false },
  { id: "tag-home", name: "Casa", isArchived: false },
  { id: "tag-old", name: "Archivado", isArchived: true },
];

function Harness({
  initial = [],
  onChange = () => undefined,
  retainedTagIds,
}: {
  initial?: TagSelection[];
  onChange?: (selections: TagSelection[]) => void;
  retainedTagIds?: readonly string[];
}) {
  const [value, setValue] = useState<TagSelection[]>(initial);

  return (
    <TagPicker
      retainedTagIds={retainedTagIds}
      tags={tags}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

describe("TagPicker", () => {
  it("adds an existing tag and ignores a second click of the same tag", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await user.click(screen.getByRole("option", { name: "Viajes" }));
    await user.type(
      screen.getByRole("combobox", { name: tagPickerCopy.label }),
      "Viajes",
    );
    await user.keyboard("{Enter}");

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith([
      { kind: "existing", tagId: "tag-trips", name: "Viajes" },
    ]);
    expect(
      screen.getByRole("list", { name: tagPickerCopy.selected }),
    ).toHaveTextContent("Viajes");
  });

  it("keeps a typed name pending until submit and does not call fetch", async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    render(<Harness />);

    await user.type(
      screen.getByRole("combobox", { name: tagPickerCopy.label }),
      "Café",
    );
    await user.click(screen.getByRole("option", { name: /Crear «Café»/ }));

    expect(screen.getByText("Café (pendiente)")).toBeVisible();
    expect(fetchImpl).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("reuses an existing tag when the typed name matches ignoring case", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const combobox = screen.getByRole("combobox", {
      name: tagPickerCopy.label,
    });
    await user.type(combobox, "viajes");
    await user.keyboard("{Enter}");

    expect(screen.getByText("Viajes")).toBeVisible();
    expect(screen.queryByText(/pendiente/)).not.toBeInTheDocument();
  });

  it("does not treat cafe and café as the same pending name", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const combobox = screen.getByRole("combobox", {
      name: tagPickerCopy.label,
    });

    await user.type(combobox, "cafe");
    await user.click(
      screen.getByRole("button", { name: tagPickerCopy.create }),
    );
    await user.type(combobox, "café");
    await user.click(
      screen.getByRole("button", { name: tagPickerCopy.create }),
    );

    const selected = screen.getByRole("list", { name: tagPickerCopy.selected });
    expect(within(selected).getByText("cafe (pendiente)")).toBeVisible();
    expect(within(selected).getByText("café (pendiente)")).toBeVisible();
  });

  it("deduplicates a pending name that matches a selected existing tag", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Harness
        initial={[{ kind: "existing", tagId: "tag-trips", name: "Viajes" }]}
        onChange={onChange}
      />,
    );

    await user.type(
      screen.getByRole("combobox", { name: tagPickerCopy.label }),
      "VIAJES",
    );
    await user.keyboard("{Enter}");

    expect(onChange).not.toHaveBeenCalled();
  });

  it("hides archived tags unless they are already retained on the movement", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness />);

    expect(
      screen.queryByRole("option", { name: "Archivado" }),
    ).not.toBeInTheDocument();

    rerender(
      <TagPicker
        retainedTagIds={["tag-old"]}
        tags={tags}
        value={[]}
        onChange={() => undefined}
      />,
    );

    await user.click(screen.getByRole("option", { name: "Archivado" }));
    expect(screen.getByRole("option", { name: "Archivado" })).toBeEnabled();
  });

  it("cancelling the typed query does not keep a pending tag", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    const combobox = screen.getByRole("combobox", {
      name: tagPickerCopy.label,
    });
    await user.type(combobox, "Temporal");
    await user.clear(combobox);

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByText(/pendiente/)).not.toBeInTheDocument();
  });

  it("maps selections to TagInput values without creating identifiers", () => {
    expect(
      toTagInputs([
        { kind: "existing", tagId: "tag-trips", name: "Viajes" },
        { kind: "pending", name: "Café" },
      ]),
    ).toEqual([{ tagId: "tag-trips" }, { name: "Café" }]);
  });

  it("lets the keyboard add and remove tags", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const combobox = screen.getByRole("combobox", {
      name: tagPickerCopy.label,
    });
    await user.type(combobox, "Extra");
    await user.keyboard("{Enter}");
    expect(screen.getByText("Extra (pendiente)")).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: "Quitar Extra (pendiente)" }),
    );
    expect(screen.queryByText("Extra (pendiente)")).not.toBeInTheDocument();
  });

  it("stops adding tags at the movement limit", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const initial = Array.from({ length: 20 }, (_, index) => ({
      kind: "pending" as const,
      name: `Tag ${index}`,
    }));
    render(<Harness initial={initial} onChange={onChange} />);

    expect(
      screen.getByRole("combobox", { name: tagPickerCopy.label }),
    ).toBeDisabled();
    await user.click(screen.getByRole("button", { name: tagPickerCopy.add }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("ignores typed names that are too long or contain control characters", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const combobox = screen.getByRole("combobox", {
      name: tagPickerCopy.label,
    });

    await user.type(combobox, "a".repeat(81));
    await user.keyboard("{Enter}");
    await user.clear(combobox);
    fireEvent.change(combobox, { target: { value: "Hola\u0007" } });
    await user.keyboard("{Enter}");

    expect(onChange).not.toHaveBeenCalled();
  });
});
