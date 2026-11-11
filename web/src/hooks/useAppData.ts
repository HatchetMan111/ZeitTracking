import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, api } from "../api/client";
import type { AppState, DayPayload } from "../api/types";

export type LoadStatus = "loading" | "ready" | "auth" | "error";

export function useAppData() {
  const [state, setState] = useState<AppState | null>(null);
  const [day, setDay] = useState<DayPayload | null>(null);
  const [date, setDate] = useState("");
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [error, setError] = useState("");
  const [receivedAt, setReceivedAt] = useState(0);

  const clockOffset = useMemo(
    () => (state ? state.now - receivedAt : 0),
    [state, receivedAt],
  );

  const reloadDay = useCallback(async (target = date) => {
    const query = target ? `?date=${encodeURIComponent(target)}` : "";
    const payload = await api.get<DayPayload>(`/day${query}`);
    setDay(payload);
  }, [date]);

  const reload = useCallback(async () => {
    try {
      const next = await api.get<AppState>("/state");
      setState(next);
      setReceivedAt(Date.now());
      const query = date ? `?date=${encodeURIComponent(date)}` : "";
      const payload = await api.get<DayPayload>(`/day${query}`);
      setDay(payload);
      if (!date) setDate(payload.date);
      setStatus("ready");
      setError("");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setStatus("auth");
        return;
      }
      setError(err instanceof ApiError ? err.message : "Server nicht erreichbar");
      setStatus("error");
    }
  }, [date]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    state,
    day,
    date,
    setDate,
    status,
    error,
    reload,
    reloadDay,
    clockOffset,
    nowMs: () => Date.now() + clockOffset,
  };
}
