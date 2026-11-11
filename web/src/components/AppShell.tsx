import type { ReactNode } from "react";

export type Tab = "day" | "dashboard" | "settings";

const ITEMS: { id: Tab; label: string; icon: string }[] = [
  { id: "day", label: "Tag", icon: "◷" },
  { id: "dashboard", label: "Dashboard", icon: "◔" },
  { id: "settings", label: "Einstellungen", icon: "⚙" },
];

export default function AppShell({
  active,
  onNavigate,
  total,
  onLogout,
  children,
}: {
  active: Tab;
  onNavigate: (tab: Tab) => void;
  total: string;
  onLogout: () => void;
  children: ReactNode;
}) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">Timeblocks<span>{total}</span></div>
        <nav>
          {ITEMS.map((item) => (
            <button
              key={item.id}
              data-testid={`nav-${item.id}`}
              aria-current={active === item.id ? "page" : undefined}
              onClick={() => onNavigate(item.id)}
            >
              <span aria-hidden="true">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <button type="button" className="sidebar-logout" data-testid="sidebar-logout" onClick={onLogout}>
          Abmelden
        </button>
      </aside>
      <main className="content">{children}</main>
      <nav className="bottom-nav">
        {ITEMS.map((item) => (
          <button
            key={item.id}
            data-testid={`bottom-${item.id}`}
            aria-current={active === item.id ? "page" : undefined}
            onClick={() => onNavigate(item.id)}
          >
            <span aria-hidden="true">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
