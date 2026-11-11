import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StatsPayload, SummaryPayload } from "../../api/types";
import { CategoryDonut } from "./CategoryDonut";
import { DashboardView } from "./DashboardView";
import { KpiCards } from "./KpiCards";
import { PeriodPicker } from "./PeriodPicker";
import { TopCategories } from "./TopCategories";

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
  it("exposes the period picker as a labeled group", () => {
    render(<PeriodPicker period="week" range={range} onPeriod={vi.fn()} />);
    expect(screen.getByRole("group", { name: "Zeitraum" })).toBeInTheDocument();
  });
  it("uses the row-sum denominator for arcs and center when total differs", () => {
    render(<CategoryDonut rows={stats.rows} total={130} />);
    expect(screen.getByText("1h 40m")).toBeInTheDocument();
    expect(screen.queryByText("2h 10m")).not.toBeInTheDocument();
    expect(screen.getByText("60.0%")).toBeInTheDocument();
    expect(screen.getByText("40.0%")).toBeInTheDocument();
  });
  it("lays out donut arcs cumulatively with negative dash offsets", () => {
    const { container } = render(<CategoryDonut rows={stats.rows} total={130} />);
    expect(screen.getByText("1h 40m")).toBeInTheDocument();
    const arcs = [...container.querySelectorAll("circle[stroke-dasharray]")];
    expect(arcs).toHaveLength(2);
    const circumference = 2 * Math.PI * 99;
    const dash = (element: Element) =>
      element.getAttribute("stroke-dasharray")!.split(" ").map(Number);
    const offset = (element: Element) => Number(element.getAttribute("stroke-dashoffset"));
    expect(dash(arcs[0])[0]).toBeCloseTo(0.6 * circumference);
    expect(dash(arcs[1])[0]).toBeCloseTo(0.4 * circumference);
    expect(offset(arcs[0])).toBeCloseTo(0);
    expect(offset(arcs[1])).toBeCloseTo(-0.6 * circumference);
    expect(-offset(arcs[1]) + dash(arcs[1])[0]).toBeCloseTo(circumference);
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
  it("ignores a custom range whose end precedes its start", () => {
    const onPeriod = vi.fn();
    render(<PeriodPicker period="week" range={range} onPeriod={onPeriod} />);
    fireEvent.change(screen.getByLabelText("Bis"), { target: { value: "2026-11-01" } });
    expect(onPeriod).not.toHaveBeenCalled();
  });
  it("sorts top categories by minutes before slicing five", () => {
    const rows = [
      { key: "a", label: "A", color: "#111111", minutes: 10 },
      { key: "b", label: "B", color: "#222222", minutes: 50 },
      { key: "c", label: "C", color: "#333333", minutes: 30 },
      { key: "d", label: "D", color: "#444444", minutes: 20 },
      { key: "e", label: "E", color: "#555555", minutes: 40 },
      { key: "f", label: "F", color: "#666666", minutes: 5 },
    ];
    const { container } = render(<TopCategories rows={rows} />);
    const labels = [...container.querySelectorAll(".top-categories li span")].map(
      (node) => node.textContent,
    );
    expect(labels).toEqual(["B", "E", "C", "D", "A"]);
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
