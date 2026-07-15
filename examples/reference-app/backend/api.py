"""HTTP request handling for the Task Tracker reference app.

Kept intentionally framework-free (stdlib http.server) so the reference app
has no external runtime dependencies.
"""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from typing import Type

from .models import TaskStore

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"

# Allowlist, not a filesystem walk: the frontend is exactly three files, and
# serving only known paths avoids any traversal concerns without needing a
# full static-file framework. api-client.cjs uses same-origin relative
# fetches, so the UI must be served from this process to work at all.
STATIC_ROUTES: dict[str, tuple[str, str]] = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/api-client.cjs": ("api-client.cjs", "text/javascript; charset=utf-8"),
}


def build_handler(store: TaskStore) -> Type[BaseHTTPRequestHandler]:
    """Build a BaseHTTPRequestHandler bound to the given TaskStore."""

    class TaskHandler(BaseHTTPRequestHandler):
        def _send_json(self, payload, status: int = 200) -> None:
            body = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _send_static(self, filename: str, content_type: str) -> None:
            try:
                body = (FRONTEND_DIR / filename).read_bytes()
            except OSError:
                self._send_json({"error": "not found"}, status=404)
                return
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:  # noqa: N802 (stdlib naming convention)
            if self.path == "/api/tasks":
                self._send_json([t.to_dict() for t in store.list()])
            elif self.path in STATIC_ROUTES:
                filename, content_type = STATIC_ROUTES[self.path]
                self._send_static(filename, content_type)
            else:
                self._send_json({"error": "not found"}, status=404)

        def do_POST(self) -> None:  # noqa: N802
            if self.path == "/api/tasks":
                length = int(self.headers.get("Content-Length", 0))
                data = json.loads(self.rfile.read(length) or b"{}")
                task = store.add(data.get("title", "untitled"))
                self._send_json(task.to_dict(), status=201)
            else:
                self._send_json({"error": "not found"}, status=404)

        def log_message(self, format: str, *args) -> None:  # noqa: A002
            # Silence default stderr logging; the reference app does not
            # need request logs for scaffold-verification purposes.
            pass

    return TaskHandler
