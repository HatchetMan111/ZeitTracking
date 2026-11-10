# ZeitErfassung: React-Frontend und Lebenszeit-Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Timeblocks auf ein React/Vite-Frontend mit Detailfeld pro Eintrag, Lebenszeit-Dashboard und Container-Namen `zeiterfassung` umstellen.

**Architecture:** Flask + SQLite bleiben die API; React/TypeScript/Vite ersetzt die Vanilla-UI und baut nach `app/static`. Backend erhält Schema v2 (`categories.detail_label`) und `/api/summary`; Charts sind eigene SVG-Komponenten. Der Installer benennt bestehende `timeblocks`-Container automatisch um.

**Tech Stack:** Python 3.11+/Flask/SQLite/Pytest, React 19, TypeScript 5, Vite 6, Vitest + Testing Library, Playwright (Python), Bash/ShellCheck.

**Spec:** `docs/superpowers/specs/2026-11-10-zeitraum-dashboard-design.md`

## Global Constraints

- React 19 + TypeScript + Vite; kein clientseitiger Router, keine Chart-Bibliothek.
- Vite `base: "/static/"`, Build-Output nach `app/static`; Build-Artefakte werden committed.
- Node ≥ 20 ausschließlich für Entwicklung/Build; kein Node im LXC.
- Flask/SQLite bleiben; bestehende API-Antworten bleiben kompatibel.
- `detail_label`: getrimmt, max. 60 Zeichen, leer erlaubt; `entries.note` bleibt Datenquelle des Detailfelds.
- Deutsch als UI-Sprache; keine externen Fonts; PWA offline-fähig.
- Woche beginnt Montag; alle Zeitrechnungen in UTC-Millisekunden, Anzeige in `app_state.timezone`.
- Bestehende Tests bleiben grün; ShellCheck bleibt sauber.
- Commits pro Task; keine Änderungen an `.git/config` oder Secrets im Repo.

## Review Focus

- **Mitternacht/DST/Tagesbeginn ≠ 0:** Ein Eintrag über Mitternacht oder die DST-Umstellung muss in „Heute/Woche/Monat/Gesamt" mit realer Dauer zählen; vor dem Tagesbeginn gehört „Heute" zum logischen Vortag (Test in Task 3).
- **Laufender Timer (`ended_at = null`):** muss in Summary, Stats, Donut, Trend, Heatmap und CSV bis „jetzt" erscheinen (Test in Task 3 und Task 9/E2E).
- **Detailtext:** mehrzeilig, bis 4000 Zeichen, führend `=+-@`, Semikolon/Anführungszeichen → CSV korrekt escaped, keine Formel-Injektion, Platzhalter der Kategorie (Test in Task 2/4/9).
- **Zeitraum-Grenzen:** Monats-/Jahreswechsel, 29. Februar, `to < from`, Enddatum in der Zukunft, leere Daten → keine negativen/NaN-Chart-Geometrien (Test in Task 10).
- **Rename bestehender CT:** alter Default `timeblocks` wird umbenannt, ein custom Hostname nie still geändert, Daten/Service bleiben erhalten, `pct set`-Fehlerpfad stoppt/startet sauber (Task 5).

---

## Phase 1 — Backend und Installer

### Task 1: Schema v2, Migration und „Filme"-Seed

**Files:**
- Modify: `app/db.py:14-68`
- Modify: `app/api.py:18`
- Create: `tests/test_db.py`

**Interfaces:**
- Produces: `db.SCHEMA_VERSION == 2`; `db.migrate_schema(conn: sqlite3.Connection) -> None`; `categories.detail_label TEXT NOT NULL DEFAULT ''`; Seed-Kategorie `Filme`.
- `db.DEFAULT_CATEGORIES` wird zu 5-Tupeln `(name, color, icon, goal_minutes_week, detail_label)`.

- [ ] **Step 1: Failing test für Migration und Seed schreiben**

```python
# tests/test_db.py
import sqlite3

import db

V1_SCHEMA = """
CREATE TABLE categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT 'dot',
    parent_id INTEGER,
    goal_minutes_week INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);
CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
);
"""


def _v1_conn():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(V1_SCHEMA)
    conn.execute(
        "INSERT INTO categories (name, color, icon, goal_minutes_week, sort_order, archived, created_at)"
        " VALUES ('Arbeit', '#FF375F', 'briefcase', 0, 0, 0, 1)"
    )
    conn.commit()
    return conn


def test_migration_adds_detail_label_and_movie_category():
    conn = _v1_conn()
    db.migrate_schema(conn)

    columns = {row["name"] for row in conn.execute("PRAGMA table_info(categories)")}
    assert "detail_label" in columns
    movies = conn.execute(
        "SELECT name, detail_label FROM categories WHERE lower(name) = 'filme'"
    ).fetchall()
    assert len(movies) == 1
    assert movies[0]["detail_label"] == "Welcher Film?"


def test_migration_is_idempotent():
    conn = _v1_conn()
    db.migrate_schema(conn)
    db.migrate_schema(conn)
    count = conn.execute(
        "SELECT COUNT(*) AS n FROM categories WHERE lower(name) = 'filme'"
    ).fetchone()["n"]
    assert count == 1
    version = conn.execute("SELECT MAX(version) AS v FROM schema_migrations").fetchone()["v"]
    assert version == 2
```

- [ ] **Step 2: Test läuft rot**

Run: `python3 -m pytest tests/test_db.py -v`
Expected: FAIL mit `AttributeError: module 'db' has no attribute 'migrate_schema'`.

- [ ] **Step 3: Schema und Migration implementieren**

`app/api.py`: `VERSION = "2.0.0"`.

In `app/db.py`:

```python
SCHEMA = """
CREATE TABLE IF NOT EXISTS categories (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    name              TEXT    NOT NULL,
    color             TEXT    NOT NULL,
    icon              TEXT    NOT NULL DEFAULT 'dot',
    parent_id         INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    goal_minutes_week INTEGER NOT NULL DEFAULT 0,
    detail_label      TEXT    NOT NULL DEFAULT '',
    sort_order        INTEGER NOT NULL DEFAULT 0,
    archived          INTEGER NOT NULL DEFAULT 0,
    created_at        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS entries (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL REFERENCES categories(id),
    kind        TEXT    NOT NULL CHECK (kind IN ('timeline', 'duration')),
    started_at  INTEGER NOT NULL,
    ended_at    INTEGER,
    minutes     INTEGER,
    note        TEXT    NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_entries_started ON entries (started_at);
CREATE INDEX IF NOT EXISTS idx_entries_category ON entries (category_id);

CREATE TABLE IF NOT EXISTS app_state (
    id                INTEGER PRIMARY KEY CHECK (id = 1),
    running_entry_id  INTEGER,
    day_start_hour    INTEGER NOT NULL DEFAULT 0,
    timezone          TEXT    NOT NULL DEFAULT 'Europe/Berlin',
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
);
"""

DEFAULT_CATEGORIES = [
    ("Arbeit", "#FF375F", "briefcase", 0, ""),
    ("Projekt", "#0A84FF", "code", 0, ""),
    ("Meeting", "#BF5AF2", "users", 0, ""),
    ("Fokus", "#30D158", "target", 0, ""),
    ("Lernen", "#FFD60A", "book", 0, ""),
    ("Sport", "#FF9F0A", "activity", 0, ""),
    ("Privat", "#64D2FF", "home", 0, ""),
    ("Pause", "#8E8E93", "pause", 0, ""),
    ("Filme", "#FF6482", "film", 0, "Welcher Film?"),
]

SCHEMA_VERSION = 2


def _has_column(conn: sqlite3.Connection, table: str, column: str) -> bool:
    return any(row["name"] == column for row in conn.execute(f"PRAGMA table_info({table})"))


def migrate_schema(conn: sqlite3.Connection) -> None:
    stamp = now_ms()
    if not _has_column(conn, "categories", "detail_label"):
        conn.execute("ALTER TABLE categories ADD COLUMN detail_label TEXT NOT NULL DEFAULT ''")

    movies = conn.execute(
        "SELECT 1 FROM categories WHERE lower(name) = 'filme' LIMIT 1"
    ).fetchone()
    if movies is None:
        order = conn.execute(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM categories"
        ).fetchone()["n"]
        conn.execute(
            "INSERT INTO categories"
            " (name, color, icon, parent_id, goal_minutes_week, detail_label, sort_order, archived, created_at)"
            " VALUES (?, ?, ?, NULL, ?, ?, ?, 0, ?)",
            ("Filme", "#FF6482", "film", 0, "Welcher Film?", order, stamp),
        )

    conn.execute(
        "INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (2, ?)",
        (stamp,),
    )
    conn.commit()
```

In `init_db()` nach dem Seed-Block `migrate_schema(conn)` aufrufen und den Seed-Insert um
`detail_label` erweitern:

```python
conn.execute(
    "INSERT INTO categories"
    " (name, color, icon, parent_id, goal_minutes_week, detail_label, sort_order, archived, created_at)"
    " VALUES (?, ?, ?, NULL, ?, ?, ?, 0, ?)",
    (name, color, icon, goal, detail_label, index, stamp),
)
```

- [ ] **Step 4: Tests grün**

Run: `python3 -m pytest tests/test_db.py tests/test_api.py -v`
Expected: PASS (mindestens 32 Tests).

- [ ] **Step 5: Commit**

```bash
git add app/db.py tests/test_db.py
git commit -m "feat(db): schema v2 with category detail labels and movie seed"
```

---

### Task 2: `detail_label` in der Kategorien-API

**Files:**
- Modify: `app/api.py:620-690`
- Modify: `tests/test_api.py`

**Interfaces:**
- Produces: `POST/PATCH /api/categories` akzeptieren `detail_label`; `GET /api/state` und `/api/categories` liefern es; ungültige Länge → 400.
- Helper: `_detail_label(value: object) -> str`.

- [ ] **Step 1: Failing test**

```python
def test_category_detail_label_roundtrip(client):
    created = client.post(
        "/api/categories",
        json={"name": "Serien", "color": "#123456", "detail_label": "  Welche Serie?  "},
    )
    assert created.status_code == 201
    cat = created.get_json()["category"]
    assert cat["detail_label"] == "Welche Serie?"

    listed = client.get("/api/state").get_json()["categories"]
    assert next(item for item in listed if item["id"] == cat["id"])["detail_label"] == "Welche Serie?"

    assert client.patch(
        f"/api/categories/{cat['id']}", json={"detail_label": "x" * 61}
    ).status_code == 400

    cleared = client.patch(
        f"/api/categories/{cat['id']}", json={"detail_label": "   "}
    ).get_json()["category"]
    assert cleared["detail_label"] == ""
```

- [ ] **Step 2: Rot**

Run: `python3 -m pytest tests/test_api.py::test_category_detail_label_roundtrip -v`
Expected: FAIL, `detail_label` fehlt bzw. wird nicht validiert.

- [ ] **Step 3: Implementieren**

```python
def _detail_label(value: object) -> str:
    text = str(value or "").strip()
    if len(text) > 60:
        raise ApiError("Detail-Label darf höchstens 60 Zeichen lang sein")
    return text
```

In `create_category()`:

```python
detail_label = _detail_label(data.get("detail_label", ""))
# INSERT-Spalten um detail_label erweitern
conn.execute(
    "INSERT INTO categories"
    " (name, color, icon, parent_id, goal_minutes_week, detail_label, sort_order, archived, created_at)"
    " VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)",
    (name, color, icon, parent_id, goal, detail_label, order, now),
)
```

In `update_category()`:

```python
if "detail_label" in data:
    fields["detail_label"] = _detail_label(data["detail_label"])
```

- [ ] **Step 4: Grün**

Run: `python3 -m pytest tests/test_api.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api.py tests/test_api.py
git commit -m "feat(api): expose and validate category detail labels"
```

---

### Task 3: Summary-Endpunkt und logischer Tagesbeginn

**Files:**
- Modify: `app/timeutil.py`
- Modify: `app/api.py` (nach `get_day`, vor `get_stats`)
- Modify: `tests/test_timeutil.py`
- Modify: `tests/test_api.py`

**Interfaces:**
- Produces: `timeutil.logical_date_str(ms: int, day_start_hour: int, tz_name: str) -> str`.
- Produces: `GET /api/summary -> {now, totals:{today_minutes,week_minutes,month_minutes,all_minutes}, lifetime_by_category:[{category_id,name,color,minutes}], first_entry_date}`.

- [ ] **Step 1: Failing Tests für logischen Tag, Summen und DST**

```python
# tests/test_timeutil.py ergänzen
import timeutil


def test_logical_date_before_day_start():
    tz = "Europe/Berlin"
    start, _ = timeutil.day_bounds("2026-03-15", 0, tz)
    now = start + 2 * 3600000  # 02:00, Tagesbeginn ist 04:00
    assert timeutil.logical_date_str(now, 4, tz) == "2026-03-14"
    assert timeutil.logical_date_str(now, 0, tz) == "2026-03-15"
```

```python
# tests/test_api.py ergänzen
import timeutil


def _add_entry(client, cat, day, start_hour, start_minute, end_hour, end_minute):
    start, _ = timeutil.day_bounds(day, 0, "Europe/Berlin")
    client.post(
        "/api/entries",
        json={
            "category_id": cat,
            "started_at": start + start_hour * 3600000 + start_minute * 60000,
            "ended_at": start + end_hour * 3600000 + end_minute * 60000,
        },
    )


def test_summary_totals_and_lifetime(client, monkeypatch):
    assert client.put(
        "/api/settings", json={"timezone": "Europe/Berlin", "day_start_hour": 0}
    ).status_code == 200
    now = timeutil.day_bounds("2026-03-15", 0, "Europe/Berlin")[0] + 12 * 3600000
    monkeypatch.setattr(timeutil, "now_ms", lambda: now)
    cat = category_id(client, "Arbeit")

    _add_entry(client, cat, "2026-03-15", 8, 0, 9, 0)    # heute, 60
    _add_entry(client, cat, "2026-03-14", 10, 0, 10, 30)  # gleiche Woche, 30
    _add_entry(client, cat, "2026-03-01", 9, 0, 10, 0)    # gleicher Monat, 60
    _add_entry(client, cat, "2026-02-20", 9, 0, 10, 0)    # nur gesamt, 60

    payload = client.get("/api/summary").get_json()
    assert payload["totals"] == {
        "today_minutes": 60,
        "week_minutes": 90,
        "month_minutes": 150,
        "all_minutes": 210,
    }
    assert payload["lifetime_by_category"][0]["name"] == "Arbeit"
    assert payload["lifetime_by_category"][0]["minutes"] == 210
    assert payload["first_entry_date"] == "2026-02-20"


def test_summary_respects_day_start_before_morning(client, monkeypatch):
    client.put("/api/settings", json={"timezone": "Europe/Berlin", "day_start_hour": 4})
    now = timeutil.day_bounds("2026-03-15", 0, "Europe/Berlin")[0] + 2 * 3600000
    monkeypatch.setattr(timeutil, "now_ms", lambda: now)
    cat = category_id(client, "Arbeit")
    _add_entry(client, cat, "2026-03-14", 22, 0, 23, 0)

    payload = client.get("/api/summary").get_json()
    assert payload["totals"]["today_minutes"] == 60
    assert payload["totals"]["week_minutes"] == 60


def test_summary_counts_running_timer(client, monkeypatch):
    clock = [timeutil.day_bounds("2026-03-15", 0, "Europe/Berlin")[0] + 8 * 3600000]
    monkeypatch.setattr(timeutil, "now_ms", lambda: clock[0])
    cat = category_id(client, "Arbeit")
    client.post(f"/api/timers/{cat}/start")
    clock[0] += 30 * 60000

    payload = client.get("/api/summary").get_json()
    assert payload["totals"]["today_minutes"] == 30
    assert payload["totals"]["all_minutes"] == 30
    assert client.get("/api/stats?from=2026-03-15&to=2026-03-15").get_json()["total_minutes"] == 30


def test_summary_handles_dst_crossing(client, monkeypatch):
    client.put("/api/settings", json={"timezone": "Europe/Berlin", "day_start_hour": 0})
    now = timeutil.day_bounds("2026-03-30", 0, "Europe/Berlin")[0] + 12 * 3600000
    monkeypatch.setattr(timeutil, "now_ms", lambda: now)
    cat = category_id(client, "Arbeit")
    start = timeutil.day_bounds("2026-03-28", 0, "Europe/Berlin")[0] + 22 * 3600000
    end = timeutil.day_bounds("2026-03-29", 0, "Europe/Berlin")[0] + 4 * 3600000
    client.post(
        "/api/entries",
        json={"category_id": cat, "started_at": start, "ended_at": end},
    )
    payload = client.get("/api/summary").get_json()
    assert payload["totals"]["all_minutes"] == 300
    assert payload["totals"]["today_minutes"] == 0
```

- [ ] **Step 2: Rot**

Run: `python3 -m pytest tests/test_timeutil.py tests/test_api.py -k "summary or logical" -v`
Expected: FAIL (`logical_date_str` fehlt, `/api/summary` 404).

- [ ] **Step 3: Implementieren**

`app/timeutil.py`:

```python
def logical_date_str(ms: int, day_start_hour: int, tz_name: str) -> str:
    day = local_date_str(ms, tz_name)
    start, _ = day_bounds(day, day_start_hour, tz_name)
    if ms < start:
        day = (parse_date(day) - timedelta(days=1)).isoformat()
    return day
```

`app/api.py`:

```python
@bp.get("/summary")
def get_summary():
    conn = db.connect()
    try:
        tz = _tz(conn)
        day_start_hour = _day_start_hour(conn)
        now = timeutil.now_ms()
        today = timeutil.logical_date_str(now, day_start_hour, tz)
        today_date = timeutil.parse_date(today)

        today_start, _ = timeutil.day_bounds(today, day_start_hour, tz)
        monday = today_date - timedelta(days=today_date.weekday())
        week_start, _ = timeutil.day_bounds(monday.isoformat(), day_start_hour, tz)
        month_start, _ = timeutil.day_bounds(today_date.replace(day=1).isoformat(), day_start_hour, tz)

        rows = conn.execute(
            "SELECT e.category_id, e.kind, e.started_at, e.ended_at, e.minutes,"
            "       c.name AS category_name, c.color AS category_color"
            " FROM entries e JOIN categories c ON c.id = e.category_id"
        ).fetchall()

        def total_since(start_ms: int) -> int:
            total = sum(
                _overlap_ms(row["started_at"], _effective_end(row, now), start_ms, now)
                for row in rows
            )
            return round(total / 60000)

        lifetime: dict[int, dict] = {}
        for row in rows:
            overlap = _overlap_ms(row["started_at"], _effective_end(row, now), 0, now)
            if overlap <= 0:
                continue
            item = lifetime.setdefault(
                row["category_id"],
                {
                    "category_id": row["category_id"],
                    "name": row["category_name"],
                    "color": row["category_color"],
                    "minutes": 0,
                },
            )
            item["minutes"] += round(overlap / 60000)

        first = conn.execute("SELECT MIN(started_at) AS first FROM entries").fetchone()["first"]
        return jsonify(
            {
                "now": now,
                "totals": {
                    "today_minutes": total_since(today_start),
                    "week_minutes": total_since(week_start),
                    "month_minutes": total_since(month_start),
                    "all_minutes": total_since(0),
                },
                "lifetime_by_category": sorted(
                    lifetime.values(), key=lambda item: item["minutes"], reverse=True
                ),
                "first_entry_date": timeutil.logical_date_str(first, day_start_hour, tz) if first else None,
            }
        )
    finally:
        conn.close()
```

`get_day()` und `get_stats()` nutzen als Default ebenfalls den logischen Tag:

```python
today = timeutil.logical_date_str(timeutil.now_ms(), day_start_hour, tz)
```

- [ ] **Step 4: Grün**

Run: `python3 -m pytest tests/test_timeutil.py tests/test_api.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/timeutil.py app/api.py tests/test_timeutil.py tests/test_api.py
git commit -m "feat(api): add lifetime summary and logical day boundaries"
```

---

### Task 4: CSV-Spalte „Detail"

**Files:**
- Modify: `app/api.py:560-595`
- Modify: `tests/test_api.py`

- [ ] **Step 1: Test anpassen/ergänzen**

```python
def test_csv_export_uses_detail_column(client):
    cat = category_id(client)
    day = day_payload(client)
    start = day["start_ms"] + 8 * 3600000
    client.post(
        "/api/entries",
        json={
            "category_id": cat,
            "started_at": start,
            "ended_at": start + 3600000,
            "note": "Dune: Part Two; =2+2",
        },
    )
    client.post(
        "/api/entries",
        json={
            "category_id": cat,
            "started_at": start + 2 * 3600000,
            "ended_at": start + 3 * 3600000,
            "note": "=2+2",
        },
    )
    text = client.get(f"/api/export.csv?from={day['date']}&to={day['date']}").data.decode(
        "utf-8-sig"
    )
    header = text.splitlines()[0]
    assert "Detail" in header
    assert "Notiz" not in header
    assert "'=Dune" not in text  # Formel wird nur am Feldanfang escaped
    assert "Dune: Part Two" in text
    assert "'=2+2" in text
```

- [ ] **Step 2: Rot**

Run: `python3 -m pytest tests/test_api.py::test_csv_export_uses_detail_column -v`
Expected: FAIL, Header enthält weiterhin `Notiz`.

- [ ] **Step 3: Header ändern**

```python
writer.writerow(["Datum", "Kategorie", "Start", "Ende", "Dauer (min)", "Dauer (h:mm)", "Detail"])
```

- [ ] **Step 4: Grün**

Run: `python3 -m pytest tests/test_api.py -v`
Expected: PASS; bestehender `test_csv_export` bleibt grün.

- [ ] **Step 5: Commit**

```bash
git add app/api.py tests/test_api.py
git commit -m "feat(csv): export entry detail as Detail column"
```

---

### Task 4b: Statistik liefert Eintragsdetails für die Tagesliste

**Files:**
- Modify: `app/api.py` (`get_stats`)
- Modify: `tests/test_api.py`

**Interfaces:**
- Produces: `GET /api/stats` zusätzlich `entries: [{id, category_id, label, color, started_at, effective_end, minutes, note}]`, absteigend nach `started_at`.

- [ ] **Step 1: Failing Test**

```python
def test_stats_includes_entry_details_for_day_list(client):
    cat = category_id(client, "Filme")
    day = day_payload(client)
    start = day["start_ms"] + 8 * 3600000
    client.post(
        "/api/entries",
        json={
            "category_id": cat,
            "started_at": start,
            "ended_at": start + 3600000,
            "note": "Dune: Part Two",
        },
    )
    payload = client.get(f"/api/stats?from={day['date']}&to={day['date']}").get_json()
    assert payload["entries"][0]["note"] == "Dune: Part Two"
    assert payload["entries"][0]["label"] == "Filme"
    assert payload["entries"][0]["minutes"] == 60
    assert payload["entries"][0]["effective_end"] == start + 3600000
```

- [ ] **Step 2: Rot**

Run: `python3 -m pytest tests/test_api.py::test_stats_includes_entry_details_for_day_list -v`
Expected: FAIL mit `KeyError: 'entries'`.

- [ ] **Step 3: Implementieren**

In `get_stats()` beim Iterieren über `rows` zusätzlich sammeln:

```python
entry_details = []
for row in rows:
    overlap = _overlap_ms(row["started_at"], _effective_end(row, now), start, end)
    if overlap <= 0:
        continue
    entry_details.append(
        {
            "id": row["id"],
            "category_id": row["category_id"],
            "label": row["category_name"],
            "color": row["category_color"],
            "started_at": row["started_at"],
            "effective_end": _effective_end(row, now),
            "minutes": round(overlap / 60000),
            "note": row["note"],
        }
    )
entry_details.sort(key=lambda item: item["started_at"], reverse=True)
```

In die `jsonify`-Antwort `"entries": entry_details` aufnehmen.

- [ ] **Step 4: Grün**

Run: `python3 -m pytest tests/test_api.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api.py tests/test_api.py
git commit -m "feat(api): include entry details in stats for day list"
```

---

### Task 5: Container-Rename `timeblocks` → `zeiterfassung`

**Files:**
- Modify: `install/timeblocks.sh` (Defaults, Argumente, Existing-Branch, Bootstrap)

**Interfaces:**
- Produces: Default `HOSTNAME_ARG=zeiterfassung`; `HOSTNAME_EXPLICIT` unterscheidet Default von `--hostname`; Bootstrap-Argument `--hostname`; bestehende CTs mit Hostname `timeblocks` werden umbenannt.

- [ ] **Step 1: Failing-Check vorbereiten (Stub)**

```bash
mkdir -p /tmp/fakepve
cat > /tmp/fakepve/hostname <<'EOF'
timeblocks
EOF
python3 - <<'PY'
from pathlib import Path
p = Path("/tmp/fakepve/pct")
text = p.read_text()
text = text.replace(
    'config) echo "hostname: timeblocks"; exit 0;;',
    'config) echo "hostname: $(cat /tmp/fakepve/hostname)"; exit 0;;\n'
    '  set)\n    shift\n    if [[ "$1" == "--hostname" ]]; then echo "$2" > /tmp/fakepve/hostname; fi\n'
    '    exit 0;;',
)
p.write_text(text)
PY
```

- [ ] **Step 2: Verhalten testen (rot)**

Run: `bash -n install/timeblocks.sh && grep -q 'HOSTNAME_ARG:-zeiterfassung' install/timeblocks.sh`
Expected: FAIL (Default ist noch `$APP`).

- [ ] **Step 3: Installer ändern**

Defaults und Parsing:

```bash
HOSTNAME_EXPLICIT="0"
HOSTNAME_ARG="${HOSTNAME_ARG:-zeiterfassung}"
...
    --hostname) HOSTNAME_ARG="$2"; HOSTNAME_EXPLICIT="1"; shift 2;;
```

Existing-Branch:

```bash
if pct status "$CT_ID" >/dev/null 2>&1; then
  EXISTING_HOSTNAME="$(pct config "$CT_ID" | awk -F': ' '/^hostname:/ {print $2}')"
  if [[ "$EXISTING_HOSTNAME" != "$HOSTNAME_ARG" ]]; then
    if [[ "$EXISTING_HOSTNAME" == "timeblocks" && "$HOSTNAME_EXPLICIT" == "0" ]]; then
      msg_info "Benenne CT ${CT_ID} von 'timeblocks' in '${HOSTNAME_ARG}' um ..."
      if ! pct set "$CT_ID" --hostname "$HOSTNAME_ARG" 2>/dev/null; then
        msg_warn "Hostname-Änderung im Betrieb abgelehnt – CT wird kurz gestoppt."
        pct stop "$CT_ID"
        pct set "$CT_ID" --hostname "$HOSTNAME_ARG"
        pct start "$CT_ID" || true
      fi
      msg_ok "Hostname in PVE-Config: ${HOSTNAME_ARG}"
    else
      msg_error "CT ${CT_ID} existiert bereits mit Hostname '${EXISTING_HOSTNAME}'."
      msg_error "Zum Aktualisieren denselben Hostnamen verwenden oder '--hostname ${EXISTING_HOSTNAME}' setzen."
      exit 1
    fi
  fi
  msg_warn "CT ${CT_ID} existiert – Update-Modus (Code wird aktualisiert)."
else
```

Bootstrap-Argument:

```bash
BOOT_ARGS+=(
  --hostname "$HOSTNAME_ARG"
  ...
)
```

Im Bootstrap-Header:

```bash
HOSTNAME_TARGET=""
...
    --hostname) HOSTNAME_TARGET="$2"; shift 2;;
```

Nach `exec > >(tee -a "$LOG_FILE") 2>&1`:

```bash
if [[ -n "$HOSTNAME_TARGET" ]]; then
  hostnamectl set-hostname "$HOSTNAME_TARGET" 2>/dev/null \
    || printf '%s\n' "$HOSTNAME_TARGET" > /etc/hostname
  if grep -q '^127\.0\.1\.1[[:space:]]' /etc/hosts; then
    sed -i "s|^127\.0\.1\.1.*|127.0.1.1\t${HOSTNAME_TARGET}|" /etc/hosts
  else
    printf '127.0.1.1\t%s\n' "$HOSTNAME_TARGET" >> /etc/hosts
  fi
fi
```

- [ ] **Step 4: Syntax + Simulation**

```bash
bash -n install/timeblocks.sh
shellcheck install/timeblocks.sh
PATH="/tmp/fakepve:$PATH" bash install/timeblocks.sh --ctid 109 --yes
cat /tmp/fakepve/hostname
```
Expected: `zeiterfassung`; Log enthält „Benenne CT 109 ... um"; Exit 0 (Stubs liefern Health-Checks).

- [ ] **Step 5: Commit**

```bash
git add install/timeblocks.sh
git commit -m "feat(install): default hostname zeiterfassung and auto-rename old CT"
```

---

## Phase 2 — React-Grundlage und Tag-Ansicht

### Task 6: Vite/React-Gerüst, Design-Tokens, AppShell

**Files:**
- Create: `web/package.json`, `web/tsconfig.json`, `web/vite.config.ts`, `web/index.html`
- Create: `web/src/main.tsx`, `web/src/App.tsx`, `web/src/components/AppShell.tsx`
- Create: `web/src/styles/tokens.css`, `web/src/styles/global.css`, `web/src/styles/components.css`
- Create: `web/src/test/setup.ts`, `web/src/components/AppShell.test.tsx`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `Tab = "day" | "dashboard" | "settings"`; `<AppShell active onNavigate>{children}</AppShell>`; CSS-Variablen in `tokens.css`.
- Produces: `npm run dev|build|test|typecheck` in `web/`.

- [ ] **Step 1: Projektdateien anlegen**

```json
{
  "name": "timeblocks-web",
  "private": true,
  "version": "2.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.1.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.4",
    "jsdom": "^25.0.1",
    "typescript": "^5.7.2",
    "vite": "^6.0.5",
    "vitest": "^2.1.8"
  }
}
```

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["vitest/globals"]
  },
  "include": ["src"]
}
```

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/static/",
  plugins: [react()],
  build: { outDir: "../app/static", emptyOutDir: true },
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:8100" } },
  test: { environment: "jsdom", setupFiles: "./src/test/setup.ts" },
});
```

```html
<!doctype html>
<html lang="de">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="theme-color" content="#0b0b0f" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="apple-touch-icon" href="/static/icons/icon-192.png" />
    <title>Timeblocks</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

```css
/* web/src/styles/tokens.css */
:root {
  --bg: #0b0b0f;
  --panel: #15151b;
  --panel-2: #1d1d25;
  --line: #2a2a35;
  --text: #f5f5f7;
  --muted: #9a9aa5;
  --accent: #0a84ff;
  --green: #30d158;
  --red: #ff375f;
  --radius: 16px;
  --radius-sm: 10px;
  --shadow: 0 18px 50px rgb(0 0 0 / 35%);
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
}
```

```css
/* web/src/styles/global.css */
@import "./tokens.css";
@import "./components.css";
* { box-sizing: border-box; }
html, body, #root { min-height: 100%; }
body {
  margin: 0;
  background: radial-gradient(120% 80% at 50% 0%, #171722 0%, var(--bg) 60%);
  color: var(--text);
  font-family: var(--font);
  font-variant-numeric: tabular-nums;
  -webkit-font-smoothing: antialiased;
}
button, input, select, textarea { font: inherit; color: inherit; }
button { cursor: pointer; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
```

```css
/* web/src/styles/components.css */
.shell { display: grid; grid-template-columns: 220px minmax(0, 1fr); min-height: 100vh; }
.sidebar {
  display: flex; flex-direction: column; position: sticky; top: 0; height: 100vh; padding: 22px 14px;
  border-right: 1px solid var(--line); background: #0e0e14cc; backdrop-filter: blur(12px);
}
.brand { display: flex; flex-direction: column; gap: 4px; padding: 6px 10px 22px; font-weight: 700; }
.brand span { color: var(--muted); font-size: 12px; font-weight: 500; }
.sidebar-logout { margin-top: auto; border: 0; background: transparent; color: var(--muted); text-align: left; padding: 10px; }
.sidebar nav { display: grid; gap: 6px; }
.sidebar nav button, .bottom-nav button {
  display: flex; align-items: center; gap: 10px; border: 1px solid transparent;
  background: transparent; border-radius: 12px; padding: 10px 12px; color: var(--muted); text-align: left;
}
.sidebar nav button[aria-current="page"], .bottom-nav button[aria-current="page"] {
  background: var(--panel); border-color: var(--line); color: var(--text);
}
.content { width: 100%; max-width: 1180px; margin: 0 auto; padding: 26px 26px 60px; }
.bottom-nav { display: none; }
.center { padding: 48px 20px; text-align: center; color: var(--muted); }
.error-banner {
  position: fixed; left: 50%; top: 14px; transform: translateX(-50%); z-index: 80;
  background: #3a1220; border: 1px solid #ff375f66; color: #ffd7df; padding: 10px 16px; border-radius: 12px;
}
@media (max-width: 899px) {
  .shell { grid-template-columns: 1fr; }
  .sidebar { display: none; }
  .content { padding: 16px 14px 96px; }
  .bottom-nav {
    display: grid; grid-template-columns: repeat(3, 1fr); position: fixed; z-index: 40;
    left: 0; right: 0; bottom: 0; padding: 8px 10px calc(8px + env(safe-area-inset-bottom));
    background: #101017ee; border-top: 1px solid var(--line); backdrop-filter: blur(14px);
  }
  .bottom-nav button { flex-direction: column; gap: 2px; justify-content: center; font-size: 11px; }
}
.day-header { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.day-header > div { flex: 1; min-width: 180px; }
.day-header h1 { margin: 0; font-size: 1.05rem; color: var(--muted); font-weight: 600; }
.day-header p { margin: 2px 0 0; font-size: clamp(2rem, 7vw, 2.8rem); font-weight: 700; letter-spacing: -0.03em; }
.day-header button {
  border: 1px solid var(--line); background: var(--panel); border-radius: 12px; padding: 8px 12px;
}
.chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 18px 0; }
.chip {
  display: inline-flex; align-items: center; gap: 8px; border: 1px solid var(--line);
  background: var(--panel); border-radius: 999px; padding: 8px 14px; color: var(--text);
}
.chip.running { border-color: var(--chip); box-shadow: 0 0 24px color-mix(in srgb, var(--chip) 35%, transparent); }
.chip b { font-size: 12px; color: var(--muted); }
.dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; flex: none; }
.chip .dot { background: var(--chip); }
.timeline {
  position: relative; margin-top: 16px; border: 1px solid var(--line); border-radius: var(--radius);
  background: var(--panel); overflow: hidden;
}
.hour { position: absolute; left: 0; right: 0; height: 56px; border-top: 1px solid #ffffff0d; pointer-events: none; }
.hour span { position: absolute; left: 8px; top: 2px; font-size: 10px; color: var(--muted); }
.block {
  position: absolute; left: 54px; right: 12px; z-index: 2; padding: 4px 9px; overflow: hidden;
  border: 0; border-left: 3px solid var(--block); border-radius: 9px; text-align: left;
  background: color-mix(in srgb, var(--block) 24%, #17171f); color: var(--text);
}
.block span { display: block; font-size: 12px; font-weight: 600; }
.block em { display: block; font-size: 11px; color: #d9d9e3; font-style: normal; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.handle { position: absolute; left: 0; right: 0; height: 8px; cursor: ns-resize; }
.handle.top { top: 0; }
.handle.bottom { bottom: 0; }
.timeline-create { position: absolute; inset: 0; z-index: 1; }
.now-line { position: absolute; left: 0; right: 0; z-index: 3; border-top: 2px solid var(--red); pointer-events: none; }
.entry-list { list-style: none; margin: 18px 0 0; padding: 0; display: grid; gap: 6px; }
.entry-list li { display: flex; gap: 8px; align-items: stretch; }
.entry-list li > button:first-child {
  flex: 1; display: grid; grid-template-columns: auto 1fr auto auto; gap: 10px; align-items: center;
  border: 1px solid var(--line); background: var(--panel); border-radius: 12px; padding: 10px 12px; text-align: left;
}
.entry-list em { grid-column: 2 / -1; color: var(--muted); font-style: normal; font-size: 12px; }
.entry-list li > button:last-child { border: 1px solid var(--line); background: var(--panel); border-radius: 12px; padding: 0 12px; color: var(--muted); }
.sheet-backdrop { position: fixed; inset: 0; z-index: 60; background: #000a; display: flex; align-items: flex-end; justify-content: center; }
.sheet {
  width: min(580px, 100%); max-height: 92vh; overflow: auto; padding: 20px;
  background: var(--panel); border: 1px solid var(--line); border-radius: 20px 20px 0 0; box-shadow: var(--shadow);
}
.sheet header { display: flex; align-items: center; justify-content: space-between; }
.sheet h2 { margin: 0; font-size: 1.05rem; }
.sheet header button { border: 0; background: transparent; font-size: 22px; color: var(--muted); }
@media (min-width: 700px) {
  .sheet-backdrop { align-items: center; }
  .sheet { border-radius: 20px; }
}
.field { display: flex; flex-direction: column; gap: 6px; margin: 13px 0; font-size: 12px; color: var(--muted); }
.field input, .field select, .field textarea {
  width: 100%; background: var(--panel-2); border: 1px solid var(--line); border-radius: 10px;
  padding: 10px 12px; color: var(--text);
}
.sheet-actions { display: flex; gap: 10px; margin-top: 14px; }
.sheet-actions .primary { flex: 1; }
.sheet-actions .danger { border: 1px solid var(--line); background: transparent; border-radius: 12px; padding: 12px 16px; color: var(--red); }
.primary { width: 100%; border: 0; border-radius: 12px; padding: 12px; background: var(--accent); color: #fff; font-weight: 600; }
.primary:disabled { opacity: 0.6; }
.toast {
  position: fixed; left: 50%; bottom: 86px; transform: translateX(-50%); z-index: 70;
  display: flex; align-items: center; gap: 12px; padding: 10px 12px 10px 16px;
  background: #22222c; border: 1px solid var(--line); border-radius: 999px; box-shadow: var(--shadow);
}
.toast button { border: 0; background: transparent; color: var(--accent); font-weight: 600; }
.kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin: 16px 0; }
.kpis article { padding: 14px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--panel); }
.kpis span { display: block; color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; }
.kpis strong { display: block; margin-top: 6px; font-size: clamp(1.15rem, 3vw, 1.6rem); letter-spacing: -0.02em; }
.period-picker { display: flex; flex-wrap: wrap; align-items: end; gap: 8px; }
.period-picker button, .period-picker input {
  border: 1px solid var(--line); background: var(--panel); border-radius: 10px; padding: 8px 11px; color: var(--text);
}
.period-picker button[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); }
.period-picker label { display: grid; gap: 4px; font-size: 10px; color: var(--muted); }
.donut {
  display: grid; grid-template-columns: 240px minmax(0, 1fr); align-items: center; gap: 16px;
  margin: 16px 0; padding: 18px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--panel);
}
.donut svg { grid-column: 1; grid-row: 1; width: 220px; height: 220px; }
.donut-center { grid-column: 1; grid-row: 1; justify-self: center; text-align: center; display: grid; gap: 2px; }
.donut-center strong { font-size: 1.4rem; }
.donut-center span { color: var(--muted); font-size: 11px; }
.legend { grid-column: 2; grid-row: 1; list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.legend li { display: grid; grid-template-columns: auto 1fr auto auto; gap: 8px; align-items: center; font-size: 13px; }
.legend b { font-weight: 500; color: var(--muted); }
.legend em { color: var(--muted); font-style: normal; width: 48px; text-align: right; }
.top-categories { list-style: none; margin: 0 0 16px; padding: 0; display: grid; gap: 8px; }
.top-categories li { display: grid; grid-template-columns: 90px minmax(0, 1fr) auto; gap: 10px; align-items: center; font-size: 13px; }
.top-categories i { display: block; height: 8px; border-radius: 999px; min-width: 2px; }
.heatmap { display: flex; gap: 3px; overflow-x: auto; padding: 14px; margin: 16px 0; border: 1px solid var(--line); border-radius: var(--radius); background: var(--panel); }
.heat-week { display: grid; gap: 3px; }
.heat { width: 11px; height: 11px; border-radius: 3px; background: var(--panel-2); }
.heat-1 { background: #1f4d36; }
.heat-2 { background: #247347; }
.heat-3 { background: #2aa855; }
.heat-4 { background: var(--green); }
.trend { margin: 16px 0; padding: 14px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--panel); }
.trend svg { width: 100%; height: auto; display: block; }
.trend figcaption { display: flex; justify-content: space-between; color: var(--muted); font-size: 11px; }
.entry-feed { list-style: none; margin: 16px 0; padding: 0; display: grid; gap: 6px; }
.entry-feed li { display: grid; grid-template-columns: auto 1fr auto; gap: 10px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--panel); }
.entry-feed em { grid-column: 2 / -1; color: var(--muted); font-style: normal; font-size: 12px; }
.settings h1, .dashboard h1 { font-size: 1.4rem; margin: 0 0 16px; }
.settings h2 { font-size: 1rem; margin: 24px 0 10px; }
.settings ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
.dashboard-head { display: flex; flex-wrap: wrap; align-items: end; justify-content: space-between; gap: 10px; }
.dashboard-head > button { border: 1px solid var(--line); background: var(--panel); border-radius: 10px; padding: 8px 12px; color: var(--text); }
.dashboard-grid { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr); gap: 12px; }
.detail-cell { max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.category-row {
  display: grid; grid-template-columns: auto minmax(110px, 1fr) 90px 110px minmax(180px, 1.2fr) auto;
  gap: 10px; align-items: center; padding: 12px;
  border: 1px solid var(--line); border-radius: 12px; background: var(--panel);
}
.category-row.archived { opacity: 0.55; }
.category-row label { display: grid; gap: 4px; font-size: 10px; color: var(--muted); }
.category-row label small { font-size: 10px; color: var(--muted); }
.category-row input { min-width: 0; border: 1px solid var(--line); background: var(--panel-2); border-radius: 8px; padding: 7px 9px; color: var(--text); }
.category-row input[type="color"] { width: 38px; padding: 2px; }
.category-row button { border: 1px solid var(--line); background: transparent; border-radius: 8px; padding: 7px 10px; color: var(--muted); }
.category-new { display: flex; gap: 8px; margin: 14px 0 24px; }
.category-new input { flex: 1; border: 1px solid var(--line); background: var(--panel-2); border-radius: 8px; padding: 8px 10px; color: var(--text); }
.category-new input[type="color"] { flex: 0 0 44px; padding: 2px; }
.category-new button { border: 1px solid var(--line); background: var(--panel); border-radius: 8px; padding: 8px 12px; color: var(--text); }
.empty { padding: 28px; text-align: center; color: var(--muted); border: 1px dashed var(--line); border-radius: var(--radius); display: grid; gap: 12px; justify-items: center; }
.empty button { border: 1px solid var(--line); background: var(--panel); border-radius: 10px; padding: 8px 12px; color: var(--text); }
.login { max-width: 360px; margin: 16vh auto; display: grid; gap: 12px; padding: 24px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--panel); }
.login h1 { margin: 0; }
.login input { border: 1px solid var(--line); background: var(--panel-2); border-radius: 10px; padding: 11px 12px; }
.login p { margin: 0; color: var(--muted); font-size: 13px; }
@media (max-width: 760px) {
  .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .donut { grid-template-columns: 1fr; justify-items: center; }
  .donut svg, .donut-center { grid-column: 1; grid-row: 1; }
  .legend { grid-column: 1; grid-row: 2; width: 100%; }
  .category-row { grid-template-columns: auto 1fr; }
  .category-row label { grid-column: 1 / -1; }
}
```

```tsx
// web/src/components/AppShell.tsx
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
```

```tsx
// web/src/App.tsx (Gerüst; wird in Task 9/11/13 erweitert)
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
```

```tsx
// web/src/main.tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
```

```ts
// web/src/test/setup.ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 2: Failing Test**

```tsx
// web/src/components/AppShell.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AppShell from "./AppShell";

describe("AppShell", () => {
  it("renders the three tabs and reports navigation", () => {
    const onNavigate = vi.fn();
    const onLogout = vi.fn();
    render(
      <AppShell active="day" onNavigate={onNavigate} total="2h 10m" onLogout={onLogout}>
        <p>Inhalt</p>
      </AppShell>,
    );
    expect(screen.getByTestId("bottom-day")).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("2h 10m")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("bottom-dashboard"));
    expect(onNavigate).toHaveBeenCalledWith("dashboard");
    fireEvent.click(screen.getByTestId("sidebar-logout"));
    expect(onLogout).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Installieren und rot laufen lassen**

```bash
cd web && npm install
npm run test -- AppShell
```
Expected: FAIL, solange `AppShell.tsx` fehlt (Datei zuerst anlegen, dann Test).

- [ ] **Step 4: Grün + Typecheck**

```bash
cd web && npm run test && npm run typecheck
```
Expected: PASS.

- [ ] **Step 5: `.gitignore` ergänzen**

```gitignore
web/node_modules/
web/dist/
```

- [ ] **Step 6: Commit**

```bash
git add web .gitignore
git commit -m "feat(web): scaffold React/Vite app with design tokens and shell"
```

---

### Task 7: API-Client, Typen und Daten-Hook

**Files:**
- Create: `web/src/api/types.ts`, `web/src/api/client.ts`
- Create: `web/src/hooks/useAppData.ts`
- Create: `web/src/features/auth/LoginView.tsx`
- Create: `web/src/features/auth/LoginView.test.tsx`
- Create: `web/src/lib/time.ts`
- Create: `web/src/api/client.test.ts`, `web/src/lib/time.test.ts`

**Interfaces:**
- Produces: Typen `Category`, `Entry`, `DayPayload`, `AppState`, `StatsPayload`, `SummaryPayload`, `StatRow`, `DayPoint`.
- Produces: `api.get/post/patch/put/del`, `ApiError`; `useAppData()` mit `{state, day, date, setDate, status, error, reload, reloadDay, clockOffset}`.
- Produces: `fmtDuration(minutes)`, `fmtClock(ms, tz)`, `localDateStr(ms, tz)`, `toWallInput(ms, tz)`, `shiftDate(date, days)`.

- [ ] **Step 1: Failing Tests**

```ts
// web/src/api/client.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "./client";

afterEach(() => vi.unstubAllGlobals());

describe("api client", () => {
  it("sends same-origin credentials and returns json", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.get<{ ok: boolean }>("/state")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/state",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("throws ApiError with server message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "Nicht angemeldet" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    await expect(api.get("/state")).rejects.toEqual(
      expect.objectContaining({ status: 401, message: "Nicht angemeldet" }),
    );
    await expect(api.get("/state")).rejects.toBeInstanceOf(ApiError);
  });
});
```

```ts
// web/src/lib/time.test.ts
import { describe, expect, it } from "vitest";
import { fmtDuration, shiftDate } from "./time";

describe("time helpers", () => {
  it("formats durations", () => {
    expect(fmtDuration(0)).toBe("0m");
    expect(fmtDuration(59)).toBe("59m");
    expect(fmtDuration(60)).toBe("1h 00m");
    expect(fmtDuration(125)).toBe("2h 05m");
  });

  it("shifts ISO dates across month boundaries", () => {
    expect(shiftDate("2026-11-30", 1)).toBe("2026-12-01");
    expect(shiftDate("2026-01-01", -1)).toBe("2025-12-31");
  });
});
```

```tsx
// web/src/features/auth/LoginView.test.tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LoginView } from "./LoginView";

describe("LoginView", () => {
  it("posts the password and calls onSuccess", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onSuccess = vi.fn();
    render(<LoginView onSuccess={onSuccess} />);

    fireEvent.change(screen.getByLabelText("Passwort"), { target: { value: "geheim" } });
    fireEvent.click(screen.getByRole("button", { name: "Anmelden" }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/login");
    expect(init).toEqual(
      expect.objectContaining({ method: "POST", body: JSON.stringify({ password: "geheim" }) }),
    );
  });
});
```

- [ ] **Step 2: Rot**

Run: `cd web && npm run test -- client time login`
Expected: FAIL, Module fehlen.

- [ ] **Step 3: Implementieren**

```ts
// web/src/api/types.ts
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
```

```ts
// web/src/api/client.ts
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

type Init = Omit<RequestInit, "body"> & { body?: unknown };

async function request<T>(path: string, init: Init = {}): Promise<T> {
  const { body, headers, ...rest } = init;
  const response = await fetch(`/api${path}`, {
    credentials: "same-origin",
    ...rest,
    headers: body === undefined ? headers : { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const isJson = (response.headers.get("content-type") || "").includes("application/json");
  const payload = isJson ? await response.json() : null;
  if (!response.ok) {
    throw new ApiError(payload?.error || `HTTP ${response.status}`, response.status);
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: "PUT", body }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unbekannter Fehler";
}
```

```ts
// web/src/lib/time.ts
export const MINUTE = 60000;
export const HOUR = 3600000;

const pad = (value: number) => String(value).padStart(2, "0");

export function fmtDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h === 0 ? `${m}m` : `${h}h ${pad(m)}m`;
}

export function localDateStr(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

export function fmtClock(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(ms));
}

export function toWallInput(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .format(new Date(ms))
    .replace(" ", "T");
}

export function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function fmtDateLong(date: string): string {
  return new Intl.DateTimeFormat("de-DE", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  }).format(new Date(`${date}T12:00:00Z`));
}
```

```tsx
// web/src/features/auth/LoginView.tsx
import { useState, type FormEvent } from "react";
import { api, errorMessage } from "../../api/client";

export function LoginView({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await api.post("/login", { password });
      onSuccess();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="login" data-testid="login-form" onSubmit={submit}>
      <h1>Timeblocks</h1>
      <p>Bitte anmelden, um die Zeiterfassung zu öffnen.</p>
      <input
        type="password"
        aria-label="Passwort"
        autoFocus
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      {error ? <p role="alert">{error}</p> : null}
      <button type="submit" className="primary" disabled={busy}>
        {busy ? "Anmelden …" : "Anmelden"}
      </button>
    </form>
  );
}
```

```ts
// web/src/hooks/useAppData.ts
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
      setError(err instanceof Error ? err.message : "Laden fehlgeschlagen");
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
```

- [ ] **Step 4: Grün**

Run: `cd web && npm run test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src
git commit -m "feat(web): add typed API client, time helpers and app data hook"
```

---

### Task 8: Timeline-Mathematik

**Files:**
- Create: `web/src/lib/timeline.ts`
- Create: `web/src/lib/timeline.test.ts`

**Interfaces:**
- Produces: `SNAP_MS = 5 * 60000`; `snapMs(ms, origin)`; `clampRange(start, end, dayStart, dayEnd)`; `msToY(ms, dayStart, pxPerHour)`; `yToMs(y, dayStart, pxPerHour)`.

- [ ] **Step 1: Failing Test**

```ts
import { describe, expect, it } from "vitest";
import { SNAP_MS, clampRange, snapMs, yToMs } from "./timeline";

const dayStart = Date.UTC(2026, 10, 10, 0, 0);

describe("timeline math", () => {
  it("snaps to five minutes relative to the day", () => {
    expect(snapMs(dayStart + 8 * 3600000 + 3 * 60000, dayStart)).toBe(
      dayStart + 8 * 3600000 + 5 * 60000,
    );
    expect(snapMs(dayStart + 8 * 3600000 + 2 * 60000, dayStart)).toBe(dayStart + 8 * 3600000);
  });

  it("clamps ranges into the day and enforces five minutes", () => {
    const dayEnd = dayStart + 24 * 3600000;
    expect(clampRange(dayStart - 3600000, dayStart + 3600000, dayStart, dayEnd)).toEqual({
      start: dayStart,
      end: dayStart + 3600000,
    });
    expect(clampRange(dayEnd - 60000, dayEnd + 3600000, dayStart, dayEnd)).toEqual({
      start: dayEnd - SNAP_MS,
      end: dayEnd,
    });
  });

  it("maps pixels to milliseconds", () => {
    expect(yToMs(56, dayStart, 56)).toBe(dayStart + 3600000);
  });
});
```

- [ ] **Step 2: Rot**

Run: `cd web && npm run test -- timeline`
Expected: FAIL, Modul fehlt.

- [ ] **Step 3: Implementieren**

```ts
export const SNAP_MS = 5 * 60000;

export function snapMs(ms: number, origin: number): number {
  return origin + Math.round((ms - origin) / SNAP_MS) * SNAP_MS;
}

export function clampRange(
  start: number,
  end: number,
  dayStart: number,
  dayEnd: number,
): { start: number; end: number } {
  const latestStart = dayEnd - SNAP_MS;
  const clampedStart = Math.max(dayStart, Math.min(snapMs(start, dayStart), latestStart));
  const clampedEnd = Math.max(
    clampedStart + SNAP_MS,
    Math.min(snapMs(end, dayStart), dayEnd),
  );
  return { start: clampedStart, end: clampedEnd };
}

export function msToY(ms: number, dayStart: number, pxPerHour: number): number {
  return ((ms - dayStart) / 3600000) * pxPerHour;
}

export function yToMs(y: number, dayStart: number, pxPerHour: number): number {
  return dayStart + (y / pxPerHour) * 3600000;
}
```

- [ ] **Step 4: Grün**

Run: `cd web && npm run test -- timeline`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/timeline.ts web/src/lib/timeline.test.ts
git commit -m "feat(web): add timeline snapping and clamping helpers"
```

---

### Task 9: Tag-Ansicht mit Timer, Timeline, Sheet und Undo

**Files:**
- Create: `web/src/features/day/DayView.tsx`, `TimerChips.tsx`, `Timeline.tsx`, `EntrySheet.tsx`
- Create: `web/src/hooks/useNow.ts`
- Create: `web/src/components/Sheet.tsx`, `Toast.tsx`, `Field.tsx`
- Create: `web/src/features/day/DayView.test.tsx`
- Modify: `web/src/App.tsx`

**Interfaces:**
- `DayView` props: `{ state: AppState; day: DayPayload; nowMs: number; setDate: (date: string) => void; onChanged: () => void; onError: (message: string) => void }`.
- `EntrySheet` props: `{ open: boolean; categories: Category[]; initial: SheetDraft | null; timezone: string; onClose: () => void; onSaved: () => void; onDelete: (entry: Entry) => void; onError: (message: string) => void }` mit `SheetDraft = { mode: "create"; started_at: number; ended_at: number } | { mode: "create-duration"; date: string } | { mode: "edit"; entry: Entry }`.
- `TimerChips` props: `{ categories: Category[]; runningId: number | null; runningMinutes: number; onStart: (id: number) => void; onStop: () => void }`.

- [ ] **Step 1: Failing Tests**

```tsx
// web/src/features/day/DayView.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AppState, Category, DayPayload } from "../../api/types";
import { DayView } from "./DayView";
import { EntrySheet } from "./EntrySheet";
import { TimerChips } from "./TimerChips";

const category: Category = {
  id: 1, name: "Filme", color: "#FF6482", icon: "film", parent_id: null,
  goal_minutes_week: 0, detail_label: "Welcher Film?", sort_order: 0,
  archived: 0, created_at: 0,
};

const day: DayPayload = {
  date: "2026-11-10", start_ms: 1762732800000, end_ms: 1762819200000,
  now: 1762732800000, entries: [], total_minutes: 0, per_category: [],
  days_with_data: [],
};

const state: AppState = {
  now: 1762732800000, day_start_hour: 0, timezone: "Europe/Berlin",
  running_entry: null, categories: [category], auth_required: false, version: "2.0.0",
};

describe("day components", () => {
  it("uses the category detail label as placeholder", () => {
    render(
      <EntrySheet
        open
        categories={[category]}
        initial={{ mode: "create", started_at: day.start_ms + 3600000, ended_at: day.start_ms + 7200000 }}
        timezone="Europe/Berlin"
        onClose={() => {}}
        onSaved={() => {}}
        onDelete={() => {}}
        onError={() => {}}
      />,
    );
    expect(screen.getByTestId("sheet-detail")).toHaveAttribute("placeholder", "Welcher Film?");
  });

  it("starts a timer from a chip", () => {
    const onStart = vi.fn();
    render(
      <TimerChips
        categories={[category]}
        runningId={null}
        runningMinutes={0}
        onStart={onStart}
        onStop={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("timer-chip-1"));
    expect(onStart).toHaveBeenCalledWith(1);
  });

  it("renders the day total", () => {
    render(
      <DayView
        state={state}
        day={day}
        nowMs={day.start_ms}
        setDate={() => {}}
        onChanged={() => {}}
        onError={() => {}}
      />,
    );
    expect(screen.getByTestId("day-total")).toHaveTextContent("0m");
  });
});
```

- [ ] **Step 2: Rot**

Run: `cd web && npm run test -- DayView`
Expected: FAIL, Module fehlen.

- [ ] **Step 3: Implementieren**

```tsx
// web/src/components/Sheet.tsx
import type { ReactNode } from "react";

export default function Sheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <section
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <h2>{title}</h2>
          <button type="button" onClick={onClose} aria-label="Schließen">×</button>
        </header>
        {children}
      </section>
    </div>
  );
}
```

```tsx
// web/src/components/Toast.tsx
export default function Toast({
  message,
  actionLabel,
  onAction,
  onClose,
}: {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  onClose: () => void;
}) {
  return (
    <div className="toast" role="status" data-testid="toast">
      <span>{message}</span>
      {actionLabel && onAction ? (
        <button type="button" onClick={onAction}>{actionLabel}</button>
      ) : null}
      <button type="button" onClick={onClose} aria-label="Hinweis schließen">×</button>
    </div>
  );
}
```

```tsx
// web/src/components/Field.tsx
import type { ReactNode } from "react";

export default function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
```

```tsx
// web/src/features/day/TimerChips.tsx
import type { CSSProperties } from "react";
import type { Category } from "../../api/types";
import { fmtDuration } from "../../lib/time";

export function TimerChips({
  categories,
  runningId,
  runningMinutes,
  onStart,
  onStop,
}: {
  categories: Category[];
  runningId: number | null;
  runningMinutes: number;
  onStart: (id: number) => void;
  onStop: () => void;
}) {
  return (
    <div className="chips" role="list">
      {categories.map((category) => {
        const running = category.id === runningId;
        return (
          <button
            key={category.id}
            type="button"
            role="listitem"
            data-testid={`timer-chip-${category.id}`}
            className={running ? "chip running" : "chip"}
            style={{ "--chip": category.color } as CSSProperties}
            onClick={() => (running ? onStop() : onStart(category.id))}
          >
            <span className="dot" aria-hidden="true" />
            {category.name}
            {running ? <b>{fmtDuration(runningMinutes)}</b> : null}
          </button>
        );
      })}
    </div>
  );
}
```

```tsx
// web/src/features/day/Timeline.tsx
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { DayPayload, Entry } from "../../api/types";
import { fmtClock } from "../../lib/time";
import { clampRange, msToY, yToMs } from "../../lib/timeline";

const PX_PER_HOUR = 56;

type Drag = {
  entry: Entry;
  mode: "move" | "start" | "end";
  originY: number;
  start: number;
  end: number;
};

export function Timeline({
  day,
  now,
  timezone,
  onOpen,
  onPatch,
  onDelete,
  onCreate,
}: {
  day: DayPayload;
  now: number;
  timezone: string;
  onOpen: (entry: Entry) => void;
  onPatch: (id: number, range: { started_at: number; ended_at: number }) => void;
  onDelete: (entry: Entry) => void;
  onCreate: (startedAt: number, endedAt: number) => void;
}) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!drag) return;
    const move = (event: PointerEvent) => {
      const delta = ((event.clientY - drag.originY) / PX_PER_HOUR) * 3600000;
      if (drag.mode === "move") {
        const next = clampRange(drag.start + delta, drag.end + delta, day.start_ms, day.end_ms);
        setDrag({ ...drag, start: next.start, end: next.end });
      } else if (drag.mode === "start") {
        const next = clampRange(drag.start + delta, drag.end, day.start_ms, day.end_ms);
        setDrag({ ...drag, start: next.start, end: next.end });
      } else {
        const next = clampRange(drag.start, drag.end + delta, day.start_ms, day.end_ms);
        setDrag({ ...drag, start: next.start, end: next.end });
      }
    };
    const up = () => {
      if (drag.start !== drag.entry.started_at || drag.end !== drag.entry.effective_end) {
        onPatch(drag.entry.id, { started_at: drag.start, ended_at: drag.end });
      }
      setDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [drag, day, onPatch]);

  return (
    <div className="timeline" style={{ height: 24 * PX_PER_HOUR }} ref={trackRef}>
      {Array.from({ length: 24 }, (_, hour) => (
        <div key={hour} className="hour" style={{ top: hour * PX_PER_HOUR }}>
          <span>{String(hour).padStart(2, "0")}:00</span>
        </div>
      ))}
      <div
        className="now-line"
        style={{ top: msToY(now, day.start_ms, PX_PER_HOUR) }}
        aria-hidden="true"
      />
      {day.entries
        .filter((entry) => entry.kind === "timeline")
        .map((entry) => {
          const active = drag?.entry.id === entry.id ? drag : null;
          const start = active?.start ?? entry.started_at;
          const end = active?.end ?? entry.effective_end;
          const top = msToY(start, day.start_ms, PX_PER_HOUR);
          const height = Math.max(6, msToY(end, day.start_ms, PX_PER_HOUR) - top);
          return (
            <button
              key={entry.id}
              type="button"
              data-testid={`timeline-block-${entry.id}`}
              className="block"
              style={{ top, height, "--block": entry.category_color ?? "#0A84FF" } as CSSProperties}
              onPointerDown={(event) => {
                if (entry.ended_at === null) return;
                event.preventDefault();
                setDrag({
                  entry, mode: "move", originY: event.clientY,
                  start: entry.started_at, end: entry.effective_end,
                });
              }}
              onClick={() => onOpen(entry)}
              onKeyDown={(event) => {
                if (entry.ended_at === null) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onOpen(entry);
                } else if (event.key === "Delete" || event.key === "Backspace") {
                  event.preventDefault();
                  onDelete(entry);
                } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                  event.preventDefault();
                  const step = (event.shiftKey ? 30 : 5) * 60000;
                  const delta = event.key === "ArrowUp" ? -step : step;
                  const next = clampRange(
                    entry.started_at + delta,
                    entry.effective_end + delta,
                    day.start_ms,
                    day.end_ms,
                  );
                  onPatch(entry.id, { started_at: next.start, ended_at: next.end });
                }
              }}
              aria-label={`${entry.category_name}, ${fmtClock(entry.started_at, timezone)}`}
            >
              <span>{entry.category_name}</span>
              {entry.note ? <em>{entry.note}</em> : null}
              {entry.ended_at !== null ? (
                <>
                  <i className="handle top" onPointerDown={(event) => {
                    event.stopPropagation();
                    setDrag({ entry, mode: "start", originY: event.clientY, start: entry.started_at, end: entry.effective_end });
                  }} />
                  <i className="handle bottom" onPointerDown={(event) => {
                    event.stopPropagation();
                    setDrag({ entry, mode: "end", originY: event.clientY, start: entry.started_at, end: entry.effective_end });
                  }} />
                </>
              ) : null}
            </button>
          );
        })}
      <div
        className="timeline-create"
        onClick={(event) => {
          const rect = trackRef.current?.getBoundingClientRect();
          if (!rect) return;
          const raw = yToMs(event.clientY - rect.top, day.start_ms, PX_PER_HOUR);
          const start = Math.round(raw / (15 * 60000)) * 15 * 60000;
          const range = clampRange(start, start + 30 * 60000, day.start_ms, day.end_ms);
          onCreate(range.start, range.end);
        }}
      />
    </div>
  );
}
```

```tsx
// web/src/features/day/EntrySheet.tsx
import { useEffect, useState } from "react";
import { api, errorMessage } from "../../api/client";
import type { Category, Entry } from "../../api/types";
import Field from "../../components/Field";
import Sheet from "../../components/Sheet";
import { localDateStr, toWallInput } from "../../lib/time";

export type SheetDraft =
  | { mode: "create"; started_at: number; ended_at: number }
  | { mode: "create-duration"; date: string }
  | { mode: "edit"; entry: Entry };

export function EntrySheet({
  open,
  categories,
  initial,
  timezone,
  onClose,
  onSaved,
  onDelete,
  onError,
}: {
  open: boolean;
  categories: Category[];
  initial: SheetDraft | null;
  timezone: string;
  onClose: () => void;
  onSaved: () => void;
  onDelete: (entry: Entry) => void;
  onError: (message: string) => void;
}) {
  const editing = initial?.mode === "edit" ? initial.entry : null;
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? 0);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [minutes, setMinutes] = useState(30);
  const [durationDate, setDurationDate] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!initial) return;
    if (initial.mode === "edit") {
      setCategoryId(initial.entry.category_id);
      setStart(toWallInput(initial.entry.started_at, timezone));
      setEnd(toWallInput(initial.entry.effective_end, timezone));
      setDurationDate(localDateStr(initial.entry.started_at, timezone));
      setMinutes(initial.entry.minutes ?? 30);
      setNote(initial.entry.note);
    } else if (initial.mode === "create-duration") {
      setCategoryId(categories[0]?.id ?? 0);
      setDurationDate(initial.date);
      setMinutes(30);
      setNote("");
    } else {
      setCategoryId(categories[0]?.id ?? 0);
      setStart(toWallInput(initial.started_at, timezone));
      setEnd(toWallInput(initial.ended_at, timezone));
      setMinutes(30);
      setNote("");
    }
  }, [initial, categories, timezone]);

  const category = categories.find((item) => item.id === categoryId);

  async function save() {
    setBusy(true);
    try {
      if (editing?.kind === "duration") {
        await api.patch(`/entries/${editing.id}`, {
          category_id: categoryId,
          date: durationDate,
          minutes,
          note,
        });
      } else if (editing) {
        await api.patch(`/entries/${editing.id}`, {
          category_id: categoryId,
          started_at: start,
          ended_at: end,
          note,
        });
      } else if (initial?.mode === "create-duration") {
        await api.post("/entries/duration", {
          category_id: categoryId,
          date: durationDate,
          minutes,
          note,
        });
      } else {
        await api.post("/entries", {
          category_id: categoryId,
          started_at: start,
          ended_at: end,
          note,
        });
      }
      onSaved();
      onClose();
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} title={editing ? "Eintrag bearbeiten" : "Eintrag"} onClose={onClose}>
      <Field label="Kategorie">
        <select value={categoryId} onChange={(event) => setCategoryId(Number(event.target.value))}>
          {categories.map((item) => (
            <option key={item.id} value={item.id}>{item.name}</option>
          ))}
        </select>
      </Field>
      {editing?.kind === "duration" || initial?.mode === "create-duration" ? (
        <>
          <Field label="Datum">
            <input type="date" value={durationDate} onChange={(event) => setDurationDate(event.target.value)} />
          </Field>
          <Field label="Dauer (Minuten)">
            <input
              type="number" min={1} step={1} value={minutes}
              onChange={(event) => setMinutes(Number(event.target.value))}
            />
          </Field>
        </>
      ) : (
        <>
          <Field label="Start">
            <input type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} />
          </Field>
          <Field label="Ende">
            <input type="datetime-local" value={end} onChange={(event) => setEnd(event.target.value)} />
          </Field>
        </>
      )}
      <Field label="Detail">
        <textarea
          data-testid="sheet-detail"
          rows={3}
          maxLength={4000}
          placeholder={category?.detail_label || "Woran hast du gearbeitet?"}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </Field>
      <div className="sheet-actions">
        {editing ? (
          <button type="button" className="danger" onClick={() => onDelete(editing)}>
            Löschen
          </button>
        ) : null}
        <button type="button" className="primary" data-testid="sheet-save" disabled={busy} onClick={() => void save()}>
          {busy ? "Speichern …" : "Speichern"}
        </button>
      </div>
    </Sheet>
  );
}
```

```ts
// web/src/hooks/useNow.ts
import { useEffect, useState } from "react";

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}
```

```tsx
// web/src/features/day/DayView.tsx
import { useMemo, useState } from "react";
import { api, errorMessage } from "../../api/client";
import type { AppState, DayPayload, Entry } from "../../api/types";
import Toast from "../../components/Toast";
import { fmtClock, fmtDateLong, fmtDuration, localDateStr, shiftDate } from "../../lib/time";
import { EntrySheet, type SheetDraft } from "./EntrySheet";
import { Timeline } from "./Timeline";
import { TimerChips } from "./TimerChips";

export function DayView({
  state,
  day,
  nowMs,
  setDate,
  onChanged,
  onError,
}: {
  state: AppState;
  day: DayPayload;
  nowMs: number;
  setDate: (date: string) => void;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const [sheet, setSheet] = useState<SheetDraft | null>(null);
  const [deleted, setDeleted] = useState<{ entry: Entry; undo: () => Promise<void> } | null>(null);
  const running = state.running_entry;
  const runningMinutes = running
    ? (nowMs - running.started_at) / 60000
    : 0;

  const rows = useMemo(
    () => [...day.entries].sort((a, b) => a.started_at - b.started_at),
    [day.entries],
  );

  async function run(action: () => Promise<unknown>) {
    try {
      await action();
      onChanged();
    } catch (error) {
      onError(errorMessage(error));
    }
  }

  async function remove(entry: Entry) {
    if (entry.ended_at === null) return;
    const snapshot =
      entry.kind === "duration"
        ? {
            category_id: entry.category_id,
            date: localDateStr(entry.started_at, state.timezone),
            minutes: entry.minutes ?? 0,
            note: entry.note,
          }
        : {
            category_id: entry.category_id,
            started_at: entry.started_at,
            ended_at: entry.effective_end,
            note: entry.note,
          };
    await run(() => api.del(`/entries/${entry.id}`));
    setDeleted({
      entry,
      undo: async () => {
        if (entry.kind === "duration") await api.post("/entries/duration", snapshot);
        else await api.post("/entries", snapshot);
        onChanged();
      },
    });
  }

  return (
    <section className="day-view">
      <header className="day-header">
        <button type="button" onClick={() => setDate(shiftDate(day.date, -1))} aria-label="Vorheriger Tag">‹</button>
        <div>
          <h1>{fmtDateLong(day.date)}</h1>
          <p data-testid="day-total">{fmtDuration(day.total_minutes)}</p>
        </div>
        <button type="button" onClick={() => setDate(shiftDate(day.date, 1))} aria-label="Nächster Tag">›</button>
        <button type="button" onClick={() => setDate(localDateStr(nowMs, state.timezone))}>Heute</button>
        <button
          type="button"
          data-testid="add-duration"
          onClick={() => setSheet({ mode: "create-duration", date: day.date })}
        >
          Dauer
        </button>
      </header>

      <TimerChips
        categories={state.categories}
        runningId={running?.category_id ?? null}
        runningMinutes={runningMinutes}
        onStart={(id) => void run(() => api.post(`/timers/${id}/start`))}
        onStop={() => void run(() => api.post("/timers/stop"))}
      />

      <Timeline
        day={day}
        now={nowMs}
        timezone={state.timezone}
        onOpen={(entry) => setSheet({ mode: "edit", entry })}
        onPatch={(id, range) =>
          void run(() => api.patch(`/entries/${id}`, range))
        }
        onDelete={(entry) => void remove(entry)}
        onCreate={(started_at, ended_at) =>
          setSheet({ mode: "create", started_at, ended_at })
        }
      />

      <ul className="entry-list">
        {rows.map((entry) => (
          <li key={entry.id} data-testid={`entry-${entry.id}`}>
            <button type="button" onClick={() => setSheet({ mode: "edit", entry })}>
              <span className="dot" style={{ background: entry.category_color }} />
              <span>{entry.category_name}</span>
              <span>{fmtClock(entry.started_at, state.timezone)}</span>
              <span>{fmtDuration(entry.overlap_minutes ?? entry.minutes ?? 0)}</span>
              {entry.note ? <em>{entry.note}</em> : null}
            </button>
            <button type="button" aria-label="Löschen" onClick={() => void remove(entry)}>×</button>
          </li>
        ))}
      </ul>

      <EntrySheet
        open={sheet !== null}
        categories={state.categories}
        initial={sheet}
        timezone={state.timezone}
        onClose={() => setSheet(null)}
        onSaved={onChanged}
        onDelete={(entry) => {
          setSheet(null);
          void remove(entry);
        }}
        onError={onError}
      />

      {deleted ? (
        <Toast
          message="Eintrag gelöscht"
          actionLabel="Rückgängig"
          onAction={() => {
            void deleted.undo().finally(() => setDeleted(null));
          }}
          onClose={() => setDeleted(null)}
        />
      ) : null}
    </section>
  );
}
```

`App.tsx` bindet DayView und Login ein (Dashboard/Einstellungen folgen):

```tsx
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
```

- [ ] **Step 4: Grün**

Run: `cd web && npm run test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Manuell prüfen**

```bash
cd web && npm run dev
# http://127.0.0.1:5173 mit laufendem Flask auf 127.0.0.1:8100
```
Expected: Tag lädt, Timer startet/stoppt, Block verschiebt sich, Sheet speichert Detail.

- [ ] **Step 6: Commit**

```bash
git add web/src
git commit -m "feat(web): implement day view, timeline interactions and detail sheet"
```

---

## Phase 3 — Dashboard und Einstellungen

### Task 10: Dashboard-Mathematik

**Files:**
- Create: `web/src/lib/ranges.ts`, `web/src/lib/charts.ts`
- Create: `web/src/lib/ranges.test.ts`, `web/src/lib/charts.test.ts`

**Interfaces:**
- Produces: `Period = "week" | "month" | "year" | "custom"`; `periodRange(period, anchor, custom?) -> {from,to}`; `trendPoints(days, period, spanDays)`; `percentages(values)`; `heatLevel(minutes)`; `heatmapWeeks(days)`.

- [ ] **Step 1: Failing Tests**

```ts
// web/src/lib/ranges.test.ts
import { describe, expect, it } from "vitest";
import { periodRange } from "./ranges";

describe("period ranges", () => {
  it("uses Monday to Sunday for weeks", () => {
    expect(periodRange("week", "2026-11-10")).toEqual({ from: "2026-11-09", to: "2026-11-15" });
  });
  it("handles month and leap years", () => {
    expect(periodRange("month", "2024-02-12")).toEqual({ from: "2024-02-01", to: "2024-02-29" });
    expect(periodRange("month", "2026-11-10")).toEqual({ from: "2026-11-01", to: "2026-11-30" });
  });
  it("handles years and custom ranges", () => {
    expect(periodRange("year", "2026-11-10")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(periodRange("custom", "2026-11-10", { from: "2026-01-02", to: "2026-02-03" })).toEqual({
      from: "2026-01-02",
      to: "2026-02-03",
    });
    expect(() =>
      periodRange("custom", "2026-11-10", { from: "2026-02-03", to: "2026-01-02" }),
    ).toThrow();
  });
});
```

```ts
// web/src/lib/charts.test.ts
import { describe, expect, it } from "vitest";
import { heatLevel, heatmapWeeks, percentages, trendPoints } from "./charts";

describe("chart math", () => {
  it("distributes percentages with largest remainder", () => {
    const values = percentages([1, 1, 1]);
    expect(values.reduce((sum, value) => sum + value, 0)).toBe(100);
    expect(values).toEqual([33.4, 33.3, 33.3]);
  });
  it("handles empty and zero values", () => {
    expect(percentages([])).toEqual([]);
    expect(percentages([0, 0])).toEqual([0, 0]);
  });
  it("maps heat levels", () => {
    expect(heatLevel(0)).toBe(0);
    expect(heatLevel(1)).toBe(1);
    expect(heatLevel(29)).toBe(1);
    expect(heatLevel(30)).toBe(2);
    expect(heatLevel(60)).toBe(3);
    expect(heatLevel(120)).toBe(4);
  });
  it("aggregates long ranges by month", () => {
    const points = trendPoints(
      [
        { date: "2026-01-05", minutes: 30 },
        { date: "2026-01-20", minutes: 30 },
        { date: "2026-02-01", minutes: 60 },
      ],
      "year",
      365,
    );
    expect(points).toEqual([
      { label: "2026-01", minutes: 60 },
      { label: "2026-02", minutes: 60 },
    ]);
  });
  it("groups heatmap days into Monday-starting weeks", () => {
    const weeks = heatmapWeeks([
      { date: "2026-11-09", minutes: 10 },
      { date: "2026-11-10", minutes: 20 },
    ]);
    expect(weeks[0][0]).toEqual({ date: "2026-11-09", minutes: 10 });
    expect(weeks[0][1]).toEqual({ date: "2026-11-10", minutes: 20 });
    expect(weeks[0]).toHaveLength(7);
  });
});
```

- [ ] **Step 2: Rot**

Run: `cd web && npm run test -- ranges charts`
Expected: FAIL.

- [ ] **Step 3: Implementieren**

```ts
// web/src/lib/ranges.ts
export type Period = "week" | "month" | "year" | "custom";
export type Range = { from: string; to: string };

const iso = (date: Date) => date.toISOString().slice(0, 10);
const noon = (value: string) => new Date(`${value}T12:00:00Z`);

export function addDays(date: string, days: number): string {
  const value = noon(date);
  value.setUTCDate(value.getUTCDate() + days);
  return iso(value);
}

export function periodRange(period: Period, anchor: string, custom?: Range): Range {
  const date = noon(anchor);
  if (period === "week") {
    const offset = (date.getUTCDay() + 6) % 7;
    const from = addDays(anchor, -offset);
    return { from, to: addDays(from, 6) };
  }
  if (period === "month") {
    const from = `${anchor.slice(0, 7)}-01`;
    const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
    return { from, to: iso(last) };
  }
  if (period === "year") {
    return { from: `${date.getUTCFullYear()}-01-01`, to: `${date.getUTCFullYear()}-12-31` };
  }
  if (!custom) throw new Error("Eigener Zeitraum fehlt");
  if (custom.to < custom.from) throw new Error("Das Enddatum liegt vor dem Startdatum");
  return custom;
}
```

```ts
// web/src/lib/charts.ts
import type { DayPoint } from "../api/types";
import { addDays, type Period } from "./ranges";

export function percentages(values: number[], decimals = 1): number[] {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return values.map(() => 0);
  const factor = 10 ** decimals;
  const raw = values.map((value) => (value / total) * 100 * factor);
  const floors = raw.map(Math.floor);
  const missing = Math.round(100 * factor) - floors.reduce((sum, value) => sum + value, 0);
  const order = raw
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder);
  for (let index = 0; index < missing; index += 1) {
    floors[order[index % order.length].index] += 1;
  }
  return floors.map((value) => value / factor);
}

export function heatLevel(minutes: number): 0 | 1 | 2 | 3 | 4 {
  if (minutes <= 0) return 0;
  if (minutes < 30) return 1;
  if (minutes < 60) return 2;
  if (minutes < 120) return 3;
  return 4;
}

export function trendPoints(
  days: DayPoint[],
  period: Period,
  spanDays: number,
): { label: string; minutes: number }[] {
  if (period !== "year" && !(period === "custom" && spanDays > 62)) {
    return days.map((day) => ({ label: day.date.slice(5), minutes: day.minutes }));
  }
  const months = new Map<string, number>();
  for (const day of days) {
    const key = day.date.slice(0, 7);
    months.set(key, (months.get(key) ?? 0) + day.minutes);
  }
  return [...months.entries()].map(([label, minutes]) => ({ label, minutes }));
}

export function heatmapWeeks(days: DayPoint[]): DayPoint[][] {
  if (days.length === 0) return [];
  const byDate = new Map(days.map((day) => [day.date, day]));
  const anchor = new Date(`${days[0].date}T12:00:00Z`);
  let cursor = addDays(days[0].date, -((anchor.getUTCDay() + 6) % 7));
  const last = days[days.length - 1].date;
  const weeks: DayPoint[][] = [];
  let week: DayPoint[] = [];
  while (cursor <= last) {
    week.push(byDate.get(cursor) ?? { date: cursor, minutes: 0 });
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
    cursor = addDays(cursor, 1);
  }
  if (week.length > 0) weeks.push(week);
  return weeks;
}
```

- [ ] **Step 4: Grün**

Run: `cd web && npm run test -- ranges charts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib
git commit -m "feat(web): add period, percentage, heatmap and trend math"
```

---

### Task 11: Dashboard mit Zeitraum, KPIs, Donut und Top-Kategorien

**Files:**
- Create: `web/src/features/dashboard/DashboardView.tsx`, `PeriodPicker.tsx`, `KpiCards.tsx`, `CategoryDonut.tsx`, `TopCategories.tsx`
- Create: `web/src/features/dashboard/DashboardView.test.tsx`
- Modify: `web/src/App.tsx`

**Interfaces:**
- `DashboardView` props: `{ summary: SummaryPayload; stats: StatsPayload; period: Period; range: Range; onPeriod: (period: Period, custom?: Range) => void }`.
- Donut consumes `StatRow[]` and total; uses `fmtDuration`/`percentages`.

- [ ] **Step 1: Failing Test**

```tsx
// web/src/features/dashboard/DashboardView.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StatsPayload, SummaryPayload } from "../../api/types";
import { CategoryDonut } from "./CategoryDonut";
import { KpiCards } from "./KpiCards";
import { PeriodPicker } from "./PeriodPicker";

const summary: SummaryPayload = {
  now: 0,
  totals: { today_minutes: 30, week_minutes: 90, month_minutes: 120, all_minutes: 600 },
  lifetime_by_category: [],
  first_entry_date: "2026-01-01",
};

const stats: StatsPayload = {
  from: "2026-11-09", to: "2026-11-15", group_by: "category", total_minutes: 100,
  rows: [
    { key: "1", label: "Arbeit", color: "#FF375F", minutes: 60 },
    { key: "2", label: "Filme", color: "#FF6482", minutes: 40 },
  ],
  days: [],
  entries: [],
};

describe("dashboard", () => {
  it("renders KPI values", () => {
    render(<KpiCards summary={summary} />);
    expect(screen.getByTestId("kpi-today")).toHaveTextContent("30m");
    expect(screen.getByTestId("kpi-all")).toHaveTextContent("10h 00m");
  });
  it("renders donut legend percentages", () => {
    render(<CategoryDonut rows={stats.rows} total={100} />);
    expect(screen.getByText("60.0%")).toBeInTheDocument();
    expect(screen.getByText("40.0%")).toBeInTheDocument();
  });
  it("changes period", () => {
    const onPeriod = vi.fn();
    render(
      <PeriodPicker period="week" range={{ from: "2026-11-09", to: "2026-11-15" }} onPeriod={onPeriod} />,
    );
    fireEvent.click(screen.getByTestId("period-month"));
    expect(onPeriod).toHaveBeenCalledWith("month", undefined);
  });
});
```

- [ ] **Step 2: Rot**

Run: `cd web && npm run test -- Dashboard`
Expected: FAIL.

- [ ] **Step 3: Implementieren**

```tsx
// web/src/features/dashboard/KpiCards.tsx
import type { SummaryPayload } from "../../api/types";
import { fmtDuration } from "../../lib/time";

export function KpiCards({ summary }: { summary: SummaryPayload }) {
  const items = [
    ["today", "Heute", summary.totals.today_minutes],
    ["week", "Woche", summary.totals.week_minutes],
    ["month", "Monat", summary.totals.month_minutes],
    ["all", "Gesamt", summary.totals.all_minutes],
  ] as const;
  return (
    <div className="kpis">
      {items.map(([id, label, minutes]) => (
        <article key={id} data-testid={`kpi-${id}`}>
          <span>{label}</span>
          <strong>{fmtDuration(minutes)}</strong>
        </article>
      ))}
    </div>
  );
}
```

```tsx
// web/src/features/dashboard/PeriodPicker.tsx
import type { Period, Range } from "../../lib/ranges";

export function PeriodPicker({
  period,
  range,
  onPeriod,
}: {
  period: Period;
  range: Range;
  onPeriod: (period: Period, custom?: Range) => void;
}) {
  return (
    <div className="period-picker">
      {(["week", "month", "year"] as const).map((value) => (
        <button
          key={value}
          type="button"
          data-testid={`period-${value}`}
          aria-pressed={period === value}
          onClick={() => onPeriod(value, undefined)}
        >
          {value === "week" ? "Woche" : value === "month" ? "Monat" : "Jahr"}
        </button>
      ))}
      <label>
        Von
        <input
          type="date"
          value={range.from}
          onChange={(event) => onPeriod("custom", { from: event.target.value, to: range.to })}
        />
      </label>
      <label>
        Bis
        <input
          type="date"
          value={range.to}
          onChange={(event) => onPeriod("custom", { from: range.from, to: event.target.value })}
        />
      </label>
    </div>
  );
}
```

```tsx
// web/src/features/dashboard/CategoryDonut.tsx
import type { StatRow } from "../../api/types";
import { percentages } from "../../lib/charts";
import { fmtDuration } from "../../lib/time";

export function CategoryDonut({ rows, total }: { rows: StatRow[]; total: number }) {
  const parts = percentages(rows.map((row) => row.minutes));
  const size = 220;
  const stroke = 22;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="donut" data-testid="donut">
      <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Kategorien, ${fmtDuration(total)}`}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--panel-2)" strokeWidth={stroke} />
        {rows.map((row, index) => {
          const length = total > 0 ? (row.minutes / total) * circumference : 0;
          const element = (
            <circle
              key={row.key}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={row.color}
              strokeWidth={stroke}
              strokeDasharray={`${length} ${circumference - length}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          );
          offset += length;
          return element;
        })}
      </svg>
      <div className="donut-center">
        <strong>{fmtDuration(total)}</strong>
        <span>gesamt</span>
      </div>
      <ul className="legend">
        {rows.map((row, index) => (
          <li key={row.key}>
            <span className="dot" style={{ background: row.color }} />
            <span>{row.label}</span>
            <b>{fmtDuration(row.minutes)}</b>
            <em>{parts[index].toFixed(1)}%</em>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

```tsx
// web/src/features/dashboard/TopCategories.tsx
import type { StatRow } from "../../api/types";
import { fmtDuration } from "../../lib/time";

export function TopCategories({ rows }: { rows: StatRow[] }) {
  const max = Math.max(1, ...rows.map((row) => row.minutes));
  return (
    <ol className="top-categories">
      {rows.slice(0, 5).map((row) => (
        <li key={row.key}>
          <span>{row.label}</span>
          <i style={{ width: `${(row.minutes / max) * 100}%`, background: row.color }} />
          <b>{fmtDuration(row.minutes)}</b>
        </li>
      ))}
    </ol>
  );
}
```

```tsx
// web/src/features/dashboard/DashboardView.tsx
import type { StatsPayload, SummaryPayload } from "../../api/types";
import type { Period, Range } from "../../lib/ranges";
import { CategoryDonut } from "./CategoryDonut";
import { KpiCards } from "./KpiCards";
import { PeriodPicker } from "./PeriodPicker";
import { TopCategories } from "./TopCategories";

export function DashboardView({
  summary,
  stats,
  period,
  range,
  onPeriod,
}: {
  summary: SummaryPayload;
  stats: StatsPayload;
  period: Period;
  range: Range;
  onPeriod: (period: Period, custom?: Range) => void;
}) {
  if (stats.total_minutes === 0) {
    return (
      <section className="dashboard">
        <PeriodPicker period={period} range={range} onPeriod={onPeriod} />
        <p className="empty">Noch keine Zeit im gewählten Zeitraum.</p>
      </section>
    );
  }
  return (
    <section className="dashboard">
      <PeriodPicker period={period} range={range} onPeriod={onPeriod} />
      <KpiCards summary={summary} />
      <CategoryDonut rows={stats.rows} total={stats.total_minutes} />
      <TopCategories rows={stats.rows} />
    </section>
  );
}
```

- [ ] **Step 4: Grün**

Run: `cd web && npm run test -- Dashboard Kpi Period Donut && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/dashboard
git commit -m "feat(web): add dashboard KPIs, period picker, donut and top categories"
```

---

### Task 12: Heatmap, Trend, Tagesliste und CSV

**Files:**
- Create: `web/src/features/dashboard/Heatmap.tsx`, `TrendChart.tsx`, `DayTable.tsx`
- Modify: `web/src/features/dashboard/DashboardView.tsx`
- Create: `web/src/features/dashboard/Heatmap.test.tsx`, `DayTable.test.tsx`

**Interfaces:**
- `Heatmap` props `{ days: DayPoint[] }`; `TrendChart` props `{ points: {label,minutes}[] }`; `DayTable` props `{ entries: StatsEntry[]; timezone: string }`.
- `DashboardView` props `{ summary; stats; heatmap: DayPoint[]; timezone: string; period; range; onPeriod; onExport; onGoDay }`.
- `App.tsx` lädt Heatmap-Daten (365 Tage) über `/api/stats?from=…&to=…&group_by=day` und reicht sie an das Dashboard.

- [ ] **Step 1: Failing Test**

```tsx
// web/src/features/dashboard/Heatmap.test.tsx
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Heatmap } from "./Heatmap";

describe("Heatmap", () => {
  it("renders five levels with accessible titles", () => {
    const { container } = render(
      <Heatmap
        days={[
          { date: "2026-11-09", minutes: 0 },
          { date: "2026-11-10", minutes: 10 },
          { date: "2026-11-11", minutes: 45 },
          { date: "2026-11-12", minutes: 90 },
          { date: "2026-11-13", minutes: 200 },
        ]}
      />,
    );
    expect(container.querySelectorAll(".heat-1").length).toBe(1);
    expect(container.querySelectorAll(".heat-2").length).toBe(1);
    expect(container.querySelectorAll(".heat-3").length).toBe(1);
    expect(container.querySelectorAll(".heat-4").length).toBe(1);
    expect(container.querySelector('[title="2026-11-10: 10m"]')).toBeTruthy();
  });
});
```

```tsx
// web/src/features/dashboard/DayTable.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DayTable } from "./DayTable";

describe("DayTable", () => {
  it("renders entry details and duration", () => {
    render(
      <DayTable
        timezone="Europe/Berlin"
        entries={[{
          id: 7, category_id: 2, label: "Filme", color: "#FF6482",
          started_at: 1794301200000, effective_end: 1794304800000,
          minutes: 60, note: "Dune",
        }]}
      />,
    );
    expect(screen.getByText("Dune")).toBeInTheDocument();
    expect(screen.getByText("1h 00m")).toBeInTheDocument();
    expect(screen.getByText("Filme")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rot**

Run: `cd web && npm run test -- Heatmap DayTable`
Expected: FAIL.

- [ ] **Step 3: Implementieren**

```tsx
// web/src/features/dashboard/Heatmap.tsx
import type { DayPoint } from "../../api/types";
import { heatLevel, heatmapWeeks } from "../../lib/charts";
import { fmtDuration } from "../../lib/time";

export function Heatmap({ days }: { days: DayPoint[] }) {
  const weeks = heatmapWeeks(days);
  return (
    <div className="heatmap" data-testid="heatmap" aria-label="Aktivität der letzten 365 Tage">
      {weeks.map((week) => (
        <div className="heat-week" key={week[0].date}>
          {week.map((day) => (
            <span
              key={day.date}
              className={`heat heat-${heatLevel(day.minutes)}`}
              title={`${day.date}: ${fmtDuration(day.minutes)}`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
```

```tsx
// web/src/features/dashboard/TrendChart.tsx
import { fmtDuration } from "../../lib/time";

export function TrendChart({ points }: { points: { label: string; minutes: number }[] }) {
  const width = 640;
  const height = 180;
  const max = Math.max(1, ...points.map((point) => point.minutes));
  const step = points.length > 1 ? width / (points.length - 1) : width;
  const line = points
    .map((point, index) => `${index * step},${height - (point.minutes / max) * (height - 16)}`)
    .join(" ");
  const area = `0,${height} ${line} ${width},${height}`;

  return (
    <figure className="trend" data-testid="trend">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Zeitverlauf">
        <polygon points={area} fill="url(#trend-fill)" />
        <polyline points={line} fill="none" stroke="var(--accent)" strokeWidth={2.5} />
        <defs>
          <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0A84FF" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#0A84FF" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>
      <figcaption>
        <span>{points[0]?.label}</span>
        <span>max. {fmtDuration(max)}</span>
        <span>{points[points.length - 1]?.label}</span>
      </figcaption>
    </figure>
  );
}
```

```tsx
// web/src/features/dashboard/DayTable.tsx
import type { StatsEntry } from "../../api/types";
import { fmtClock, fmtDuration, localDateStr } from "../../lib/time";

export function DayTable({ entries, timezone }: { entries: StatsEntry[]; timezone: string }) {
  if (entries.length === 0) {
    return <p className="empty">Noch keine Einträge im gewählten Zeitraum.</p>;
  }
  return (
    <table className="day-table">
      <thead>
        <tr><th>Tag</th><th>Zeit</th><th>Kategorie</th><th>Detail</th><th>Dauer</th></tr>
      </thead>
      <tbody>
        {entries.map((entry) => (
          <tr key={entry.id}>
            <td>{localDateStr(entry.started_at, timezone)}</td>
            <td>{fmtClock(entry.started_at, timezone)}–{fmtClock(entry.effective_end, timezone)}</td>
            <td><span className="dot" style={{ background: entry.color }} />{entry.label}</td>
            <td className="detail-cell">{entry.note || "–"}</td>
            <td>{fmtDuration(entry.minutes)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

`DashboardView` vollständig ersetzen:

```tsx
// web/src/features/dashboard/DashboardView.tsx
import type { DayPoint, StatsPayload, SummaryPayload } from "../../api/types";
import { trendPoints } from "../../lib/charts";
import type { Period, Range } from "../../lib/ranges";
import { CategoryDonut } from "./CategoryDonut";
import { DayTable } from "./DayTable";
import { Heatmap } from "./Heatmap";
import { KpiCards } from "./KpiCards";
import { PeriodPicker } from "./PeriodPicker";
import { TopCategories } from "./TopCategories";
import { TrendChart } from "./TrendChart";

export function DashboardView({
  summary,
  stats,
  heatmap,
  timezone,
  period,
  range,
  onPeriod,
  onExport,
  onGoDay,
}: {
  summary: SummaryPayload;
  stats: StatsPayload;
  heatmap: DayPoint[];
  timezone: string;
  period: Period;
  range: Range;
  onPeriod: (period: Period, custom?: Range) => void;
  onExport: () => void;
  onGoDay: () => void;
}) {
  const points = trendPoints(stats.days, period, stats.days.length);
  return (
    <section className="dashboard">
      <header className="dashboard-head">
        <PeriodPicker period={period} range={range} onPeriod={onPeriod} />
        <button type="button" data-testid="export-csv" onClick={onExport}>CSV exportieren</button>
      </header>
      {stats.total_minutes === 0 ? (
        <div className="empty">
          <p>Noch keine Zeit im gewählten Zeitraum.</p>
          <button type="button" onClick={onGoDay}>Zum Tag</button>
        </div>
      ) : (
        <>
          <KpiCards summary={summary} />
          <div className="dashboard-grid">
            <CategoryDonut rows={stats.rows} total={stats.total_minutes} />
            <TopCategories rows={stats.rows} />
          </div>
          <TrendChart points={points} />
          <Heatmap days={heatmap} />
          <DayTable entries={stats.entries} timezone={timezone} />
        </>
      )}
    </section>
  );
}
```

Export in `App.tsx`:

```tsx
const onExport = () => {
  window.location.href = `/api/export.csv?from=${range.from}&to=${range.to}`;
};
```

- [ ] **Step 4: Grün**

Run: `cd web && npm run test -- Heatmap DayTable Trend && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/dashboard
git commit -m "feat(web): add heatmap, trend, table and CSV export"
```

---

### Task 13: Einstellungen mit Detail-Label

**Files:**
- Create: `web/src/features/settings/SettingsView.tsx`, `CategoryEditor.tsx`
- Create: `web/src/features/settings/SettingsView.test.tsx`
- Modify: `web/src/App.tsx`

**Interfaces:**
- `SettingsView` props `{ state: AppState; onChanged: () => void; onError: (message: string) => void; onLogout: () => void }`.
- `CategoryEditor` props `{ category: Category; onSave: (patch: Partial<Category>) => Promise<void>; onArchive: (archived: 0 | 1) => Promise<void> }`.
- `SettingsView` legt neue Kategorien über `POST /api/categories` an.

- [ ] **Step 1: Failing Test**

```tsx
// web/src/features/settings/SettingsView.test.tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AppState } from "../../api/types";
import { SettingsView } from "./SettingsView";

const state: AppState = {
  now: 0, day_start_hour: 0, timezone: "Europe/Berlin", running_entry: null,
  auth_required: false, version: "2.0.0",
  categories: [{
    id: 1, name: "Filme", color: "#FF6482", icon: "film", parent_id: null,
    goal_minutes_week: 0, detail_label: "Welcher Film?", sort_order: 0,
    archived: 0, created_at: 0,
  }],
};

describe("SettingsView", () => {
  it("shows and saves the category detail label", async () => {
    const onChanged = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ category: state.categories[0] }), {
        status: 200, headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<SettingsView state={state} onChanged={onChanged} onError={() => {}} onLogout={() => {}} />);

    const input = screen.getByTestId("detail-label-1") as HTMLInputElement;
    expect(input.value).toBe("Welcher Film?");
    fireEvent.change(input, { target: { value: "Welche Serie?" } });
    fireEvent.blur(input);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/categories/1",
      expect.objectContaining({ method: "PATCH" }),
    );
  });
});
```

- [ ] **Step 2: Rot**

Run: `cd web && npm run test -- Settings`
Expected: FAIL.

- [ ] **Step 3: Implementieren**

```tsx
// web/src/features/settings/CategoryEditor.tsx
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
    <li className={`category-row${category.archived ? " archived" : ""}`} data-testid={`category-${category.id}`}>
      <input
        type="color"
        aria-label={`Farbe für ${category.name}`}
        value={category.color}
        onChange={(event) => void onSave({ color: event.target.value })}
      />
      <input
        aria-label="Name"
        maxLength={40}
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => {
          if (name.trim() && name.trim() !== category.name) void onSave({ name: name.trim() });
        }}
      />
      <input
        aria-label="Icon"
        maxLength={40}
        value={icon}
        onChange={(event) => setIcon(event.target.value)}
        onBlur={() => {
          if (icon.trim() && icon.trim() !== category.icon) void onSave({ icon: icon.trim() });
        }}
      />
      <input
        aria-label="Wochenziel in Minuten"
        type="number" min={0} step={30}
        value={goal}
        onChange={(event) => setGoal(Number(event.target.value) || 0)}
        onBlur={() => void onSave({ goal_minutes_week: goal })}
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
            if (detailLabel !== category.detail_label) void onSave({ detail_label: detailLabel });
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
```

```tsx
// web/src/features/settings/SettingsView.tsx
import { api, errorMessage } from "../../api/client";
import type { AppState, Category } from "../../api/types";
import Field from "../../components/Field";
import { CategoryEditor } from "./CategoryEditor";

export function SettingsView({
  state,
  onChanged,
  onError,
  onLogout,
}: {
  state: AppState;
  onChanged: () => void;
  onError: (message: string) => void;
  onLogout: () => void;
}) {
  async function saveCategory(id: number, patch: Partial<Category>) {
    try {
      await api.patch(`/categories/${id}`, patch);
      onChanged();
    } catch (error) {
      onError(errorMessage(error));
    }
  }

  async function createCategory(name: string, color: string) {
    try {
      await api.post("/categories", { name, color });
      onChanged();
    } catch (error) {
      onError(errorMessage(error));
    }
  }

  async function saveSettings(dayStart: number, timezone: string) {
    try {
      await api.put("/settings", { day_start_hour: dayStart, timezone });
      onChanged();
    } catch (error) {
      onError(errorMessage(error));
    }
  }

  return (
    <section className="settings">
      <h1>Einstellungen</h1>
      <Field label="Tagesbeginn (Stunde)">
        <input
          data-testid="settings-day-start"
          type="number" min={0} max={23}
          defaultValue={state.day_start_hour}
          onBlur={(event) => void saveSettings(Number(event.target.value), state.timezone)}
        />
      </Field>
      <Field label="Zeitzone">
        <input
          data-testid="settings-timezone"
          defaultValue={state.timezone}
          onBlur={(event) => void saveSettings(state.day_start_hour, event.target.value)}
        />
      </Field>
      <h2>Kategorien</h2>
      <ul>
        {state.categories.map((category) => (
          <CategoryEditor
            key={category.id}
            category={category}
            onSave={(patch) => saveCategory(category.id, patch)}
            onArchive={(archived) => saveCategory(category.id, { archived })}
          />
        ))}
      </ul>
      <form
        className="category-new"
        onSubmit={(event) => {
          event.preventDefault();
          const formEl = event.currentTarget;
          const form = new FormData(formEl);
          const name = String(form.get("name") ?? "").trim();
          const color = String(form.get("color") ?? "#0A84FF");
          if (!name) return;
          void createCategory(name, color).then(() => formEl.reset());
        }}
      >
        <input name="name" aria-label="Neue Kategorie" maxLength={40} placeholder="Neue Kategorie" />
        <input name="color" type="color" aria-label="Farbe der neuen Kategorie" defaultValue="#0A84FF" />
        <button type="submit">Anlegen</button>
      </form>
      <button type="button" onClick={onLogout}>Abmelden</button>
      <p className="muted">Timeblocks {state.version}</p>
    </section>
  );
}
```

`App.tsx` vollständig ersetzen:

```tsx
// web/src/App.tsx
import { useEffect, useState } from "react";
import { api, errorMessage } from "./api/client";
import type { DayPoint, StatsPayload, SummaryPayload } from "./api/types";
import AppShell, { type Tab } from "./components/AppShell";
import { LoginView } from "./features/auth/LoginView";
import { DashboardView } from "./features/dashboard/DashboardView";
import { DayView } from "./features/day/DayView";
import { SettingsView } from "./features/settings/SettingsView";
import { useAppData } from "./hooks/useAppData";
import { useNow } from "./hooks/useNow";
import { localDateStr, shiftDate } from "./lib/time";
import { periodRange, type Period, type Range } from "./lib/ranges";
import "./styles/global.css";

export default function App() {
  const [tab, setTab] = useState<Tab>("day");
  const data = useAppData();
  const [error, setError] = useState("");
  const [period, setPeriod] = useState<Period>("week");
  const [range, setRange] = useState<Range>(() =>
    periodRange("week", localDateStr(Date.now(), "Europe/Berlin")),
  );
  const [summary, setSummary] = useState<SummaryPayload | null>(null);
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [heatmap, setHeatmap] = useState<DayPoint[]>([]);
  const now = useNow() + data.clockOffset;
  const timezone = data.state?.timezone ?? "Europe/Berlin";

  useEffect(() => {
    if (tab !== "dashboard") return;
    let cancelled = false;
    void (async () => {
      try {
        const today = localDateStr(Date.now(), timezone);
        const [summaryData, statsData, heatData] = await Promise.all([
          api.get<SummaryPayload>("/summary"),
          api.get<StatsPayload>(`/stats?from=${range.from}&to=${range.to}&group_by=category`),
          api.get<StatsPayload>(
            `/stats?from=${shiftDate(today, -364)}&to=${today}&group_by=day`,
          ),
        ]);
        if (cancelled) return;
        setSummary(summaryData);
        setStats(statsData);
        setHeatmap(heatData.days);
        setError("");
      } catch (err) {
        if (!cancelled) setError(errorMessage(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, range, timezone]);

  const choosePeriod = (next: Period, custom?: Range) => {
    const anchor = data.day?.date ?? localDateStr(Date.now(), timezone);
    setPeriod(next);
    setRange(periodRange(next, anchor, custom));
  };

  const onExport = () => {
    window.location.href = `/api/export.csv?from=${range.from}&to=${range.to}`;
  };

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
        ) : null}
        {tab === "dashboard" ? (
          summary && stats ? (
            <DashboardView
              summary={summary}
              stats={stats}
              heatmap={heatmap}
              timezone={timezone}
              period={period}
              range={range}
              onPeriod={choosePeriod}
              onExport={onExport}
              onGoDay={() => setTab("day")}
            />
          ) : (
            <p className="center">Dashboard lädt …</p>
          )
        ) : null}
        {tab === "settings" ? (
          <SettingsView
            state={data.state}
            onChanged={() => void data.reload()}
            onError={setError}
            onLogout={() => void logout()}
          />
        ) : null}
      </AppShell>
      {error ? <p role="alert" className="error-banner">{error}</p> : null}
    </>
  );
}
```

- [ ] **Step 4: Grün**

Run: `cd web && npm run test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src
git commit -m "feat(web): add settings and category detail label editing"
```

---

## Phase 4 — Auslieferung und Härtung

### Task 14: Produktions-Build, PWA und Austausch der alten UI

**Files:**
- Move: `app/static/icons` → `web/public/icons`, `app/static/manifest.webmanifest` → `web/public/manifest.webmanifest`, `app/static/sw.js` → `web/public/sw.js`
- Rewrite: `web/public/sw.js`
- Modify: `app/app.py` (nur falls Manifest/SW-Routen angepasst werden müssen)
- Generated: `app/static/index.html`, `app/static/assets/*`, `app/static/icons/*`, `app/static/manifest.webmanifest`, `app/static/sw.js`

- [ ] **Step 1: PWA-Dateien verschieben und SW neu schreiben**

```bash
mkdir -p web/public
git mv app/static/icons web/public/icons
git mv app/static/manifest.webmanifest web/public/manifest.webmanifest
git mv app/static/sw.js web/public/sw.js
```

```js
// web/public/sw.js
const CACHE = "timeblocks-v4";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(["/"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put("/", copy));
          }
          return response;
        })
        .catch(() => caches.match("/")),
    );
    return;
  }

  if (url.pathname.startsWith("/static/assets/")) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        });
      }),
    );
  }
});
```

- [ ] **Step 2: Produktions-Build**

```bash
cd web && npm run build
cd .. && ls app/static app/static/assets
```
Expected: `index.html`, `manifest.webmanifest`, `sw.js`, `icons/`, `assets/index-*.js`, `assets/index-*.css`; alte `app.js`/`styles.css` sind entfernt.

- [ ] **Step 3: Flask liefert den Build**

```bash
python3 -m pytest tests -v
python3 - <<'PY'
import os, tempfile, sys
os.environ["TIMEBLOCKS_DATA_DIR"] = tempfile.mkdtemp()
sys.path.insert(0, "app")
import app
client = app.app.test_client()
index = client.get("/")
assert index.status_code == 200 and b'id="root"' in index.data
sw = client.get("/sw.js")
assert sw.status_code == 200 and b"timeblocks-v4" in sw.data
print("static-ok")
PY
```
Expected: alle Tests grün, `static-ok`.

- [ ] **Step 4: Kein Node im Container**

```bash
rg -n "node|npm" install/timeblocks.sh systemd/timeblocks.service || true
```
Expected: keine Treffer (Doku/README ausgenommen).

- [ ] **Step 5: Commit**

```bash
git add -A app/static web/public web/package.json web/package-lock.json app/app.py
git commit -m "build(web): ship React bundle and PWA shell from app/static"
```

---

### Task 15: E2E-Tests, Dokumentation und Abschlussprüfung

**Files:**
- Create: `tests/e2e_ui.py`
- Modify: `README.md`, `docs/runbook.md`, `docs/verification.md`

- [ ] **Step 1: E2E-Skript schreiben**

```python
# tests/e2e_ui.py
"""Playwright-Smoke-Test gegen eine laufende Instanz (Standard: 127.0.0.1:8100)."""
import os
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get("TIMEBLOCKS_URL", "http://127.0.0.1:8100")
checks = 0


def check(condition, message):
    global checks
    if not condition:
        raise AssertionError(message)
    checks += 1


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 390, "height": 844})
    page.goto(BASE)
    page.wait_for_selector('[data-testid="nav-day"]')

    check(page.locator('[data-testid="day-total"]').is_visible(), "Tagessumme sichtbar")
    page.locator('[data-testid^="timer-chip-"]').first.click()
    page.wait_for_timeout(1200)
    page.locator('[data-testid^="timer-chip-"]').first.click()
    page.wait_for_timeout(400)
    check(page.locator('[data-testid^="entry-"]').count() >= 1, "Timer erzeugt Eintrag")

    page.locator('[data-testid="add-duration"]').click()
    page.wait_for_selector('[data-testid="sheet-detail"]')
    page.locator('[data-testid="sheet-save"]').click()
    page.wait_for_selector('[data-testid="sheet-save"]', state="detached")
    page.wait_for_timeout(500)
    check(page.locator('[data-testid^="entry-"]').count() >= 2, "Dauer-Eintrag erzeugt Eintrag")

    page.locator('[data-testid="bottom-dashboard"]').click()
    page.wait_for_selector('[data-testid="donut"]')
    check(page.locator('[data-testid="kpi-all"]').is_visible(), "Gesamt-KPI sichtbar")
    page.locator('[data-testid="period-month"]').click()
    page.wait_for_timeout(400)
    check(page.locator('[data-testid="trend"]').is_visible(), "Trend sichtbar")

    page.locator('[data-testid="bottom-settings"]').click()
    page.wait_for_selector('[data-testid="settings-day-start"]')
    label = page.locator('[data-testid^="detail-label-"]').last
    label.fill("Welcher Film?")
    label.blur()
    page.wait_for_timeout(300)

    page.locator('[data-testid="bottom-day"]').click()
    page.wait_for_selector('[data-testid="day-total"]')
    for width in (320, 390, 768, 1280):
        page.set_viewport_size({"width": width, "height": 844})
        page.wait_for_timeout(150)
        overflow = page.evaluate(
            "() => document.documentElement.scrollWidth > document.documentElement.clientWidth"
        )
        check(not overflow, f"kein horizontaler Überlauf bei {width}px")

    browser.close()

print(f"E2E OK ({checks} Checks)")
```

- [ ] **Step 2: E2E laufen lassen**

```bash
TIMEBLOCKS_DATA_DIR="$(mktemp -d)" PORT=8100 python3 app/app.py >/tmp/timeblocks-e2e.log 2>&1 &
SERVER_PID=$!
sleep 2
python3 tests/e2e_ui.py
kill "$SERVER_PID"
```
Expected: `E2E OK (… Checks)`.

- [ ] **Step 3: Doku aktualisieren**

`README.md`:

- Feature-Liste: Detailfeld pro Eintrag, Dashboard mit Woche/Monat/Jahr, Donut, Heatmap, Trend.
- Installationsbeispiel zeigt Hostname `zeiterfassung`.
- Hinweis: CSV-Spalte `Detail`; Seed-Kategorie `Filme` mit „Welcher Film?“.
- Entwicklung: `cd web && npm ci && npm run dev` + Flask auf 8100; `npm run build` vor Commit.

`docs/runbook.md`:

- Abschnitt „Container umbenennen": erneutes `--ctid 109` benennt `timeblocks` → `zeiterfassung`; eigenes `--hostname` bleibt geschützt.
- Frontend-Update: `timeblocks-update` nutzt den committed Build, kein Node nötig.

`docs/verification.md`:

```bash
python3 -m pytest tests -v
cd web && npm ci && npm run test && npm run typecheck && npm run build
shellcheck install/timeblocks.sh
python3 tests/e2e_ui.py
```

- [ ] **Step 4: Gesamtprüfung**

```bash
python3 -m pytest tests -v
cd web && npm run test && npm run typecheck
cd .. && shellcheck install/timeblocks.sh
```
Expected: alles grün.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e_ui.py README.md docs/runbook.md docs/verification.md
git commit -m "docs: document React dashboard, rename and verification"
```

---

## Definition of Done

- [ ] `pytest` grün inkl. neuer Migrations-, Summary-, CSV- und Detail-Tests.
- [ ] `npm run test`, `npm run typecheck`, `npm run build` grün.
- [ ] `app/static` enthält den React-Build; Flask liefert `/` und `/api/*`.
- [ ] Detailfeld mit Kategorie-Platzhalter in Tag-Ansicht und CSV.
- [ ] Dashboard zeigt Woche/Monat/Jahr/eigenen Bereich, KPIs, Donut, Top-Kategorien, Heatmap, Trend, CSV.
- [ ] Bestehende CTs mit `timeblocks` werden zu `zeiterfassung`; `--hostname` schützt Custom-Namen.
- [ ] ShellCheck sauber; E2E-Skript grün; kein horizontaler Überlauf bei 320/390/768/1280 px.
- [ ] README, Runbook und Verification aktualisiert.
