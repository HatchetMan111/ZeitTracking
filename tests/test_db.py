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
