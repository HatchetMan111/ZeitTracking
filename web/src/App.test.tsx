import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

function errorResponse(message: string, status = 500): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("App", () => {
  it("keeps the shell and shows the German error when /api/state fails", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(errorResponse("Server nicht erreichbar"))));

    render(<App />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Server nicht erreichbar");
    expect(screen.getByTestId("nav-day")).toBeInTheDocument();
    expect(screen.getByTestId("bottom-day")).toBeInTheDocument();
  });
});
