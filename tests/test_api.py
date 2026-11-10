import pytest

import api
import timeutil
from conftest import day_payload


def category_id(client, name="Projekt"):
    cats = client.get("/api/state").get_json()["categories"]
    return next(cat["id"] for cat in cats if cat["name"] == name)


def test_health(client):
    payload = client.get("/api/health").get_json()
    assert payload["status"] == "ok"
    assert payload["app"] == "timeblocks"


def test_default_categories_seeded(client):
    cats = client.get("/api/state").get_json()["categories"]
    assert len(cats) >= 6
    assert all(cat["color"].startswith("#") for cat in cats)


def test_start_stop_timer(client):
    cat = category_id(client)
    started = client.post(f"/api/timers/{cat}/start").get_json()
    assert started["action"] == "started"
    assert started["entry"]["ended_at"] is None

    state = client.get("/api/state").get_json()
    assert state["running_entry"]["category_id"] == cat

    stopped = client.post("/api/timers/stop").get_json()
    assert stopped["action"] == "stopped"
    assert client.get("/api/state").get_json()["running_entry"] is None


def test_switching_timer_keeps_only_one_running(client):
    first = category_id(client, "Arbeit")
    second = category_id(client, "Meeting")

    client.post(f"/api/timers/{first}/start")
    switched = client.post(f"/api/timers/{second}/start").get_json()
    assert switched["action"] == "started"
    assert switched["stopped_id"] is not None

    day = day_payload(client)
    timeline = [entry for entry in day["entries"] if entry["kind"] == "timeline"]
    assert len(timeline) == 2
    assert sum(1 for entry in timeline if entry["ended_at"] is None) == 1

    client.post("/api/timers/stop")


def test_tapping_running_timer_stops_it(client):
    cat = category_id(client)
    client.post(f"/api/timers/{cat}/start")
    result = client.post(f"/api/timers/{cat}/start").get_json()
    assert result["action"] == "stopped"
    assert result["stopped_id"] is not None


def test_create_timeline_entry_and_day_totals(client):
    cat = category_id(client)
    day = day_payload(client)
    start = day["start_ms"] + 8 * 3600000
    end = start + 90 * 60000

    response = client.post(
        "/api/entries",
        json={"category_id": cat, "started_at": start, "ended_at": end, "note": "Deep Work"},
    )
    assert response.status_code == 201

    day = day_payload(client)
    assert day["total_minutes"] == 90
    assert any(entry["note"] == "Deep Work" for entry in day["entries"])


def test_create_entry_rejects_invalid_range(client):
    cat = category_id(client)
    day = day_payload(client)
    response = client.post(
        "/api/entries",
        json={"category_id": cat, "started_at": day["start_ms"] + 3600000, "ended_at": day["start_ms"]},
    )
    assert response.status_code == 400
    assert "Ende" in response.get_json()["error"]


def test_create_entry_unknown_category(client):
    response = client.post(
        "/api/entries",
        json={"category_id": 9999, "started_at": 1794300000000, "ended_at": 1794303600000},
    )
    assert response.status_code == 404


def test_duration_entry_counts_towards_day(client):
    cat = category_id(client, "Fokus")
    day = day_payload(client)
    response = client.post(
        "/api/entries/duration",
        json={"category_id": cat, "date": day["date"], "minutes": 45, "note": "Review"},
    )
    assert response.status_code == 201
    entry = response.get_json()["entry"]
    assert entry["kind"] == "duration"
    assert entry["minutes"] == 45

    day = day_payload(client)
    assert day["total_minutes"] == 45
    assert any(item["kind"] == "duration" for item in day["entries"])


def test_duration_entry_validation(client):
    cat = category_id(client)
    day = day_payload(client)
    assert (
        client.post(
            "/api/entries/duration",
            json={"category_id": cat, "date": day["date"], "minutes": 0},
        ).status_code
        == 400
    )
    assert (
        client.post(
            "/api/entries/duration",
            json={"category_id": cat, "date": "10.11.2026", "minutes": 30},
        ).status_code
        == 400
    )


def test_patch_entry_times(client):
    cat = category_id(client)
    day = day_payload(client)
    start = day["start_ms"] + 9 * 3600000
    entry_id = client.post(
        "/api/entries",
        json={"category_id": cat, "started_at": start, "ended_at": start + 3600000},
    ).get_json()["entry"]["id"]

    response = client.patch(f"/api/entries/{entry_id}", json={"ended_at": start + 5400000})
    assert response.status_code == 200
    assert response.get_json()["entry"]["ended_at"] == start + 5400000
    assert day_payload(client)["total_minutes"] == 90


def test_delete_entry(client):
    cat = category_id(client)
    day = day_payload(client)
    entry_id = client.post(
        "/api/entries",
        json={
            "category_id": cat,
            "started_at": day["start_ms"] + 3600000,
            "ended_at": day["start_ms"] + 7200000,
        },
    ).get_json()["entry"]["id"]
    assert client.delete(f"/api/entries/{entry_id}").status_code == 200
    assert day_payload(client)["total_minutes"] == 0


def test_delete_running_entry_clears_state(client):
    cat = category_id(client)
    entry_id = client.post(f"/api/timers/{cat}/start").get_json()["entry"]["id"]
    assert client.delete(f"/api/entries/{entry_id}").status_code == 200
    assert client.get("/api/state").get_json()["running_entry"] is None


def test_stats_grouped_by_category(client):
    cat = category_id(client, "Arbeit")
    day = day_payload(client)
    start = day["start_ms"] + 8 * 3600000
    client.post(
        "/api/entries",
        json={"category_id": cat, "started_at": start, "ended_at": start + 2 * 3600000},
    )
    payload = client.get(f"/api/stats?from={day['date']}&to={day['date']}").get_json()
    assert payload["total_minutes"] == 120
    assert payload["rows"][0]["minutes"] == 120
    assert payload["rows"][0]["label"] == "Arbeit"
    assert len(payload["days"]) == 1


def test_csv_export(client):
    cat = category_id(client)
    day = day_payload(client)
    start = day["start_ms"] + 8 * 3600000
    client.post(
        "/api/entries",
        json={"category_id": cat, "started_at": start, "ended_at": start + 3600000, "note": "CSV Test"},
    )
    response = client.get(f"/api/export.csv?from={day['date']}&to={day['date']}")
    assert response.status_code == 200
    assert response.data.startswith("\ufeff".encode("utf-8"))
    text = response.data.decode("utf-8-sig")
    assert "Datum;Kategorie;Start;Ende" in text
    assert "CSV Test" in text


def test_settings_validation_and_update(client):
    assert client.put("/api/settings", json={"day_start_hour": 25}).status_code == 400
    assert client.put("/api/settings", json={"timezone": "Nirgendwo/Nowhere"}).status_code == 400
    assert client.put("/api/settings", json={"day_start_hour": 4}).status_code == 200
    assert client.get("/api/state").get_json()["day_start_hour"] == 4


def test_category_crud_and_archive(client):
    created = client.post("/api/categories", json={"name": "Test", "color": "#123456"}).get_json()
    cat_id = created["category"]["id"]
    assert client.patch(f"/api/categories/{cat_id}", json={"name": "Test 2"}).status_code == 200
    assert client.delete(f"/api/categories/{cat_id}").status_code == 200
    names = [cat["name"] for cat in client.get("/api/state").get_json()["categories"]]
    assert "Test 2" not in names


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

    listed_api = client.get("/api/categories").get_json()["categories"]
    assert next(item for item in listed_api if item["id"] == cat["id"])["detail_label"] == "Welche Serie?"

    assert client.patch(
        f"/api/categories/{cat['id']}", json={"detail_label": "x" * 61}
    ).status_code == 400

    updated = client.patch(
        f"/api/categories/{cat['id']}", json={"detail_label": "  Welche Staffel?  "}
    ).get_json()["category"]
    assert updated["detail_label"] == "Welche Staffel?"
    listed_after = client.get("/api/state").get_json()["categories"]
    assert next(item for item in listed_after if item["id"] == cat["id"])["detail_label"] == "Welche Staffel?"

    boundary = client.patch(
        f"/api/categories/{cat['id']}", json={"detail_label": "y" * 60}
    ).get_json()["category"]
    assert boundary["detail_label"] == "y" * 60

    cleared = client.patch(
        f"/api/categories/{cat['id']}", json={"detail_label": "   "}
    ).get_json()["category"]
    assert cleared["detail_label"] == ""


def test_auth_guard(client, monkeypatch):
    monkeypatch.setattr(api, "PASSWORD", "geheim")

    assert client.get("/api/state").status_code == 401
    assert client.post("/api/login", json={"password": "falsch"}).status_code == 401
    assert client.post("/api/login", json={"password": "geheim"}).status_code == 200
    assert client.get("/api/state").status_code == 200
    assert client.post("/api/logout").status_code == 200
    assert client.get("/api/state").status_code == 401


def test_requires_json_body(client):
    response = client.post("/api/entries", data="not json", content_type="text/plain")
    assert response.status_code == 400


def test_csv_escapes_formula_injection(client):
    day = client.get("/api/day").get_json()
    cat = client.get("/api/state").get_json()["categories"][0]["id"]
    start = day["start_ms"] + 8 * 3600 * 1000
    client.post(
        "/api/entries",
        json={
            "category_id": cat,
            "started_at": start,
            "ended_at": start + 1800000,
            "note": "=HYPERLINK(\"http://example.invalid\")",
        },
    )
    text = client.get(f"/api/export.csv?from={day['date']}&to={day['date']}").data.decode("utf-8-sig")
    assert "'=HYPERLINK" in text


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
    end = timeutil.parse_ts("2026-03-29T04:00", "Europe/Berlin")
    client.post(
        "/api/entries",
        json={"category_id": cat, "started_at": start, "ended_at": end},
    )
    payload = client.get("/api/summary").get_json()
    assert payload["totals"]["all_minutes"] == 300
    assert payload["totals"]["today_minutes"] == 0
