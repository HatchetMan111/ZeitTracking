"""SQLite storage for Timeblocks."""
from __future__ import annotations

import os
import secrets
import sqlite3
import time
from pathlib import Path

DATA_DIR = Path(os.environ.get("TIMEBLOCKS_DATA_DIR", "/var/lib/timeblocks"))
DB_PATH = DATA_DIR / "timeblocks.db"
SECRET_PATH = DATA_DIR / "secret.key"

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


def now_ms() -> int:
    from timeutil import now_ms as _now_ms

    return _now_ms()


def connect() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=8000")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


def load_or_create_secret() -> str:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    try:
        return SECRET_PATH.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        pass
    candidate = secrets.token_hex(32)
    try:
        fd = os.open(SECRET_PATH, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        for _ in range(100):
            value = SECRET_PATH.read_text(encoding="utf-8").strip() if SECRET_PATH.exists() else ""
            if value:
                return value
            time.sleep(0.02)
        raise RuntimeError(f"Secret-Datei {SECRET_PATH} konnte nicht gelesen werden")
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(candidate)
    return candidate


def _default_timezone() -> str:
    env_tz = os.environ.get("TZ")
    if env_tz:
        return env_tz
    try:
        name = Path("/etc/timezone").read_text(encoding="utf-8").strip()
        if name:
            return name
    except OSError:
        pass
    return "Europe/Berlin"


def init_db() -> None:
    conn = connect()
    try:
        conn.executescript(SCHEMA)
        row = conn.execute("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1").fetchone()
        if row is None:
            conn.execute(
                "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
                (SCHEMA_VERSION, now_ms()),
            )

        state = conn.execute("SELECT id FROM app_state WHERE id = 1").fetchone()
        if state is None:
            stamp = now_ms()
            conn.execute(
                "INSERT INTO app_state (id, running_entry_id, day_start_hour, timezone, created_at, updated_at)"
                " VALUES (1, NULL, 0, ?, ?, ?)",
                (_default_timezone(), stamp, stamp),
            )

        count = conn.execute("SELECT COUNT(*) AS n FROM categories").fetchone()["n"]
        if count == 0:
            stamp = now_ms()
            for index, (name, color, icon, goal, detail_label) in enumerate(DEFAULT_CATEGORIES):
                conn.execute(
                    "INSERT INTO categories"
                    " (name, color, icon, parent_id, goal_minutes_week, detail_label, sort_order, archived, created_at)"
                    " VALUES (?, ?, ?, NULL, ?, ?, ?, 0, ?)",
                    (name, color, icon, goal, detail_label, index, stamp),
                )
        migrate_schema(conn)
        conn.commit()
        ensure_consistency(conn)
    finally:
        conn.close()


def ensure_consistency(conn: sqlite3.Connection) -> None:
    stamp = now_ms()
    running = conn.execute(
        "SELECT id FROM entries WHERE kind = 'timeline' AND ended_at IS NULL ORDER BY started_at DESC"
    ).fetchall()
    if len(running) > 1:
        for row in running[1:]:
            conn.execute(
                "UPDATE entries SET ended_at = MAX(started_at + 60000, ?), updated_at = ? WHERE id = ?",
                (stamp, stamp, row["id"]),
            )
    current_id = running[0]["id"] if running else None
    conn.execute(
        "UPDATE app_state SET running_entry_id = ?, updated_at = ? WHERE id = 1",
        (current_id, stamp),
    )
    conn.commit()
