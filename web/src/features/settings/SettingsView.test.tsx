import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppState, Category } from "../../api/types";
import { SettingsView } from "./SettingsView";

const category: Category = {
  id: 1, name: "Filme", color: "#FF6482", icon: "film", parent_id: null,
  goal_minutes_week: 0, detail_label: "Welcher Film?", sort_order: 0,
  archived: 0, created_at: 0,
};

const state: AppState = {
  now: 0, day_start_hour: 0, timezone: "Europe/Berlin", running_entry: null,
  auth_required: false, version: "2.0.0",
  categories: [category],
};

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type Handler = (init?: RequestInit) => Response | Promise<Response>;

function installFetch(routes: Record<string, Handler> = {}) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const handler = routes[String(input)];
    if (!handler) return Promise.resolve(jsonResponse({ categories: [] }));
    const result = handler(init);
    return result instanceof Promise ? result : Promise.resolve(result);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function requestCalls(
  fetchMock: ReturnType<typeof vi.fn>,
  url: string,
  method?: string,
) {
  return fetchMock.mock.calls.filter(([input, init]) => {
    if (String(input) !== url) return false;
    return method === undefined || (init as RequestInit | undefined)?.method === method;
  });
}

function bodies(fetchMock: ReturnType<typeof vi.fn>, url: string, method: string) {
  return requestCalls(fetchMock, url, method).map(
    ([, init]) => (init as RequestInit | undefined)?.body,
  );
}

function renderSettings(
  overrides: Partial<AppState> = {},
  routes: Record<string, Handler> = {},
) {
  const onChanged = vi.fn();
  const onError = vi.fn();
  const onLogout = vi.fn();
  const fetchMock = installFetch(routes);
  const view = render(
    <SettingsView
      state={{ ...state, ...overrides }}
      onChanged={onChanged}
      onError={onError}
      onLogout={onLogout}
    />,
  );
  return { ...view, fetchMock, onChanged, onError, onLogout };
}

function submitNewCategory(name: string) {
  fireEvent.change(screen.getByLabelText("Neue Kategorie"), { target: { value: name } });
  const form = screen.getByRole("button", { name: "Anlegen" }).closest("form");
  if (!form) throw new Error("form missing");
  fireEvent.submit(form);
  return form;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SettingsView", () => {
  it("shows and saves the category detail label", async () => {
    const { fetchMock, onChanged } = renderSettings({}, {
      "/api/categories/1": () => jsonResponse({ category }),
    });

    const input = screen.getByTestId("detail-label-1") as HTMLInputElement;
    expect(input.value).toBe("Welcher Film?");
    fireEvent.change(input, { target: { value: "Welche Serie?" } });
    fireEvent.blur(input);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/categories/1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ detail_label: "Welche Serie?" }),
      }),
    );
  });

  it("creates a category and resets the form only on success", async () => {
    const { fetchMock } = renderSettings({}, {
      "/api/categories": () => jsonResponse({ category: { ...category, id: 2, name: "Sport" } }, 201),
    });

    submitNewCategory("Sport");

    await waitFor(() =>
      expect(bodies(fetchMock, "/api/categories", "POST")).toEqual([
        JSON.stringify({ name: "Sport", color: "#0A84FF" }),
      ]),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Neue Kategorie")).toHaveValue(""),
    );
  });

  it("keeps the new category form on a failed create and reports the error", async () => {
    const { onError } = renderSettings({}, {
      "/api/categories": () => jsonResponse({ error: "Name fehlt" }, 500),
    });

    submitNewCategory("Sport");

    await waitFor(() => expect(onError).toHaveBeenCalledWith("Name fehlt"));
    expect(screen.getByLabelText("Neue Kategorie")).toHaveValue("Sport");
  });

  it("creates only one category when the form is submitted twice", async () => {
    const { fetchMock } = renderSettings({}, {
      "/api/categories": () => jsonResponse({ category: { ...category, id: 2, name: "Sport" } }, 201),
    });

    const form = submitNewCategory("Sport");
    fireEvent.submit(form);
    fireEvent.submit(form);

    await waitFor(() =>
      expect(requestCalls(fetchMock, "/api/categories", "POST")).toHaveLength(1),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Neue Kategorie")).toHaveValue(""),
    );
  });

  it("reports a failed category patch", async () => {
    const { onError } = renderSettings({}, {
      "/api/categories/1": () => jsonResponse({ error: "Name existiert" }, 422),
    });

    const input = screen.getByLabelText("Name");
    fireEvent.change(input, { target: { value: "Serien" } });
    fireEvent.blur(input);

    await waitFor(() => expect(onError).toHaveBeenCalledWith("Name existiert"));
  });

  it("reports a failed settings update", async () => {
    const { onError } = renderSettings({}, {
      "/api/settings": () => jsonResponse({ error: "Einstellungen kaputt" }, 500),
    });

    const input = screen.getByTestId("settings-day-start");
    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.blur(input);

    await waitFor(() => expect(onError).toHaveBeenCalledWith("Einstellungen kaputt"));
  });

  it("sends no patch or update on unchanged blurs", async () => {
    const { fetchMock } = renderSettings();
    await waitFor(() =>
      expect(requestCalls(fetchMock, "/api/categories?archived=1")).toHaveLength(1),
    );

    for (const label of ["Name", "Icon", "Wochenziel in Minuten"]) {
      fireEvent.blur(screen.getByLabelText(label));
    }
    fireEvent.blur(screen.getByTestId("detail-label-1"));
    fireEvent.blur(screen.getByTestId("settings-timezone"));
    fireEvent.blur(screen.getByTestId("settings-day-start"));

    await Promise.resolve();
    expect(requestCalls(fetchMock, "/api/categories/1")).toHaveLength(0);
    expect(requestCalls(fetchMock, "/api/settings", "PUT")).toHaveLength(0);
  });

  it("sends partial bodies and commits a colour once on blur", async () => {
    const { fetchMock } = renderSettings({}, {
      "/api/categories/1": () => jsonResponse({ category }),
    });

    const name = screen.getByLabelText("Name");
    fireEvent.change(name, { target: { value: "  Serien  " } });
    fireEvent.blur(name);
    await waitFor(() =>
      expect(bodies(fetchMock, "/api/categories/1", "PATCH")).toContain(
        JSON.stringify({ name: "Serien" }),
      ),
    );

    const icon = screen.getByLabelText("Icon");
    fireEvent.change(icon, { target: { value: "tv" } });
    fireEvent.blur(icon);
    await waitFor(() =>
      expect(bodies(fetchMock, "/api/categories/1", "PATCH")).toContain(
        JSON.stringify({ icon: "tv" }),
      ),
    );

    const goal = screen.getByLabelText("Wochenziel in Minuten");
    fireEvent.change(goal, { target: { value: "90" } });
    fireEvent.blur(goal);
    await waitFor(() =>
      expect(bodies(fetchMock, "/api/categories/1", "PATCH")).toContain(
        JSON.stringify({ goal_minutes_week: 90 }),
      ),
    );

    const color = screen.getByLabelText("Farbe für Filme");
    fireEvent.change(color, { target: { value: "#00ff00" } });
    fireEvent.blur(color);
    const colorBody = JSON.stringify({ color: "#00ff00" });
    await waitFor(() =>
      expect(bodies(fetchMock, "/api/categories/1", "PATCH")).toContain(colorBody),
    );
    fireEvent.blur(color);
    await Promise.resolve();
    expect(
      bodies(fetchMock, "/api/categories/1", "PATCH").filter((body) => body === colorBody),
    ).toHaveLength(1);
  });

  it("archives with DELETE and reactivates from the fetched archived list", async () => {
    const archive = renderSettings({}, {
      "/api/categories/1": () => jsonResponse({ ok: true }),
    });
    fireEvent.click(screen.getByRole("button", { name: "Archivieren" }));
    await waitFor(() =>
      expect(requestCalls(archive.fetchMock, "/api/categories/1", "DELETE")).toHaveLength(1),
    );
    expect(bodies(archive.fetchMock, "/api/categories/1", "PATCH")).not.toContain(
      JSON.stringify({ archived: 1 }),
    );
    archive.unmount();

    const archivedCategory = { ...category, archived: 1 };
    const reactivate = renderSettings({ categories: [] }, {
      "/api/categories?archived=1": () => jsonResponse({ categories: [archivedCategory] }),
      "/api/categories/1": () => jsonResponse({ category: { ...archivedCategory, archived: 0 } }),
    });
    fireEvent.click(await screen.findByRole("button", { name: "Reaktivieren" }));
    await waitFor(() =>
      expect(bodies(reactivate.fetchMock, "/api/categories/1", "PATCH")).toContain(
        JSON.stringify({ archived: 0 }),
      ),
    );
  });

  it("refetches archived categories when the category list changes", async () => {
    let archivedList: Category[] = [];
    const view = renderSettings({}, {
      "/api/categories?archived=1": () => jsonResponse({ categories: archivedList }),
    });
    await waitFor(() =>
      expect(requestCalls(view.fetchMock, "/api/categories?archived=1")).toHaveLength(1),
    );
    expect(screen.queryByRole("button", { name: "Reaktivieren" })).not.toBeInTheDocument();

    archivedList = [{ ...category, archived: 1 }];
    view.rerender(
      <SettingsView
        state={{ ...state, categories: [{ ...category, name: "Serien" }] }}
        onChanged={view.onChanged}
        onError={view.onError}
        onLogout={view.onLogout}
      />,
    );

    expect(await screen.findByRole("button", { name: "Reaktivieren" })).toBeInTheDocument();
    await waitFor(() =>
      expect(requestCalls(view.fetchMock, "/api/categories?archived=1")).toHaveLength(2),
    );
  });

  it("saves day start and timezone with PUT", async () => {
    const { fetchMock } = renderSettings({}, {
      "/api/settings": () => jsonResponse({ ok: true }),
    });

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

  it("rejects an empty day start without saving zero", async () => {
    const { fetchMock, onError } = renderSettings({ day_start_hour: 7 });
    const dayStart = screen.getByTestId("settings-day-start") as HTMLInputElement;

    fireEvent.change(dayStart, { target: { value: "" } });
    fireEvent.blur(dayStart);

    expect(onError).toHaveBeenCalledWith("Tagesbeginn muss zwischen 0 und 23 liegen");
    expect(dayStart.value).toBe("7");
    await Promise.resolve();
    expect(requestCalls(fetchMock, "/api/settings", "PUT")).toHaveLength(0);
  });

  it("keeps half-typed settings across a category reload", () => {
    const view = renderSettings();
    const dayStart = screen.getByTestId("settings-day-start");
    const timezone = screen.getByTestId("settings-timezone");
    fireEvent.change(dayStart, { target: { value: "5" } });
    fireEvent.change(timezone, { target: { value: "America/New_York" } });

    view.rerender(
      <SettingsView
        state={{ ...state, categories: [{ ...category, name: "Serien" }] }}
        onChanged={view.onChanged}
        onError={view.onError}
        onLogout={view.onLogout}
      />,
    );

    expect(dayStart).toHaveValue(5);
    expect(timezone).toHaveValue("America/New_York");
  });

  it("limits the detail label to 60 characters and allows clearing it", async () => {
    const { fetchMock } = renderSettings({}, {
      "/api/categories/1": () => jsonResponse({ category }),
    });

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
