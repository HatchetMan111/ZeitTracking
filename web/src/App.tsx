import { useState } from "react";
import AppShell, { type Tab } from "./components/AppShell";
import "./styles/global.css";

export default function App() {
  const [tab, setTab] = useState<Tab>("day");
  return (
    <AppShell active={tab} onNavigate={setTab} total="–" onLogout={() => {}}>
      <section data-testid="view">{tab}</section>
    </AppShell>
  );
}
