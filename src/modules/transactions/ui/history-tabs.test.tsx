import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useSearchParams: () =>
    new URLSearchParams("tab=all&q=Caf%C3%A9+%26+t%C3%A9&type=expense"),
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

import { HISTORY_ALL_TAB, historyCopy } from "./history-copy";
import { HistoryTabs } from "./history-tabs";

describe("HistoryTabs", () => {
  it("keeps encoded filters on both section links", () => {
    render(<HistoryTabs activeTab={HISTORY_ALL_TAB} />);

    const todos = screen.getByRole("tab", { name: historyCopy.allTab });
    const recurring = screen.getByRole("tab", {
      name: historyCopy.recurringTab,
    });

    expect(todos.getAttribute("href")).toContain("q=Caf%C3%A9");
    expect(todos.getAttribute("href")).toContain("type=expense");
    expect(recurring.getAttribute("href")).toContain("tab=recurring");
    expect(recurring.getAttribute("href")).toContain("type=expense");
    expect(recurring.getAttribute("href")).toContain("q=Caf%C3%A9");
  });
});
