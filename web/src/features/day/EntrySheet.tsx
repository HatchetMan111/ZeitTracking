import { useEffect, useState } from "react";
import { api, errorMessage } from "../../api/client";
import type { Category, Entry } from "../../api/types";
import Field from "../../components/Field";
import Sheet from "../../components/Sheet";
import { localDateStr, toWallInput } from "../../lib/time";

export type SheetDraft =
  | { mode: "create"; started_at: number; ended_at: number }
  | { mode: "create-duration"; date: string }
  | { mode: "edit"; entry: Entry };

export function EntrySheet({
  open,
  categories,
  initial,
  timezone,
  onClose,
  onSaved,
  onDelete,
  onError,
}: {
  open: boolean;
  categories: Category[];
  initial: SheetDraft | null;
  timezone: string;
  onClose: () => void;
  onSaved: () => void;
  onDelete: (entry: Entry) => void;
  onError: (message: string) => void;
}) {
  const editing = initial?.mode === "edit" ? initial.entry : null;
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? 0);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [minutes, setMinutes] = useState(30);
  const [durationDate, setDurationDate] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!initial) return;
    if (initial.mode === "edit") {
      setCategoryId(initial.entry.category_id);
      setStart(toWallInput(initial.entry.started_at, timezone));
      setEnd(toWallInput(initial.entry.effective_end, timezone));
      setDurationDate(localDateStr(initial.entry.started_at, timezone));
      setMinutes(initial.entry.minutes ?? 30);
      setNote(initial.entry.note);
    } else if (initial.mode === "create-duration") {
      setCategoryId(categories[0]?.id ?? 0);
      setDurationDate(initial.date);
      setMinutes(30);
      setNote("");
    } else {
      setCategoryId(categories[0]?.id ?? 0);
      setStart(toWallInput(initial.started_at, timezone));
      setEnd(toWallInput(initial.ended_at, timezone));
      setMinutes(30);
      setNote("");
    }
  }, [initial, timezone]);

  const category = categories.find((item) => item.id === categoryId);
  const isRunning = editing?.ended_at === null;

  async function save() {
    setBusy(true);
    try {
      if (editing?.kind === "duration") {
        await api.patch(`/entries/${editing.id}`, {
          category_id: categoryId,
          date: durationDate,
          minutes,
          note,
        });
      } else if (editing) {
        const payload: {
          category_id: number;
          started_at: string;
          ended_at?: string;
          note: string;
        } = {
          category_id: categoryId,
          started_at: start,
          note,
        };
        if (editing.ended_at !== null) payload.ended_at = end;
        await api.patch(`/entries/${editing.id}`, payload);
      } else if (initial?.mode === "create-duration") {
        await api.post("/entries/duration", {
          category_id: categoryId,
          date: durationDate,
          minutes,
          note,
        });
      } else {
        await api.post("/entries", {
          category_id: categoryId,
          started_at: start,
          ended_at: end,
          note,
        });
      }
      onSaved();
      onClose();
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} title={editing ? "Eintrag bearbeiten" : "Eintrag"} onClose={onClose}>
      <Field label="Kategorie">
        <select value={categoryId} onChange={(event) => setCategoryId(Number(event.target.value))}>
          {categories.map((item) => (
            <option key={item.id} value={item.id}>{item.name}</option>
          ))}
        </select>
      </Field>
      {editing?.kind === "duration" || initial?.mode === "create-duration" ? (
        <>
          <Field label="Datum">
            <input type="date" value={durationDate} onChange={(event) => setDurationDate(event.target.value)} />
          </Field>
          <Field label="Dauer (Minuten)">
            <input
              type="number" min={1} step={1} value={minutes}
              onChange={(event) => setMinutes(Number(event.target.value))}
            />
          </Field>
        </>
      ) : (
        <>
          <Field label="Start">
            <input type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} />
          </Field>
          <Field label={isRunning ? "Ende (läuft noch)" : "Ende"}>
            <input
              type="datetime-local"
              value={end}
              disabled={isRunning}
              onChange={(event) => setEnd(event.target.value)}
            />
          </Field>
        </>
      )}
      <Field label="Detail">
        <textarea
          data-testid="sheet-detail"
          rows={3}
          maxLength={4000}
          placeholder={category?.detail_label || "Woran hast du gearbeitet?"}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </Field>
      <div className="sheet-actions">
        {editing ? (
          <button type="button" className="danger" onClick={() => onDelete(editing)}>
            Löschen
          </button>
        ) : null}
        <button type="button" className="primary" data-testid="sheet-save" disabled={busy} onClick={() => void save()}>
          {busy ? "Speichern …" : "Speichern"}
        </button>
      </div>
    </Sheet>
  );
}
