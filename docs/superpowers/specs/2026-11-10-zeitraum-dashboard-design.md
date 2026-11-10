# ZeitErfassung: React-Frontend und Lebenszeit-Dashboard — Design

Datum: 2026-11-10
Status: Freigegeben am 2026-11-10
Autor: opencode (mit Nutzer abgestimmt)

## 1. Problem und Ziel

Timeblocks ist eine selbst gehostete Zeiterfassung (Flask + SQLite), die als
Proxmox-LXC über ein Shell-Skript installiert wird. Die bestehende Vanilla-JS-
Oberfläche kann die gewünschten Auswertungen nicht gut darstellen, und
Einträge lassen sich nur über eine freie Notiz beschreiben.

Ziele:

1. Frontend vollständig mit **React + TypeScript + Vite** neu bauen.
2. Pro Kategorie ein konfigurierbares **Detailfeld** (z. B. „Welcher Film?“)
   mit Freitext pro Eintrag; das Detail erscheint im UI und im CSV-Export.
3. **Lebenszeit-Dashboard** mit Zeitraumwahl (Woche/Monat/Jahr/eigener
   Bereich), Donut nach Kategorie, KPI-Karten, Heatmap, Trendlinie,
   Top-Kategorien und Tagesliste.
4. LXC-Standardname auf **`zeiterfassung`** ändern; bestehende Installation
   mit dem alten Default `timeblocks` wird automatisch umbenannt.
5. Bestehende Funktionen (Timer, Timeline mit Drag/Resize, Undo, Login,
   PWA, CSV, Einstellungen) bleiben erhalten und werden nicht schlechter.

Nicht Ziel ist ein Backend-Wechsel: Flask und SQLite bleiben.

## 2. Entscheidungen

| Thema | Entscheidung |
|---|---|
| Frontend | React 19 + TypeScript + Vite, kein Router-Paket (Tab-State) |
| Auslieferung | Vite baut nach `app/static`; Flask liefert API und Dateien |
| Charts | Eigene SVG-Komponenten (Donut, Heatmap, Linie), keine Chart-Bibliothek |
| Datenmodell | `categories.detail_label`; bestehendes `entries.note` wird zum Detail |
| Detail-Semantik | Ein Freitext-Detail pro Eintrag, Platzhalter aus der Kategorie |
| Analytics | Donut + KPIs + Heatmap + Trend + Top-Kategorien („Balanced“) |
| Zeitraum | Woche (Mo–So), Monat, Jahr, eigener Bereich; einheitlich für alle Charts |
| Design | Dunkles Life-Dashboard, bestehende Kategoriefarben bleiben |
| Build | `app/static` wird mitcommittet; Node nur für Entwicklung/Build nötig |
| Container | Hostname `zeiterfassung`; App-Name bleibt „Timeblocks“ |
| Tests | Pytest (Backend), Vitest (Rechenlogik), Playwright (E2E) |

## 3. UX

### 3.1 Navigation

- Mobil: Bottom-Nav mit **Tag**, **Dashboard**, **Einstellungen**.
- Desktop (≥ 900 px): linke Sidebar (220 px) mit denselben Zielen, Gesamtzeit
  und Logout; Inhalt max. 1180 px breit.
- Login bleibt ein Overlay/Fullscreen-View bei 401 oder wenn kein Passwort
  gesetzt ist.

### 3.2 Tag

Wie heute, in React neu umgesetzt:

- Datumsleiste mit Vor/Zurück und „Heute“.
- Hero: Tagessumme, laufender Timer mit Start/Stop.
- Timer-Chips je Kategorie, horizontal umbrechend.
- 24-h-Timeline: Stundenraster, Jetzt-Linie, Blöcke mit Kategorie-Farbe,
  Drag und Resize in 5-Minuten-Schritten, Klick auf freie Fläche legt einen
  Block an, Klick auf Block öffnet das Eintrags-Sheet.
- Tastatur: fokussierter Block mit Pfeiltasten ±5 min (Shift ±30 min),
  Enter öffnet das Sheet, Entf löscht mit Undo.
- Sheet für Timeline- und Dauer-Einträge: Kategorie, Start/Ende bzw. Dauer,
  **Detail** (Platzhalter `detail_label` der Kategorie, sonst „Woran hast du
  gearbeitet?“), Speichern/Löschen.
- Löschen zeigt Toast „Eintrag gelöscht – Rückgängig“ (Snapshot wird per POST
  neu angelegt, wie bisher).
- Tagesliste unterhalb der Timeline mit Dauer und Detail; Tap öffnet das Sheet.

### 3.3 Dashboard („Lebenszeit“)

- Zeitraum-Picker als Segmente **Woche | Monat | Jahr** plus „Eigener
  Zeitraum“ mit zwei Datumsfeldern. Die Auswahl gilt für alle Charts.
- KPI-Karten: **Heute**, **Diese Woche**, **Dieser Monat**, **Gesamt**
  (all time). Große tabellarische Zahlen, kleine Labels.
- **Donut** nach Kategorie für den gewählten Zeitraum: Mitte zeigt die
  Gesamtsumme, Legende zeigt Farbe, Name, Dauer und Prozent (auf eine
  Nachkommastelle, Summe 100 % über größten Rest).
- **Top-Kategorien**: Rangliste mit Balken relativ zum Maximum.
- **Heatmap**: letzte 365 Tage, Wochen als Spalten (Montag oben), 5 Stufen:
  0; 1–29; 30–59; 60–119; ≥ 120 Minuten. Tooltip/Titel mit Datum und Dauer.
- **Trend**: Linien-/Flächenchart. Woche und Monat tagesgenau; Jahr und
  eigene Bereiche > 62 Tage monatlich aggregiert.
- **Tagesliste** für den Zeitraum: Einträge mit Tag, Zeit, Kategorie, Detail und Dauer.
- **CSV-Export** für den gewählten Zeitraum.
- Leerzustand: ruhiger Hinweis mit Link zum Tag, keine Null-Diagramme.

### 3.4 Einstellungen

- Tagesbeginn, Zeitzone, Passwort-Login-Status (wie heute).
- Kategorien: Name, Farbe, Icon, Wochenziel, **Detail-Label**
  (max. 60 Zeichen, z. B. „Welcher Film?“), Archivieren/Reaktivieren.
- Neues Feld wird direkt im Kategorien-Editor erklärt: „Erscheint als
  Platzhalter im Detailfeld neuer Einträge.“
- Logout und App-Version.

## 4. Architektur

```
Browser ── React SPA (app/static, Vite-Build)
   │  fetch /api/*        (Session-Cookie)
   ▼
Flask (app.py + api.py) ── SQLite (timeblocks.db, WAL)
```

- Kein Node zur Laufzeit im LXC. Der Installer nutzt ausschließlich die
  mitgelieferten Build-Dateien.
- Kein clientseitiger Router: die drei Ansichten werden über State
  gewechselt; Flask-404 liefert `index.html` (SPA-Fallback bleibt).
- API-Client kapselt `fetch`, JSON-Fehler, 401 → Login-Ansicht und
  `credentials: "same-origin"`.
- Datenfluss: ein `useAppData`-Hook lädt `/api/state` und `/api/day`, nach
  Mutationen werden betroffene Ressourcen neu geladen. Kein State-Manager,
  keine Query-Bibliothek.

## 5. Datenmodell und Migration

Schema-Version 2:

```sql
ALTER TABLE categories ADD COLUMN detail_label TEXT NOT NULL DEFAULT '';
```

- Neue Datenbanken: `detail_label` direkt im `CREATE TABLE`, Seed-Kategorie
  **Filme** (`#FF6482`, Icon `film`, `detail_label = 'Welcher Film?'`).
- Bestehende Datenbanken: idempotente Migration in `init_db()` –
  Spalte per `PRAGMA table_info` prüfen und ergänzen; „Filme“ nur anlegen,
  wenn keine Kategorie mit Name `Filme` (case-insensitive) existiert.
  Migration wird als Version 2 in `schema_migrations` vermerkt.
- `entries.note` bleibt unverändert die Datenquelle des Detailfelds; keine
  Umschreibung bestehender Daten.
- Validierung: `detail_label` getrimmt, max. 60 Zeichen, leere Zeichenkette
  erlaubt (Fallback-Platzhalter im UI).
- Bestehende Einträge ohne Detail bleiben gültig.

## 6. API

Bestehende Endpunkte bleiben kompatibel. Änderungen:

### 6.1 Kategorien

`GET /api/categories` und `GET /api/state` liefern zusätzlich
`detail_label` je Kategorie.

`POST /api/categories` und `PATCH /api/categories/<id>` akzeptieren
`detail_label` (String, getrimmt, ≤ 60 Zeichen). Ungültige Werte → 400 mit
deutscher Meldung.

### 6.2 Neuer Endpunkt `GET /api/summary`

```json
{
  "now": 1762750000000,
  "totals": {
    "today_minutes": 45,
    "week_minutes": 300,
    "month_minutes": 1200,
    "all_minutes": 54000
  },
  "lifetime_by_category": [
    {"category_id": 1, "name": "Arbeit", "color": "#FF375F", "minutes": 30000}
  ],
  "first_entry_date": "2025-12-01"
}
```

- Grenzen richten sich nach `day_start_hour` und Zeitzone aus `app_state`.
- Woche = Montag 00:00 (Tagesbeginn) bis jetzt; Monat = 1. des Monats bis
  jetzt; `all` = alle Einträge inkl. laufendem Timer (Ende = jetzt).
- `lifetime_by_category` enthält auch archivierte Kategorien mit Einträgen,
  sortiert nach Minuten absteigend.
- `first_entry_date` ist `null`, wenn keine Einträge existieren.
- Implementierung: eine Abfrage über `entries`, Überlappungslogik wird
  wiederverwendet; bei persönlichen Datenmengen ausreichend.

### 6.3 Statistik und Export

- `GET /api/stats?from&to&group_by=category|day` bleibt im Kern unverändert
  und liefert die Daten für Donut, Trend und Heatmap. Zusätzlich enthält die
  Antwort `entries` (`id`, `category_id`, `label`, `color`, `started_at`,
  `effective_end`, `minutes`, `note`) für die Tagesliste mit Detail.
- `GET /api/export.csv`: Spaltenkopf `Notiz` wird zu **`Detail`**; Werte
  weiterhin über `_csv_safe` gegen Formel-Injection geschützt. Dateiname
  bleibt `timeblocks-<von>_<bis>.csv`.

## 7. Frontend-Struktur

```
web/
  index.html
  package.json          # scripts: dev, build, test, typecheck
  tsconfig.json
  vite.config.ts        # base "/static/", outDir "../app/static", emptyOutDir
  public/
    manifest.webmanifest
    sw.js
    icons/…
  src/
    main.tsx
    App.tsx
    api/client.ts
    api/types.ts
    hooks/useAppData.ts
    hooks/useNow.ts      # tickende Anzeige für Timer
    lib/time.ts          # Dauerformat, lokale Tage, Wochenstart Montag
    lib/ranges.ts        # week/month/year/custom → from/to
    lib/charts.ts        # Prozent-Legende, Heatmap-Stufen, Monatsaggregation
    components/AppShell.tsx
    components/Sheet.tsx
    components/Toast.tsx
    components/Field.tsx
    features/day/DayView.tsx
    features/day/Timeline.tsx
    features/day/EntrySheet.tsx
    features/day/TimerChips.tsx
    features/dashboard/DashboardView.tsx
    features/dashboard/KpiCards.tsx
    features/dashboard/CategoryDonut.tsx
    features/dashboard/Heatmap.tsx
    features/dashboard/TrendChart.tsx
    features/dashboard/TopCategories.tsx
    features/dashboard/DayTable.tsx
    features/dashboard/PeriodPicker.tsx
    features/settings/SettingsView.tsx
    features/settings/CategoryEditor.tsx
    features/auth/LoginView.tsx
    styles/tokens.css
    styles/components.css # Layout, Timeline, Sheet, Dashboard, Settings
    styles/global.css
```

- Interaktionen erhalten `data-testid` für Playwright.
- Alle nutzerrelevanten Texte auf Deutsch; keine externen Fonts (Offline-PWA).
- Vite `base: "/static/"`, damit der Build unter Flasks `/static`-Präfix
  funktioniert. `index.html` wird von Flask an `/` ausgeliefert.

## 8. Designsystem

- Farben: Near-Black-Hintergrund (`#0B0B0F`), Panels `#15151B` mit 1-px-Rand,
  Text `#F5F5F7`, gedämpft `#9A9AA5`; Kategoriefarben bleiben Akzente.
- Typografie: System-Stack (`-apple-system, Segoe UI, Inter, sans-serif`),
  Zahlen mit `font-variant-numeric: tabular-nums`.
- Radien 14–20 px, weiche Schatten, sparsame Glows nur um laufende Timer.
- Donut: Ringstärke ~18 %, Lücken 2°, Mittelwert zweizeilig.
- Heatmap: 5 Stufen von `#1B1B22` bis `#30D158`; Legende „wenig → viel“.
- Motion: 120–220 ms, `prefers-reduced-motion` deaktiviert Animationen.
- Kontrast: Text ≥ 4.5:1, Fokusringe sichtbar, Charts mit Textlegende
  (Farbe nie alleiniges Unterscheidungsmerkmal).
- Responsive: 320 px ohne horizontalen Überlauf; Timeline scrollt intern.

## 9. Build, Deployment und Umbenennung

### 9.1 Build

- Node ≥ 20 nur in Entwicklung: `cd web && npm ci && npm run build`.
- Ergebnis liegt in `app/static` (inkl. Manifest, SW, Icons) und wird
  committet. `.gitignore` schließt `web/node_modules`, nicht `app/static`.
- Entwickeln: Flask auf `127.0.0.1:8100`, `npm run dev` mit Proxy auf
  `/api` → `http://127.0.0.1:8100`.
- Service Worker: Navigation network-first mit Cache-Fallback auf `/`;
  `/static/assets/*` cache-first (gehashte Dateien); `/api/*` network-only.
  Cache-Name `timeblocks-v4`.
- `docs/verification.md` beschreibt Build-, Test- und Offline-Prüfung.

### 9.2 Container-Umbenennung

- Neuer Default: `HOSTNAME_ARG="${HOSTNAME_ARG:-zeiterfassung}"`.
- Explizites `--hostname` wird nachgehalten (`HOSTNAME_EXPLICIT=1`).
- Existiert der CT bereits:
  - Hostname == Ziel → normal weiter.
  - Hostname == `timeblocks` (alter Default) und kein explizites
    `--hostname` → automatisch umbenennen:
    `pct set "$CT_ID" --hostname zeiterfassung`;
    im Container `hostnamectl set-hostname zeiterfassung` und
    `127.0.1.1`-Zeile in `/etc/hosts` ersetzen/ergänzen.
  - Sonst Abbruch mit Hinweis auf `--hostname` (kein stilles Umbenennen).
- Kein zusätzlicher Reboot nötig; der Bootstrap setzt den Namen vor dem
  Service-Start. Der bestehende CT 109 wird durch erneutes Ausführen mit
  `--ctid 109` migriert.
- Falls `pct set --hostname` im laufenden Betrieb abgelehnt wird, stoppt das
  Skript den CT kurz, setzt den Namen und startet ihn wieder; der Bootstrap
  läuft danach normal weiter.
- App-Name, systemd-Unit, Pfade und Repo bleiben „timeblocks“.

## 10. Tests und Abnahmekriterien

### 10.1 Backend (Pytest, bestehende 30 Tests erweitern)

1. Migration ergänzt `detail_label` auf einer v1-Datenbank; erneuter Lauf ist
   idempotent.
2. „Filme“ wird genau einmal angelegt, inkl. Label, und nicht dupliziert.
3. Kategorie-CRUD akzeptiert/validiert `detail_label` (Länge, Trimmen).
4. `/api/summary` liefert korrekte Tages-/Wochen-/Monats-/Gesamtwerte über
   Monatsgrenzen, Tagesbeginn ≠ 0 und laufenden Timer.
5. CSV-Kopf enthält `Detail`; ein Film-Detail erscheint im Export;
   Formel-Injection bleibt escaped.

### 10.2 Frontend (Vitest)

6. `lib/time` und `lib/ranges`: Wochenstart Montag, Monats-/Jahresgrenzen,
   eigener Bereich.
7. `lib/charts`: Prozentanteile summieren 100 %, Heatmap-Stufen-Grenzen,
   Monatsaggregation für lange Zeiträume.

### 10.3 E2E (Playwright)

8. Login, Timer starten/stoppen, Dauer-Eintrag anlegen, Detail speichern und
   wieder bearbeiten.
9. Timeline: Block verschieben und in der Größe ändern, Undo nach Löschen.
10. Dashboard: Zeitraum wechseln; Donut, KPIs und Top-Kategorien zeigen
    konsistente Werte; Heatmap und Trend rendern.
11. CSV enthält das eingegebene Film-Detail.
12. Einstellungen: Detail-Label ändern, erscheint als Platzhalter im Sheet.
13. Kein horizontaler Überlauf bei 320/390/768/1280 px; Offline-Shell lädt.

### 10.4 Installer

14. Simulationslauf mit PVE-Stubs: Neuer CT heißt `zeiterfassung`.
15. Bestehender CT mit Hostname `timeblocks` wird umbenannt; explizites
    abweichendes `--hostname` bricht ab.
16. `shellcheck` bleibt sauber; Health-Check nach Installation grün.

## 11. Phasen

1. **Backend**: Schema v2, Filme-Seed, `detail_label`, `/api/summary`,
   CSV-Header, Tests.
2. **Gerüst**: `web/` (Vite+TS), Design-Tokens, AppShell, API-Client,
   Login, Build nach `app/static`, PWA-Dateien.
3. **Parität Tag**: Timer, Timeline inkl. Drag/Resize/Keyboard, Sheets,
   Detailfeld, Undo, Tagesliste.
4. **Dashboard**: PeriodPicker, KPIs, Donut, Top-Kategorien, Heatmap,
   Trend, Tagesliste, CSV.
5. **Einstellungen & Rename**: Kategorien mit Detail-Label, Installer-
   Umbenennung, Update-Skript unverändert nutzbar.
6. **Härtung**: E2E, responsive Prüfung, Offline, Doku
   (`README`, `docs/runbook.md`, `docs/verification.md`).

Jede Phase endet mit lauffähigem Build und grünen Tests; Commits pro Phase.

## 12. Nicht im Umfang

- Mehrbenutzerbetrieb, Sync oder Cloud.
- Native App.
- Checklisten/mehrere Unteraufgaben pro Eintrag (nur ein Detailfeld).
- Kategoriespezifische strukturierte Felder (z. B. Staffel/Folge).
- Weitere Seed-Kategorien außer „Filme“.
- Änderung des Produktnamens „Timeblocks“.
- i18n über Deutsch hinaus.

## 13. Risiken

| Risiko | Gegenmaßnahme |
|---|---|
| React-Neubau regressiert Drag/Resize oder Undo | E2E-Tests vor dem Entfernen des alten Frontends; Phase 3 separat |
| Build-Artefakte driften von `web/` ab | `npm run build` ist Pflichtschritt; `docs/verification.md` prüft Hashes/Datum |
| Umbenennung eines laufenden CT | Name wird im Container gesetzt, Service-Neustart ist Teil des Bootstraps; kein Datenverlust |
| „Filme“-Seed stört bestehende Nutzer | einmalig, archivierbar, idempotent, in Doku erwähnt |
| All-Time-Summary wird langsam | eine Abfrage, Index auf `started_at`; persönliche Datenmenge |
| PWA-Cache liefert altes UI | gehashte Assets + network-first Navigation + Cache-Bump |
