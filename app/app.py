"""Timeblocks – self-hosted time tracking (Flask entrypoint)."""
from __future__ import annotations

import os
import sys
from datetime import timedelta
from pathlib import Path

from flask import Flask, Response, jsonify, request, send_from_directory

BASE_DIR = Path(__file__).resolve().parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

import api  # noqa: E402
import db  # noqa: E402


def create_app() -> Flask:
    db.init_db()
    app = Flask(
        __name__,
        static_folder=str(BASE_DIR / "static"),
        static_url_path="/static",
    )
    app.secret_key = db.load_or_create_secret()
    app.permanent_session_lifetime = timedelta(days=30)
    app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 3600
    app.config["JSON_SORT_KEYS"] = False
    app.register_blueprint(api.bp, url_prefix="/api")

    @app.get("/")
    def index():
        return send_from_directory(app.static_folder, "index.html", max_age=0)

    @app.get("/manifest.webmanifest")
    def manifest():
        return send_from_directory(
            app.static_folder, "manifest.webmanifest", mimetype="application/manifest+json"
        )

    @app.get("/sw.js")
    def service_worker():
        response = send_from_directory(
            app.static_folder, "sw.js", mimetype="application/javascript", max_age=0
        )
        response.headers["Service-Worker-Allowed"] = "/"
        response.headers["Cache-Control"] = "no-cache"
        return response

    @app.get("/favicon.ico")
    def favicon():
        return send_from_directory(app.static_folder, "icons/icon.svg", mimetype="image/svg+xml")

    @app.errorhandler(404)
    def not_found(_error):
        if request.path.startswith("/api/"):
            return (
                jsonify({"error": "Nicht gefunden"}),
                404,
                {"Cache-Control": "no-store"},
            )
        if request.path == "/static" or request.path.startswith("/static/"):
            return (
                jsonify({"error": "Nicht gefunden"}),
                404,
                {"Cache-Control": "no-cache"},
            )
        return send_from_directory(app.static_folder, "index.html", max_age=0)

    @app.after_request
    def security_headers(response: Response):
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "same-origin")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
            "script-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'",
        )
        if request.path.startswith("/api/"):
            response.headers.setdefault("Cache-Control", "no-store")
        elif request.path.startswith("/static/assets/") and response.status_code < 400:
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response

    return app


app = create_app()


if __name__ == "__main__":
    app.run(
        host=os.environ.get("HOST", "127.0.0.1"),
        port=int(os.environ.get("PORT", "5000")),
        debug=os.environ.get("DEBUG") == "1",
    )
