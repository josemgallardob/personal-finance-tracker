import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { useFinancialDataRevision } from "../client/financial-data-provider";
import { AppShell, appShellCopy, isAppShellPathActive } from "./app-shell";

const { usePathname } = vi.hoisted(() => ({
  usePathname: vi.fn(() => "/"),
}));

vi.mock("next/navigation", () => ({
  usePathname,
}));

vi.mock("next/link", () => ({
  default: function MockLink({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
  }) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  },
}));

function FinancialRevisionReadout() {
  const { revision, refreshEpoch } = useFinancialDataRevision();

  return (
    <p>
      revision:{revision} epoch:{refreshEpoch}
    </p>
  );
}

describe("isAppShellPathActive", () => {
  it("marks only the home route as Inicio", () => {
    expect(isAppShellPathActive("/", "/")).toBe(true);
    expect(isAppShellPathActive("/transactions", "/")).toBe(false);
  });

  it("marks a destination and its nested paths as active", () => {
    expect(isAppShellPathActive("/transactions", "/transactions")).toBe(true);
    expect(isAppShellPathActive("/transactions/123", "/transactions")).toBe(
      true,
    );
    expect(isAppShellPathActive("/categories", "/transactions")).toBe(false);
  });
});

describe("AppShell", () => {
  it("exposes Spanish destinations without operational actions", () => {
    usePathname.mockReturnValue("/");
    render(
      <AppShell>
        <p>Contenido de inicio</p>
      </AppShell>,
    );

    const navigation = screen.getAllByRole("navigation", { name: "Principal" });
    expect(navigation).toHaveLength(2);

    for (const nav of navigation) {
      expect(within(nav).getByRole("link", { name: "Inicio" })).toHaveAttribute(
        "href",
        "/",
      );
      expect(
        within(nav).getByRole("link", { name: "Movimientos" }),
      ).toHaveAttribute("href", "/transactions");
      expect(
        within(nav).getByRole("link", { name: "Categorías" }),
      ).toHaveAttribute("href", "/categories");
    }

    expect(
      screen.queryByRole("button", { name: /añadir/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(appShellCopy.brand)).toBeVisible();
    expect(
      screen.getByRole("link", { name: appShellCopy.skipToContent }),
    ).toHaveAttribute("href", "#contenido-principal");
  });

  it("marks the current route as the active page", () => {
    usePathname.mockReturnValue("/categories");
    render(
      <AppShell>
        <p>Catálogo</p>
      </AppShell>,
    );

    const categoryLinks = screen.getAllByRole("link", { name: "Categorías" });
    const homeLinks = screen.getAllByRole("link", { name: "Inicio" });

    for (const link of categoryLinks) {
      expect(link).toHaveAttribute("aria-current", "page");
    }
    for (const link of homeLinks) {
      expect(link).not.toHaveAttribute("aria-current");
    }
  });

  it("keeps navigation keyboard reachable at the 320 px width", async () => {
    usePathname.mockReturnValue("/transactions");
    const user = userEvent.setup();
    render(
      <AppShell>
        <p>Historial</p>
      </AppShell>,
    );

    await user.tab();
    expect(
      screen.getByRole("link", { name: appShellCopy.skipToContent }),
    ).toHaveFocus();

    const bottomNav = screen
      .getAllByRole("navigation", { name: "Principal" })
      .find((nav) => nav.className.includes("sm:hidden"));
    expect(bottomNav).toBeDefined();
    expect(bottomNav?.className).toContain("max-w-full");

    const movementLink = within(bottomNav as HTMLElement).getByRole("link", {
      name: "Movimientos",
    });
    expect(movementLink.className).toContain("min-h-11");
    expect(movementLink.className).toContain("max-w-full");
    expect(movementLink).toHaveAttribute("aria-current", "page");
  });

  it("offers descendant pages a financial revision channel", () => {
    usePathname.mockReturnValue("/");
    render(
      <AppShell>
        <FinancialRevisionReadout />
      </AppShell>,
    );

    expect(screen.getByText("revision:0 epoch:0")).toBeVisible();
  });
});
