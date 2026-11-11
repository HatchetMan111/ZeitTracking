import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppState } from "../../api/types";
import { SettingsView } from "./SettingsView";

const state: AppState = {
  now: 0, day_start_hour: 0, timezone: "Europe/Berlin", running_entry: null,
  auth_required: false, version: "2.0.0",
  categories: [{
    id: 1, name: "Filme", color: "#FF6482", icon: "film", parent_id: null,
    goal_minutes_week: 0, detail_label: "Welcher Film?", sort_order: 0,
    archived: 0, created_at: 0,
  }],
};

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function submitNewCategory(name: string) {
  fireEvent.change(screen.getByLabelText("Neue Kategorie"), { target: { value: name } });
  const form = screen.getByRole("button", { name: "Anlegen" }).closest("form");
  if (!form) throw new Error("form missing");
  fireEvent.submit(form);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SettingsView", () => {
  it("shows and saves the category detail label", async () => {
    const onChanged = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ category: state.categories[0] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<SettingsView state={state} onChanged={onChanged} onError={() => {}} onLogout={() => {}} />);

    const input = screen.getByTestId("detail-label-1") as HTMLInputElement;
    expect(input.value).toBe("Welcher Film?");
    fireEvent.change(input, { target: { value: "Welche Serie?" } });
    fireEvent.blur(input);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/categories/1",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("creates a category and resets the form only on success", async () => {
    const onChanged = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ category: { ...state.categories[0], id: 2, name: "Sport" } }, 201),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<SettingsView state={state} onChanged={onChanged} onError={() => {}} onLogout={() => {}} />);

    submitNewCategory("Sport");

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/categories",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ name: "Sport", color: "#0A84FF" }),
        }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Neue Kategorie")).toHaveValue(""),
    );
  });

  it("keeps the new category form on a failed create and reports the error", async () => {
    const onError = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "Name fehlt" }, 500));
    vi.stubGlobal("fetch", fetchMock);
    render(<SettingsView state={state} onChanged={() => {}} onError={onError} onLogout={() => {}} />);

    submitNewCategory("Sport");

    await waitFor(() => expect(onError).toHaveBeenCalledWith("Name fehlt"));
    expect(screen.getByLabelText("Neue Kategorie")).toHaveValue("Sport");
  });

  it("archives with archived=1 and reactivates with archived=0", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ category: state.categories[0] }));
    vi.stubGlobal("fetch", fetchMock);
    const { unmount } = render(
      <SettingsView state={state} onChanged={() => {}} onError={() => {}} onLogout={() => {}} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Archivieren" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/categories/1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ archived: 1 }),
        }),
      ),
    );

    unmount();
    fetchMock.mockClear();
    render(
      <SettingsView
        state={{ ...state, categories: [{ ...state.categories[0], archived: 1 }] }}
        onChanged={() => {}}
        onError={() => {}}
        onLogout={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reaktivieren" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/categories/1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ archived: 0 }),
        }),
      ),
    );
  });

  it("saves day start and timezone with PUT", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    render(<SettingsView state={state} onChanged={() => {}} onError={() => {}} onLogout={() => {}} />);

    const dayStart = screen.getByTestId("settings-day-start");
    fireEvent.change(dayStart, { target: { value: "5" } });
    fireEvent.blur(dayStart);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/settings",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ day_start_hour: 5, timezone: "Europe/Berlin" }),
        }),
      ),
    );
  });

  it("limits the detail label to 60 characters and allows clearing it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ category: state.categories[0] }));
    vi.stubGlobal("fetch", fetchMock);
    render(<SettingsView state={state} onChanged={() => {}} onError={() => {}} onLogout={() => {}} />);

    const input = screen.getByTestId("detail-label-1");
    expect(input).toHaveAttribute("maxlength", "60");
    expect(screen.getByText("Erscheint als Platzhalter im Detailfeld neuer Einträge.")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/categories/1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ detail_label: "" }),
        }),
      ),
    );
  });

  it("renders the password-login status and app version", () => {
    const { rerender } = render(
      <SettingsView state={state} onChanged={() => {}} onError={() => {}} onLogout={() => {}} />,
    );
    expect(screen.getByText(/Passwort-Login: inaktiv/)).toBeInTheDocument();
    expect(screen.getByText("Timeblocks 2.0.0")).toBeInTheDocument();

    rerender(
      <SettingsView
        state={{ ...state, auth_required: true }}
        onChanged={() => {}}
        onError={() => {}}
        onLogout={() => {}}
      />,
    );
    expect(screen.getByText(/Passwort-Login: aktiv/)).toBeInTheDocument();
  });
});
