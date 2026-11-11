import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Heatmap } from "./Heatmap";

describe("Heatmap", () => {
  it("renders five levels with accessible titles", () => {
    const { container } = render(
      <Heatmap
        days={[
          { date: "2026-11-09", minutes: 0 },
          { date: "2026-11-10", minutes: 10 },
          { date: "2026-11-11", minutes: 45 },
          { date: "2026-11-12", minutes: 90 },
          { date: "2026-11-13", minutes: 200 },
        ]}
      />,
    );
    expect(container.querySelectorAll(".heat-1").length).toBe(1);
    expect(container.querySelectorAll(".heat-2").length).toBe(1);
    expect(container.querySelectorAll(".heat-3").length).toBe(1);
    expect(container.querySelectorAll(".heat-4").length).toBe(1);
    expect(container.querySelector('[title="2026-11-10: 10m"]')).toBeTruthy();
  });

  it("renders safely without days", () => {
    const { container } = render(<Heatmap days={[]} />);
    expect(screen.getByTestId("heatmap")).toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/NaN|undefined/);
    expect(container.querySelectorAll(".heat-week").length).toBe(0);
  });

  it("exposes an image role and the little-to-much legend", () => {
    render(<Heatmap days={[{ date: "2026-11-10", minutes: 10 }]} />);
    expect(screen.getByRole("img", { name: /Aktivität/ })).toBeInTheDocument();
    expect(screen.getByText("wenig")).toBeInTheDocument();
    expect(screen.getByText("viel")).toBeInTheDocument();
  });
});
