"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { FinancialDataProvider } from "../client/financial-data-provider";
import { cx } from "./class-names";

export const appShellCopy = {
  brand: "Mis finanzas",
  categories: "Categorías",
  home: "Inicio",
  navLabel: "Principal",
  skipToContent: "Saltar al contenido",
  transactions: "Movimientos",
} as const;

export const appShellLinks = [
  { href: "/", label: appShellCopy.home },
  { href: "/transactions", label: appShellCopy.transactions },
  { href: "/categories", label: appShellCopy.categories },
] as const;

export function isAppShellPathActive(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/";
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

export interface AppShellProps {
  children: ReactNode;
}

function NavigationList({
  pathname,
  variant,
}: {
  pathname: string;
  variant: "side" | "bottom";
}) {
  return (
    <ul
      className={
        variant === "bottom"
          ? "flex w-full max-w-full items-stretch gap-1"
          : "flex w-full max-w-full flex-col gap-1"
      }
    >
      {appShellLinks.map((link) => {
        const active = isAppShellPathActive(pathname, link.href);

        return (
          <li key={link.href} className="min-w-0 flex-1">
            <Link
              aria-current={active ? "page" : undefined}
              className={cx(
                "text-body-sm flex min-h-11 w-full max-w-full items-center justify-center rounded-md px-3 text-center font-semibold",
                "focus-visible:outline-primary-bright focus-visible:outline-2 focus-visible:outline-offset-2",
                active
                  ? "bg-surface-hover text-text"
                  : "text-text-muted hover:bg-surface-hover hover:text-text",
              )}
              href={link.href}
            >
              {link.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();

  return (
    <FinancialDataProvider>
      <div className="bg-surface text-text min-h-screen w-full max-w-full">
        <a
          className="bg-primary text-text sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:px-3 focus:py-2"
          href="#contenido-principal"
        >
          {appShellCopy.skipToContent}
        </a>
        <aside className="border-border bg-surface-deep hidden min-h-screen w-48 max-w-full flex-col gap-6 border-r p-4 sm:fixed sm:inset-y-0 sm:left-0 sm:flex">
          <p className="text-body font-semibold">{appShellCopy.brand}</p>
          <nav aria-label={appShellCopy.navLabel}>
            <NavigationList pathname={pathname} variant="side" />
          </nav>
        </aside>
        <nav
          aria-label={appShellCopy.navLabel}
          className="border-border bg-surface-deep fixed inset-x-0 bottom-0 z-40 w-full max-w-full border-t p-2 sm:hidden"
        >
          <NavigationList pathname={pathname} variant="bottom" />
        </nav>
        <main
          id="contenido-principal"
          className="w-full max-w-full min-w-0 px-4 py-6 pb-24 sm:pb-6 sm:pl-52"
        >
          {children}
        </main>
      </div>
    </FinancialDataProvider>
  );
}
