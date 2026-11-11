import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TrendChart } from "./TrendChart";

describe("TrendChart", () => {
  it("renders an accessible trend for points", () => {
    render(
      <TrendChart
        points={[
          { label: "11-09", minutes: 0 },
          { label: "11-10", minutes: 60 },
          { label: "11-11", minutes: 30 },
        ]}
      />,
    );
    expect(screen.getByTestId("trend")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Zeitverlauf" })).toBeInTheDocument();
    expect(screen.getByText("max. 1h 00m")).toBeInTheDocument();
  });

  it("does not produce NaN for empty points", () => {
    const { container } = render(<TrendChart points={[]} />);
    expect(screen.getByTestId("trend")).toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
  });

  it("does not produce NaN for a single point", () => {
    const { container } = render(<TrendChart points={[{ label: "11-09", minutes: 45 }]} />);
    expect(screen.getByTestId("trend")).toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
  });
});
