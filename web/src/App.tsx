import { useState } from "react";
import { api } from "./api/client";
import AppShell, { type Tab } from "./components/AppShell";
import { LoginView } from "./features/auth/LoginView";
import { DayView } from "./features/day/DayView";
import { useAppData } from "./hooks/useAppData";
import { useNow } from "./hooks/useNow";
import "./styles/global.css";

export default function App() {
  const [tab, setTab] = useState<Tab>("day");
  const data = useAppData();
  const [error, setError] = useState("");
  const now = useNow() + data.clockOffset;

  const logout = async () => {
    await api.post("/logout", {});
    await data.reload();
  };

  if (data.status === "loading") return <p className="center">Laden …</p>;
  if (data.status === "auth") return <LoginView onSuccess={() => void data.reload()} />;
  if (!data.state || !data.day) return <p className="center">{data.error || "Fehler"}</p>;

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
        ) : (
          <p className="center">In Arbeit</p>
        )}
      </AppShell>
      {error ? <p role="alert" className="error-banner">{error}</p> : null}
    </>
  );
}
