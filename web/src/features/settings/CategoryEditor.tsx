import { useEffect, useRef, useState } from "react";
import type { Category } from "../../api/types";

export function CategoryEditor({
  category,
  onSave,
  onArchive,
}: {
  category: Category;
  onSave: (patch: Partial<Category>) => Promise<boolean>;
  onArchive: (archived: 0 | 1) => Promise<void>;
}) {
  const [color, setColor] = useState(category.color);
  const [name, setName] = useState(category.name);
  const [icon, setIcon] = useState(category.icon);
  const [goal, setGoal] = useState(category.goal_minutes_week);
  const [detailLabel, setDetailLabel] = useState(category.detail_label);

  const savedColor = useRef(category.color);
  const savedName = useRef(category.name);
  const savedIcon = useRef(category.icon);
  const savedGoal = useRef(category.goal_minutes_week);
  const savedDetailLabel = useRef(category.detail_label);
  const syncedId = useRef(category.id);

  useEffect(() => {
    if (syncedId.current === category.id) return;
    syncedId.current = category.id;
    setColor(category.color);
    setName(category.name);
    setIcon(category.icon);
    setGoal(category.goal_minutes_week);
    setDetailLabel(category.detail_label);
    savedColor.current = category.color;
    savedName.current = category.name;
    savedIcon.current = category.icon;
    savedGoal.current = category.goal_minutes_week;
    savedDetailLabel.current = category.detail_label;
  }, [category.id]);

  async function commitColor() {
    if (color === savedColor.current) return;
    if (await onSave({ color })) savedColor.current = color;
  }

  async function commitName() {
    const next = name.trim();
    if (!next) {
      setName(savedName.current);
      return;
    }
    setName(next);
    if (next === savedName.current) return;
    if (await onSave({ name: next })) savedName.current = next;
  }

  async function commitIcon() {
    const next = icon.trim();
    if (!next) {
      setIcon(savedIcon.current);
      return;
    }
    setIcon(next);
    if (next === savedIcon.current) return;
    if (await onSave({ icon: next })) savedIcon.current = next;
  }

  async function commitGoal() {
    const next = Math.max(0, Math.trunc(goal));
    setGoal(next);
    if (next === savedGoal.current) return;
    if (await onSave({ goal_minutes_week: next })) savedGoal.current = next;
  }

  async function commitDetailLabel() {
    const next = detailLabel.trim();
    setDetailLabel(next);
    if (next === savedDetailLabel.current) return;
    if (await onSave({ detail_label: next })) savedDetailLabel.current = next;
  }

  return (
    <li
      className={`category-row${category.archived ? " archived" : ""}`}
      data-testid={`category-${category.id}`}
    >
      <input
        type="color"
        aria-label={`Farbe für ${category.name}`}
        value={color}
        onChange={(event) => setColor(event.target.value)}
        onBlur={() => void commitColor()}
      />
      <input
        aria-label="Name"
        maxLength={40}
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => void commitName()}
      />
      <input
        aria-label="Icon"
        maxLength={40}
        value={icon}
        onChange={(event) => setIcon(event.target.value)}
        onBlur={() => void commitIcon()}
      />
      <input
        aria-label="Wochenziel in Minuten"
        type="number"
        min={0}
        step={30}
        value={goal}
        onChange={(event) => setGoal(Number(event.target.value) || 0)}
        onBlur={() => void commitGoal()}
      />
      <label>
        Detail-Label
        <input
          data-testid={`detail-label-${category.id}`}
          maxLength={60}
          value={detailLabel}
          placeholder="z. B. Welcher Film?"
          onChange={(event) => setDetailLabel(event.target.value)}
          onBlur={() => void commitDetailLabel()}
        />
        <small>Erscheint als Platzhalter im Detailfeld neuer Einträge.</small>
      </label>
      <button type="button" onClick={() => void onArchive(category.archived ? 0 : 1)}>
        {category.archived ? "Reaktivieren" : "Archivieren"}
      </button>
    </li>
  );
}
