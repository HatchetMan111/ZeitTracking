import { useEffect, useState } from "react";
import type { Category } from "../../api/types";

export function CategoryEditor({
  category,
  onSave,
  onArchive,
}: {
  category: Category;
  onSave: (patch: Partial<Category>) => Promise<void>;
  onArchive: (archived: 0 | 1) => Promise<void>;
}) {
  const [name, setName] = useState(category.name);
  const [icon, setIcon] = useState(category.icon);
  const [goal, setGoal] = useState(category.goal_minutes_week);
  const [detailLabel, setDetailLabel] = useState(category.detail_label);

  useEffect(() => {
    setName(category.name);
    setIcon(category.icon);
    setGoal(category.goal_minutes_week);
    setDetailLabel(category.detail_label);
  }, [category]);

  return (
    <li
      className={`category-row${category.archived ? " archived" : ""}`}
      data-testid={`category-${category.id}`}
    >
      <input
        type="color"
        aria-label={`Farbe für ${category.name}`}
        value={category.color}
        onChange={(event) => {
          if (event.target.value !== category.color) void onSave({ color: event.target.value });
        }}
      />
      <input
        aria-label="Name"
        maxLength={40}
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => {
          const next = name.trim();
          if (!next) {
            setName(category.name);
            return;
          }
          if (next !== category.name) void onSave({ name: next });
          else setName(next);
        }}
      />
      <input
        aria-label="Icon"
        maxLength={40}
        value={icon}
        onChange={(event) => setIcon(event.target.value)}
        onBlur={() => {
          const next = icon.trim();
          if (!next) {
            setIcon(category.icon);
            return;
          }
          if (next !== category.icon) void onSave({ icon: next });
          else setIcon(next);
        }}
      />
      <input
        aria-label="Wochenziel in Minuten"
        type="number"
        min={0}
        step={30}
        value={goal}
        onChange={(event) => setGoal(Number(event.target.value) || 0)}
        onBlur={() => {
          const next = Math.max(0, Math.trunc(goal));
          setGoal(next);
          if (next !== category.goal_minutes_week) void onSave({ goal_minutes_week: next });
        }}
      />
      <label>
        Detail-Label
        <input
          data-testid={`detail-label-${category.id}`}
          maxLength={60}
          value={detailLabel}
          placeholder="z. B. Welcher Film?"
          onChange={(event) => setDetailLabel(event.target.value)}
          onBlur={() => {
            const next = detailLabel.trim();
            setDetailLabel(next);
            if (next !== category.detail_label) void onSave({ detail_label: next });
          }}
        />
        <small>Erscheint als Platzhalter im Detailfeld neuer Einträge.</small>
      </label>
      <button type="button" onClick={() => void onArchive(category.archived ? 0 : 1)}>
        {category.archived ? "Reaktivieren" : "Archivieren"}
      </button>
    </li>
  );
}
