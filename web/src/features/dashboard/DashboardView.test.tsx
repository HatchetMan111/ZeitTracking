import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StatsPayload, SummaryPayload } from "../../api/types";
import { CategoryDonut } from "./CategoryDonut";
import { DashboardView } from "./DashboardView";
import { KpiCards } from "./KpiCards";
import { PeriodPicker } from "./PeriodPicker";

const summary: SummaryPayload = {
  now: 0,
  totals: { today_minutes: 30, week_minutes: 90, month_minutes: 120, all_minutes: 600 },
  lifetime_by_category: [],
  first_entry_date: "2026-01-01",
};

const stats: StatsPayload = {
  from: "2026-11-09", to: "2026-11-15", group_by: "category", total_minutes: 100,
  rows: [
    { key: "1", label: "Arbeit", color: "#FF375F", minutes: 60 },
    { key: "2", label: "Filme", color: "#FF6482", minutes: 40 },
  ],
  days: [],
  entries: [],
};

const emptyStats: StatsPayload = {
  from: "2026-11-09", to: "2026-11-15", group_by: "category", total_minutes: 0,
  rows: [],
  days: [],
  entries: [],
};

const range = { from: "2026-11-09", to: "2026-11-15" };

describe("dashboard", () => {
  it("renders KPI values", () => {
    render(<KpiCards summary={summary} />);
    expect(screen.getByTestId("kpi-today")).toHaveTextContent("30m");
    expect(screen.getByTestId("kpi-all")).toHaveTextContent("10h 00m");
  });
  it("renders donut legend percentages", () => {
    render(<CategoryDonut rows={stats.rows} total={100} />);
    expect(screen.getByText("60.0%")).toBeInTheDocument();
    expect(screen.getByText("40.0%")).toBeInTheDocument();
  });
  it("changes period", () => {
    const onPeriod = vi.fn();
    render(
      <PeriodPicker period="week" range={{ from: "2026-11-09", to: "2026-11-15" }} onPeriod={onPeriod} />,
    );
    fireEvent.click(screen.getByTestId("period-month"));
    expect(onPeriod).toHaveBeenCalledWith("month", undefined);
  });
  it("renders the empty message but keeps the period picker", () => {
    render(
      <DashboardView
        summary={summary}
        stats={emptyStats}
        period="week"
        range={range}
        onPeriod={vi.fn()}
      />,
    );
    expect(screen.getByText("Noch keine Zeit im gewählten Zeitraum.")).toBeInTheDocument();
    expect(screen.getByTestId("period-month")).toBeInTheDocument();
    expect(screen.queryByTestId("kpi-today")).not.toBeInTheDocument();
  });
  it("renders no NaN or Infinity for a zero-total donut", () => {
    const { container } = render(
      <CategoryDonut rows={[{ key: "1", label: "Arbeit", color: "#FF375F", minutes: 0 }]} total={0} />,
    );
    expect(screen.getByTestId("donut")).toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
    expect(screen.getAllByText("0m").length).toBeGreaterThan(0);
    expect(screen.getByText("0.0%")).toBeInTheDocument();
  });
  it("emits a custom range when a date changes", () => {
    const onPeriod = vi.fn();
    render(<PeriodPicker period="week" range={range} onPeriod={onPeriod} />);
    fireEvent.change(screen.getByLabelText("Von"), { target: { value: "2026-11-01" } });
    expect(onPeriod).toHaveBeenCalledWith("custom", { from: "2026-11-01", to: "2026-11-15" });
  });
  it("ignores empty custom date values and keeps the other bound", () => {
    const onPeriod = vi.fn();
    render(<PeriodPicker period="custom" range={range} onPeriod={onPeriod} />);
    fireEvent.change(screen.getByLabelText("Bis"), { target: { value: "" } });
    expect(onPeriod).not.toHaveBeenCalled();
  });
  it("renders KPIs, donut, top categories and at most five bars", () => {
    const rows = ["A", "B", "C", "D", "E", "F"].map((label, index) => ({
      key: String(index),
      label,
      color: "#FF375F",
      minutes: 60 - index * 10,
    }));
    const full: StatsPayload = { ...stats, total_minutes: 210, rows };
    const { container } = render(
      <DashboardView summary={summary} stats={full} period="week" range={range} onPeriod={vi.fn()} />,
    );
    expect(screen.getByTestId("kpi-today")).toBeInTheDocument();
    expect(screen.getByTestId("donut")).toBeInTheDocument();
    expect(container.querySelectorAll(".top-categories li")).toHaveLength(5);
  });
});
