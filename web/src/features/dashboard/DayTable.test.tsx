import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DayTable } from "./DayTable";

describe("DayTable", () => {
  it("renders entry details and duration", () => {
    render(
      <DayTable
        timezone="Europe/Berlin"
        entries={[{
          id: 7, category_id: 2, label: "Filme", color: "#FF6482",
          started_at: 1794301200000, effective_end: 1794304800000,
          minutes: 60, note: "Dune",
        }]}
      />,
    );
    expect(screen.getByText("Dune")).toBeInTheDocument();
    expect(screen.getByText("1h 00m")).toBeInTheDocument();
    expect(screen.getByText("Filme")).toBeInTheDocument();
  });

  it("renders a timezone-aware day and clock range", () => {
    render(
      <DayTable
        timezone="Europe/Berlin"
        entries={[{
          id: 7, category_id: 2, label: "Filme", color: "#FF6482",
          started_at: 1794301200000, effective_end: 1794304800000,
          minutes: 60, note: "Dune",
        }]}
      />,
    );
    expect(screen.getByText("2026-11-10")).toBeInTheDocument();
    expect(screen.getByText("10:00–11:00")).toBeInTheDocument();
  });

  it("shows an empty state without entries", () => {
    render(<DayTable timezone="Europe/Berlin" entries={[]} />);
    expect(screen.getByText("Noch keine Einträge im gewählten Zeitraum.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
