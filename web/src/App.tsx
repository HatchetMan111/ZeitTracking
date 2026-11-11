import { useEffect, useMemo, useState } from "react";
import { ApiError, api, errorMessage } from "./api/client";
import type { DayPoint, StatsPayload, SummaryPayload } from "./api/types";
import AppShell, { type Tab } from "./components/AppShell";
import { LoginView } from "./features/auth/LoginView";
import { DashboardView } from "./features/dashboard/DashboardView";
import { DayView } from "./features/day/DayView";
import { useAppData } from "./hooks/useAppData";
import { useNow } from "./hooks/useNow";
import { addDays, periodRange, type Period, type Range } from "./lib/ranges";
import { localDateStr } from "./lib/time";
import "./styles/global.css";

type DashboardData = {
  summary: SummaryPayload;
  stats: StatsPayload;
  heatmap: DayPoint[];
  from: string;
  to: string;
};

export default function App() {
  const [tab, setTab] = useState<Tab>("day");
  const data = useAppData();
  const [error, setError] = useState("");
  const [period, setPeriod] = useState<Period>("week");
  const [customRange, setCustomRange] = useState<Range | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [dashboardError, setDashboardError] = useState("");
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const now = useNow() + data.clockOffset;

  const timezone = data.state?.timezone ?? "";
  const today = timezone ? localDateStr(now, timezone) : "";
  const range = useMemo(() => {
    if (!today) return null;
    try {
      return periodRange(period, today, customRange ?? undefined);
    } catch {
      return null;
    }
  }, [period, today, customRange]);

  useEffect(() => {
    if (tab !== "dashboard" || data.status !== "ready" || !data.state || !range) return;
    let ignore = false;
    setDashboardLoading(true);
    setDashboardError("");
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
        if (ignore) return;
        setDashboard({
          summary,
          stats,
          heatmap: heat.days,
          from: range.from,
          to: range.to,
        });
        setDashboardLoading(false);
      })
      .catch((err: unknown) => {
        if (ignore) return;
        setDashboardLoading(false);
        if (err instanceof ApiError && err.status === 401) {
          void data.reload();
          return;
        }
        setDashboardError(errorMessage(err));
      });
    return () => {
      ignore = true;
    };
  }, [tab, data.status, data.state, data.day, data.reload, range, today]);

  const logout = async () => {
    await api.post("/logout", {});
    await data.reload();
  };

  const onPeriod = (next: Period, custom?: Range) => {
    setPeriod(next);
    if (custom) setCustomRange(custom);
  };

  const onExport = () => {
    if (!range) return;
    window.location.href = `/api/export.csv?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`;
  };

  if (data.status === "loading") return <p className="center">Laden …</p>;
  if (data.status === "auth") return <LoginView onSuccess={() => void data.reload()} />;
  if (!data.state || !data.day) return <p className="center">{data.error || "Fehler"}</p>;

  const ready =
    dashboard && range && dashboard.from === range.from && dashboard.to === range.to
      ? dashboard
      : null;

  return (
    <>
      <AppShell
        active={tab}
        onNavigate={setTab}
        total={data.state.running_entry ? "läuft" : ""}
        onLogout={() => void logout()}
      >
        {tab === "day" ? (
          <DayView
            state={data.state}
            day={data.day}
            nowMs={now}
            setDate={data.setDate}
            onChanged={() => void data.reload()}
            onError={setError}
          />
        ) : tab === "dashboard" ? (
          dashboardError ? (
            <p className="center" role="alert">
              {dashboardError}
            </p>
          ) : ready && range ? (
            <DashboardView
              summary={ready.summary}
              stats={ready.stats}
              heatmap={ready.heatmap}
              timezone={data.state.timezone}
              period={period}
              range={range}
              onPeriod={onPeriod}
              onExport={onExport}
              onGoDay={() => setTab("day")}
            />
          ) : (
            <p className="center">
              {dashboardLoading ? "Dashboard wird geladen …" : "Noch keine Dashboard-Daten."}
            </p>
          )
        ) : (
          <p className="center">In Arbeit</p>
        )}
      </AppShell>
      {error ? (
        <p role="alert" className="error-banner">
          {error}
        </p>
      ) : null}
    </>
  );
}
