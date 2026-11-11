"""Erzeugt docs/screenshot.png aus einer temporären Timeblocks-Instanz."""
from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "docs" / "screenshot.png"

PLAN = [
    ("Arbeit", "Wochenplanung", 9, 0, 90),
    ("Projekt", "React Dashboard", 10, 45, 75),
    ("Meeting", "Daily mit Team", 13, 0, 60),
    ("Fokus", "E2E-Tests härten", 14, 30, 90),
]


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def api(base: str, path: str, payload: dict | None = None):
    data = None
    headers = {}
    method = "GET"
    if payload is not None:
        data = json.dumps(payload).encode()
        headers["Content-Type"] = "application/json"
        method = "POST"
    request = urllib.request.Request(base + path, data=data, headers=headers, method=method)
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.load(response)


def wait_ready(base: str, timeout: float = 20.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            api(base, "/api/health")
            return
        except (urllib.error.URLError, ConnectionError, TimeoutError):
            time.sleep(0.1)
    raise RuntimeError("Timeblocks ist nicht rechtzeitig gestartet")


def seed(base: str) -> None:
    state = api(base, "/api/state")
    categories = {category["name"]: category["id"] for category in state["categories"]}
    timezone = ZoneInfo(state["timezone"])
    today = datetime.now(timezone).date()
    for name, note, hour, minute, duration in PLAN:
        started = datetime(today.year, today.month, today.day, hour, minute, tzinfo=timezone)
        ended = started + timedelta(minutes=duration)
        api(
            base,
            "/api/entries",
            {
                "category_id": categories[name],
                "started_at": int(started.timestamp() * 1000),
                "ended_at": int(ended.timestamp() * 1000),
                "note": note,
            },
        )


def main() -> None:
    port = free_port()
    base = f"http://127.0.0.1:{port}"
    with tempfile.TemporaryDirectory(prefix="timeblocks-shot-") as data_dir:
        env = os.environ.copy()
        env["TIMEBLOCKS_DATA_DIR"] = data_dir
        env["PORT"] = str(port)
        server = subprocess.Popen(
            [sys.executable, "app/app.py"],
            cwd=ROOT,
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        try:
            wait_ready(base)
            seed(base)
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch()
                try:
                    context = browser.new_context(viewport={"width": 1280, "height": 800})
                    page = context.new_page()
                    page.goto(base, wait_until="networkidle")
                    page.wait_for_selector('[data-testid="nav-day"]')
                    page.wait_for_function(
                        "(n) => document.querySelectorAll('[data-testid^=\"entry-\"]').length >= n",
                        arg=len(PLAN),
                    )
                    page.screenshot(path=str(OUTPUT), full_page=True)
                    context.close()
                finally:
                    browser.close()
        finally:
            server.terminate()
            try:
                server.wait(timeout=10)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait()


if __name__ == "__main__":
    main()
    print(f"Screenshot geschrieben: {OUTPUT}")
