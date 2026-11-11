import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api, errorMessage } from "../api/client";
import type { DayPoint, StatsPayload, SummaryPayload } from "../api/types";
import { addDays, type Range } from "../lib/ranges";

export type DashboardData = {
  summary: SummaryPayload;
  stats: StatsPayload;
  heatmap: DayPoint[];
  from: string;
  to: string;
};

export function useDashboardData({
  enabled,
  today,
  range,
  refreshKey,
  onAuth,
}: {
  enabled: boolean;
  today: string;
  range: Range | null;
  refreshKey: unknown;
  onAuth: () => void;
}) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const onAuthRef = useRef(onAuth);
  const authHandled = useRef<string | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    onAuthRef.current = onAuth;
  }, [onAuth]);

  const clear = useCallback(() => {
    generation.current += 1;
    setData(null);
    setError("");
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!enabled || !today || !range) {
      setLoading(false);
      return;
    }
    const key = `${today}|${range.from}|${range.to}`;
    const current = ++generation.current;
    let ignore = false;
    setLoading(true);
    setError("");
    const periodParams = new URLSearchParams({
      from: range.from,
      to: range.to,
      group_by: "category",
    });
    const heatParams = new URLSearchParams({
      from: addDays(today, -364),
      to: today,
      group_by: "day",
    });
    Promise.all([
      api.get<SummaryPayload>("/summary"),
      api.get<StatsPayload>(`/stats?${periodParams.toString()}`),
      api.get<StatsPayload>(`/stats?${heatParams.toString()}`),
    ])
      .then(([summary, stats, heat]) => {
        if (ignore || generation.current !== current) return;
        setData({ summary, stats, heatmap: heat.days, from: range.from, to: range.to });
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (ignore || generation.current !== current) return;
        setLoading(false);
        if (err instanceof ApiError && err.status === 401) {
          if (authHandled.current !== key) {
            authHandled.current = key;
            onAuthRef.current();
            return;
          }
          setError("Dashboard konnte nicht geladen werden. Bitte erneut anmelden.");
          return;
        }
        setError(errorMessage(err));
      });
    return () => {
      ignore = true;
    };
  }, [enabled, today, range?.from, range?.to, refreshKey]);

  return { data, loading, error, clear };
}
