"""Playwright-Smoke-Test gegen eine laufende Instanz (Standard: 127.0.0.1:8100)."""
import os
import sys
import time

from playwright.sync_api import sync_playwright

BASE = os.environ.get("TIMEBLOCKS_URL", "http://127.0.0.1:8100")
checks = 0
errors = []


def check(condition, message):
    global checks
    if not condition:
        raise AssertionError(message)
    checks += 1


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 390, "height": 844})
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(BASE, wait_until="domcontentloaded")

            def click_tab(tab):
                bottom = page.locator(f'[data-testid="bottom-{tab}"]')
                if bottom.is_visible():
                    bottom.click()
                else:
                    page.locator(f'[data-testid="nav-{tab}"]').click()

            def wait_tab_ready(tab):
                if tab == "day":
                    page.wait_for_selector('[data-testid="day-total"]')
                elif tab == "dashboard":
                    page.wait_for_selector('[data-testid="donut"]')
                else:
                    page.wait_for_selector('[data-testid="settings-day-start"]')

            def wait_entries(count):
                page.wait_for_function(
                    "(n) => document.querySelectorAll('[data-testid^=\"entry-\"]').length >= n",
                    arg=count,
                )

            def no_overflow(width, tab):
                page.set_viewport_size({"width": width, "height": 844})
                page.wait_for_timeout(150)
                click_tab(tab)
                wait_tab_ready(tab)
                page.wait_for_timeout(150)
                overflow = page.evaluate(
                    "() => document.documentElement.scrollWidth > "
                    "document.documentElement.clientWidth"
                )
                check(not overflow, f"kein horizontaler Überlauf bei {width}px ({tab})")

            wait_tab_ready("day")
            check(page.locator('[data-testid="day-total"]').is_visible(), "Tagessumme sichtbar")

            page.locator('[data-testid^="timer-chip-"]').first.click()
            page.wait_for_timeout(1200)
            page.locator('[data-testid^="timer-chip-"]').first.click()
            wait_entries(1)
            check(page.locator('[data-testid^="entry-"]').count() >= 1, "Timer erzeugt Eintrag")

            page.locator('[data-testid="add-duration"]').click()
            page.wait_for_selector('[data-testid="sheet-detail"]')
            page.locator('[data-testid="sheet-save"]').click()
            page.wait_for_selector('[data-testid="sheet-save"]', state="detached")
            wait_entries(2)
            check(
                page.locator('[data-testid^="entry-"]').count() >= 2,
                "Dauer-Eintrag erzeugt Eintrag",
            )

            click_tab("dashboard")
            page.wait_for_selector('[data-testid="donut"]')
            check(page.locator('[data-testid="kpi-all"]').is_visible(), "Gesamt-KPI sichtbar")
            page.locator('[data-testid="period-month"]').click()
            page.wait_for_selector('[data-testid="donut"]')
            check(page.locator('[data-testid="trend"]').is_visible(), "Trend sichtbar")
            check(page.locator('[data-testid="heatmap"]').is_visible(), "Heatmap sichtbar")
            check(page.locator('[data-testid="day-table"]').is_visible(), "Tagestabelle sichtbar")

            click_tab("settings")
            page.wait_for_selector('[data-testid="settings-day-start"]')
            label = page.locator('[data-testid^="detail-label-"]').last
            unique = f"E2E Detail {int(time.time())}"
            with page.expect_response(
                lambda response: response.request.method == "PATCH"
                and "/api/categories/" in response.url,
                timeout=15000,
            ) as response_info:
                label.fill(unique)
                page.keyboard.press("Tab")
            check(response_info.value.ok, "Detail-Label PATCH erfolgreich")
            page.wait_for_timeout(400)
            check(label.input_value() == unique, "Detail-Label gespeichert")

            for width in (320, 390, 768, 1280):
                for tab in ("day", "dashboard", "settings"):
                    no_overflow(width, tab)

            check(not errors, "keine JavaScript-Fehler: " + "; ".join(errors))
        finally:
            browser.close()


try:
    main()
except Exception as exc:
    print(f"E2E FAILED: {exc}", file=sys.stderr)
    if errors:
        print("JavaScript-Fehler:", file=sys.stderr)
        for error in errors:
            print(f"  - {error}", file=sys.stderr)
    raise

print(f"E2E OK ({checks} Checks)")
