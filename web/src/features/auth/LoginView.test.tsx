import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LoginView } from "./LoginView";

describe("LoginView", () => {
  it("posts the password and calls onSuccess", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onSuccess = vi.fn();
    render(<LoginView onSuccess={onSuccess} />);

    fireEvent.change(screen.getByLabelText("Passwort"), { target: { value: "geheim" } });
    fireEvent.click(screen.getByRole("button", { name: "Anmelden" }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/login");
    expect(init).toEqual(
      expect.objectContaining({ method: "POST", body: JSON.stringify({ password: "geheim" }) }),
    );
  });
});
