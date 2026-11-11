import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../api/client";
import type { AppState, Category } from "../../api/types";
import Field from "../../components/Field";
import { CategoryEditor } from "./CategoryEditor";

export function SettingsView({
  state,
  onChanged,
  onError,
  onLogout,
}: {
  state: AppState;
  onChanged: () => void;
  onError: (message: string) => void;
  onLogout: () => void;
}) {
  const [dayStart, setDayStart] = useState(String(state.day_start_hour));
  const [timezone, setTimezone] = useState(state.timezone);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#0A84FF");
  const [archived, setArchived] = useState<Category[]>([]);
  const [creating, setCreating] = useState(false);

  const dayStartDirty = useRef(false);
  const timezoneDirty = useRef(false);
  const lastDayStart = useRef(state.day_start_hour);
  const lastTimezone = useRef(state.timezone);
  const archivedRequest = useRef(0);
  const submitting = useRef(false);

  useEffect(() => {
    if (state.day_start_hour === lastDayStart.current) return;
    lastDayStart.current = state.day_start_hour;
    if (!dayStartDirty.current) setDayStart(String(state.day_start_hour));
  }, [state.day_start_hour]);

  useEffect(() => {
    if (state.timezone === lastTimezone.current) return;
    lastTimezone.current = state.timezone;
    if (!timezoneDirty.current) setTimezone(state.timezone);
  }, [state.timezone]);

  useEffect(() => {
    const requestId = ++archivedRequest.current;
    let active = true;
    api
      .get<{ categories: Category[] }>("/categories?archived=1")
      .then((payload) => {
        if (!active || requestId !== archivedRequest.current) return;
        const list = Array.isArray(payload?.categories) ? payload.categories : [];
        setArchived(list.filter((category) => category.archived === 1));
      })
      .catch(() => {
        if (!active || requestId !== archivedRequest.current) return;
        setArchived([]);
      });
    return () => {
      active = false;
    };
  }, [state.categories]);

  async function saveCategory(id: number, patch: Partial<Category>): Promise<boolean> {
    try {
      await api.patch(`/categories/${id}`, patch);
      onChanged();
      return true;
    } catch (error) {
      onError(errorMessage(error));
      return false;
    }
  }

  async function archiveCategory(id: number, archived: 0 | 1) {
    try {
      if (archived === 1) await api.del(`/categories/${id}`);
      else await api.patch(`/categories/${id}`, { archived: 0 });
      onChanged();
    } catch (error) {
      onError(errorMessage(error));
    }
  }

  async function createCategory(name: string, color: string): Promise<boolean> {
    try {
      await api.post("/categories", { name, color });
      onChanged();
      return true;
    } catch (error) {
      onError(errorMessage(error));
      return false;
    }
  }

  async function saveSettings(dayStartHour: number, tz: string) {
    try {
      await api.put("/settings", { day_start_hour: dayStartHour, timezone: tz });
      onChanged();
    } catch (error) {
      onError(errorMessage(error));
    }
  }

  function commitSettings() {
    const rawDayStart = dayStart.trim();
    const hour = Number(rawDayStart);
    if (rawDayStart === "" || !Number.isInteger(hour) || hour < 0 || hour > 23) {
      onError("Tagesbeginn muss zwischen 0 und 23 liegen");
      dayStartDirty.current = false;
      setDayStart(String(state.day_start_hour));
      return;
    }
    const tz = timezone.trim();
    if (!tz) {
      onError("Zeitzone darf nicht leer sein");
      timezoneDirty.current = false;
      setTimezone(state.timezone);
      return;
    }
    setDayStart(String(hour));
    setTimezone(tz);
    dayStartDirty.current = false;
    timezoneDirty.current = false;
    if (hour === state.day_start_hour && tz === state.timezone) return;
    void saveSettings(hour, tz);
  }

  return (
    <section className="settings">
      <h1>Einstellungen</h1>
      <Field label="Tagesbeginn (Stunde)">
        <input
          data-testid="settings-day-start"
          type="number"
          min={0}
          max={23}
          value={dayStart}
          onChange={(event) => {
            dayStartDirty.current = true;
            setDayStart(event.target.value);
          }}
          onBlur={commitSettings}
        />
      </Field>
      <Field label="Zeitzone">
        <input
          data-testid="settings-timezone"
          value={timezone}
          onChange={(event) => {
            timezoneDirty.current = true;
            setTimezone(event.target.value);
          }}
          onBlur={commitSettings}
        />
      </Field>
      <h2>Kategorien</h2>
      <ul>
        {state.categories.map((category) => (
          <CategoryEditor
            key={category.id}
            category={category}
            onSave={(patch) => saveCategory(category.id, patch)}
            onArchive={(target) => archiveCategory(category.id, target)}
          />
        ))}
      </ul>
      {archived.length > 0 ? (
        <>
          <h2>Archivierte Kategorien</h2>
          <ul>
            {archived.map((category) => (
              <CategoryEditor
                key={`archived-${category.id}`}
                category={category}
                onSave={(patch) => saveCategory(category.id, patch)}
                onArchive={(target) => archiveCategory(category.id, target)}
              />
            ))}
          </ul>
        </>
      ) : null}
      <form
        className="category-new"
        aria-label="Neue Kategorie anlegen"
        onSubmit={(event) => {
          event.preventDefault();
          if (submitting.current) return;
          const name = newName.trim();
          if (!name) return;
          submitting.current = true;
          setCreating(true);
          void createCategory(name, newColor)
            .then((ok) => {
              if (!ok) return;
              setNewName("");
              setNewColor("#0A84FF");
            })
            .finally(() => {
              submitting.current = false;
              setCreating(false);
            });
        }}
      >
        <input
          name="name"
          aria-label="Neue Kategorie"
          maxLength={40}
          placeholder="Neue Kategorie"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
        />
        <input
          name="color"
          type="color"
          aria-label="Farbe der neuen Kategorie"
          value={newColor}
          onChange={(event) => setNewColor(event.target.value)}
        />
        <button type="submit" disabled={creating}>
          Anlegen
        </button>
      </form>
      <p className="muted">Passwort-Login: {state.auth_required ? "aktiv" : "inaktiv"}</p>
      <button type="button" onClick={onLogout}>
        Abmelden
      </button>
      <p className="muted">Timeblocks {state.version}</p>
    </section>
  );
}
