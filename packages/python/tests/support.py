"""A local HTTP server that answers from a script of responses and records every request it receives."""

from __future__ import annotations

import json
import threading
from collections.abc import Callable
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

# Built in two parts so secret scanners do not read a fake key as a real one.
TEST_API_KEY = "sk_live_" + "x" * 32


@dataclass
class Recorded:
    method: str
    path: str
    headers: dict[str, str]
    body: bytes

    def json(self) -> Any:
        return json.loads(self.body)


@dataclass
class Reply:
    """One scripted response; ``action`` replaces the normal reply when it is set, for drips, stalls and dropped connections."""

    status: int = 200
    body: Any = field(default_factory=dict)
    headers: dict[str, str] = field(default_factory=dict)
    action: Callable[[BaseHTTPRequestHandler], None] | None = None


def json_error(status: int, error_type: str, message: str = "Refused.", headers: dict[str, str] | None = None, **extra: str) -> Reply:
    return Reply(status, {"error": {"type": error_type, "message": message, **extra}}, headers or {})


class _Handler(BaseHTTPRequestHandler):
    server: ScriptedServer
    protocol_version = "HTTP/1.1"

    def _serve(self) -> None:
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else b""
        self.server.requests.append(Recorded(self.command, self.path, {k.lower(): v for k, v in self.headers.items()}, body))
        reply = self.server.next_reply()
        if reply.action is not None:
            reply.action(self)
            return
        payload = reply.body if isinstance(reply.body, bytes) else json.dumps(reply.body).encode()
        self.send_response(reply.status)
        for name, value in reply.headers.items():
            self.send_header(name, value)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(payload)

    do_GET = do_POST = do_DELETE = _serve

    def log_message(self, format: str, *args: object) -> None:
        pass


class ScriptedServer(ThreadingHTTPServer):
    """Serves on 127.0.0.1 at a free port; replies come from ``script`` in order, then ``200 {}`` once it runs out."""

    daemon_threads = True

    def __init__(self) -> None:
        super().__init__(("127.0.0.1", 0), _Handler)
        self.requests: list[Recorded] = []
        self.script: list[Reply] = []
        self._lock = threading.Lock()
        self._thread = threading.Thread(target=self.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True)

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.server_address[1]}"

    def next_reply(self) -> Reply:
        with self._lock:
            return self.script.pop(0) if self.script else Reply()

    def handle_error(self, request: object, client_address: object) -> None:
        """Clients that time out close the socket mid-reply; that is expected here and not printed."""

    def __enter__(self) -> ScriptedServer:
        self._thread.start()
        return self

    def __exit__(self, *exc: object) -> None:
        self.shutdown()
        self.server_close()


def drip_body(total_bytes: int, every_seconds: float) -> Callable[[BaseHTTPRequestHandler], None]:
    """A 200 whose headers arrive at once and whose body arrives one byte at a time."""

    def action(handler: BaseHTTPRequestHandler) -> None:
        handler.send_response(200)
        handler.send_header("Content-Type", "application/json")
        handler.send_header("Content-Length", str(total_bytes))
        handler.end_headers()
        handler.wfile.flush()
        stop = threading.Event()
        try:
            for _ in range(total_bytes):
                if stop.wait(every_seconds):
                    return
                handler.wfile.write(b" ")
                handler.wfile.flush()
        except OSError:
            return

    return action


def stall(seconds: float) -> Callable[[BaseHTTPRequestHandler], None]:
    """Sends nothing for ``seconds``, then closes the connection."""

    def action(handler: BaseHTTPRequestHandler) -> None:
        threading.Event().wait(seconds)
        handler.close_connection = True

    return action


def drop_connection(handler: BaseHTTPRequestHandler) -> None:
    """Closes the connection without sending a status line."""
    handler.close_connection = True
