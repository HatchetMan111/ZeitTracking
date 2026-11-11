import { useEffect, useMemo, useState } from "react";
import { api, errorMessage } from "./api/client";
import AppShell, { type Tab } from "./components/AppShell";
import { LoginView } from "./features/auth/LoginView";
import { DashboardView } from "./features/dashboard/DashboardView";
import { DayView } from "./features/day/DayView";
import { useAppData } from "./hooks/useAppData";
import { useDashboardData } from "./hooks/useDashboardData";
import { useNow } from "./hooks/useNow";
import { periodRange, type Period, type Range } from "./lib/ranges";
import { localDateStr } from "./lib/time";
import "./styles/global.css";

export default function App() {
  const [tab, setTab] = useState<Tab>("day");
  const data = useAppData();
  const [error, setError] = useState("");
  const [period, setPeriod] = useState<Period>("week");
  const [customRange, setCustomRange] = useState<Range | null>(null);
  const now = useNow(tab === "day" ? 1000 : 60000) + data.clockOffset;

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

  const {
    data: dashboardData,
    error: dashboardError,
    clear: clearDashboard,
  } = useDashboardData({
    enabled: tab === "dashboard" && data.status === "ready" && Boolean(data.state),
    today,
    range,
    refreshKey: data.day,
    onAuth: () => void data.reload(),
  });

  useEffect(() => {
    if (data.status !== "ready") clearDashboard();
  }, [data.status, clearDashboard]);

  const logout = async () => {
    try {
      await api.post("/logout", {});
      clearDashboard();
      await data.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
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
    dashboardData && range && dashboardData.from === range.from && dashboardData.to === range.to
      ? dashboardData
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
            <p className="center">Dashboard wird geladen …</p>
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
