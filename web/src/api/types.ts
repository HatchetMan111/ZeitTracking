export type Category = {
  id: number;
  name: string;
  color: string;
  icon: string;
  parent_id: number | null;
  goal_minutes_week: number;
  detail_label: string;
  sort_order: number;
  archived: number;
  created_at: number;
};

export type Entry = {
  id: number;
  category_id: number;
  kind: "timeline" | "duration";
  started_at: number;
  ended_at: number | null;
  effective_end: number;
  minutes: number | null;
  note: string;
  updated_at: number;
  category_name?: string;
  category_color?: string;
  category_icon?: string;
  overlap_minutes?: number;
};

export type AppState = {
  now: number;
  day_start_hour: number;
  timezone: string;
  running_entry: Entry | null;
  categories: Category[];
  auth_required: boolean;
  version: string;
};

export type DayPayload = {
  date: string;
  start_ms: number;
  end_ms: number;
  now: number;
  entries: Entry[];
  total_minutes: number;
  per_category: { category_id: number; minutes: number }[];
  days_with_data: string[];
};

export type DayPoint = { date: string; minutes: number };
export type StatRow = { key: string; label: string; color: string; minutes: number };
export type StatsEntry = {
  id: number;
  category_id: number;
  label: string;
  color: string;
  started_at: number;
  effective_end: number;
  minutes: number;
  note: string;
};
export type StatsPayload = {
  from: string;
  to: string;
  group_by: "category" | "day";
  total_minutes: number;
  rows: StatRow[];
  days: DayPoint[];
  entries: StatsEntry[];
};

export type SummaryPayload = {
  now: number;
  totals: {
    today_minutes: number;
    week_minutes: number;
    month_minutes: number;
    all_minutes: number;
  };
  lifetime_by_category: {
    category_id: number;
    name: string;
    color: string;
    minutes: number;
  }[];
  first_entry_date: string | null;
};
