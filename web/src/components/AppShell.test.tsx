import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AppShell from "./AppShell";

describe("AppShell", () => {
  it("renders the three tabs and reports navigation", () => {
    const onNavigate = vi.fn();
    const onLogout = vi.fn();
    render(
      <AppShell active="day" onNavigate={onNavigate} total="2h 10m" onLogout={onLogout}>
        <p>Inhalt</p>
      </AppShell>,
    );
    expect(screen.getByTestId("bottom-day")).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("2h 10m")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("bottom-dashboard"));
    expect(onNavigate).toHaveBeenCalledWith("dashboard");
    fireEvent.click(screen.getByTestId("sidebar-logout"));
    expect(onLogout).toHaveBeenCalled();
  });
});
