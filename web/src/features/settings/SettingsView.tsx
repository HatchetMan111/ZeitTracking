import { useEffect, useState } from "react";
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

  useEffect(() => {
    setDayStart(String(state.day_start_hour));
    setTimezone(state.timezone);
  }, [state.day_start_hour, state.timezone]);

  async function saveCategory(id: number, patch: Partial<Category>) {
    try {
      await api.patch(`/categories/${id}`, patch);
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
    const hour = Number(dayStart);
    const tz = timezone.trim();
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
      onError("Tagesbeginn muss zwischen 0 und 23 liegen");
      setDayStart(String(state.day_start_hour));
      return;
    }
    if (!tz) {
      onError("Zeitzone darf nicht leer sein");
      setTimezone(state.timezone);
      return;
    }
    setDayStart(String(hour));
    setTimezone(tz);
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
          onChange={(event) => setDayStart(event.target.value)}
          onBlur={commitSettings}
        />
      </Field>
      <Field label="Zeitzone">
        <input
          data-testid="settings-timezone"
          value={timezone}
          onChange={(event) => setTimezone(event.target.value)}
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
            onArchive={(archived) => saveCategory(category.id, { archived })}
          />
        ))}
      </ul>
      <form
        className="category-new"
        aria-label="Neue Kategorie anlegen"
        onSubmit={(event) => {
          event.preventDefault();
          const name = newName.trim();
          if (!name) return;
          void createCategory(name, newColor).then((ok) => {
            if (!ok) return;
            setNewName("");
            setNewColor("#0A84FF");
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
        <button type="submit">Anlegen</button>
      </form>
      <p className="muted">Passwort-Login: {state.auth_required ? "aktiv" : "inaktiv"}</p>
      <button type="button" onClick={onLogout}>
        Abmelden
      </button>
      <p className="muted">Timeblocks {state.version}</p>
    </section>
  );
}
