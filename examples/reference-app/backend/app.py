"""Entry point for the Task Tracker reference app.

Serves both the JSON API (/api/tasks) and the frontend UI (/) from one
origin, which the relative fetches in frontend/api-client.cjs require.

Run as a package (relative imports don't work as a plain script):

    cd examples/reference-app && python3 -m backend.app

Then open http://127.0.0.1:8765/ to preview the app.
"""

from __future__ import annotations

from http.server import HTTPServer

from .agent import run_digest
from .api import build_handler
from .models import TaskStore


def create_server(host: str = "127.0.0.1", port: int = 8765) -> HTTPServer:
    store = TaskStore()
    handler_cls = build_handler(store)
    return HTTPServer((host, port), handler_cls)


def main() -> None:
    server = create_server()
    print(f"Task Tracker reference app listening on http://{server.server_address[0]}:{server.server_address[1]}")
    print(run_digest([]))
    server.serve_forever()


if __name__ == "__main__":
    main()
