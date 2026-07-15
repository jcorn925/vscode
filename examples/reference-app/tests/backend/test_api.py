"""Tests for the Task Tracker reference app backend.

Introduced at checkpoint 006 (specs/006-reference-app-test-suite.md).
Exercises models.py/api.py directly (no live HTTP server needed).
"""

import sys
from http.server import HTTPServer
from pathlib import Path
from threading import Thread
from urllib.request import urlopen

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from backend.api import build_handler  # noqa: E402
from backend.models import TaskStore  # noqa: E402


def test_task_store_add_and_list():
    store = TaskStore()
    store.add("write specs")
    store.add("build verifier")

    titles = [task.title for task in store.list()]

    assert titles == ["write specs", "build verifier"]


def test_task_store_complete():
    store = TaskStore()
    task = store.add("write specs")

    store.complete(task.id)

    assert store.list()[0].done is True


def test_api_list_tasks_over_http():
    store = TaskStore()
    store.add("write specs")
    handler_cls = build_handler(store)
    server = HTTPServer(("127.0.0.1", 0), handler_cls)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        host, port = server.server_address
        with urlopen(f"http://{host}:{port}/api/tasks") as response:
            assert response.status == 200
            assert b"write specs" in response.read()
    finally:
        server.shutdown()
        thread.join(timeout=5)


def test_frontend_is_served_from_same_origin():
    handler_cls = build_handler(TaskStore())
    server = HTTPServer(("127.0.0.1", 0), handler_cls)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        host, port = server.server_address
        with urlopen(f"http://{host}:{port}/") as response:
            assert response.status == 200
            assert response.headers["Content-Type"].startswith("text/html")
            assert b"task-form" in response.read()
        for path in ("/app.js", "/api-client.cjs"):
            with urlopen(f"http://{host}:{port}{path}") as response:
                assert response.status == 200
                assert response.headers["Content-Type"].startswith("text/javascript")
    finally:
        server.shutdown()
        thread.join(timeout=5)
