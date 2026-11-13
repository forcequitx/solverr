from __future__ import annotations

import http.client
import json
import random
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from collections.abc import Mapping
from email.message import Message
from typing import Any, Literal

from ._config import (
    MAX_RETRIES,
    MAX_RETRY_AFTER_RETRIES,
    MAX_RETRY_AFTER_SECONDS,
    READ_CHUNK_BYTES,
    REQUEST_TIMEOUT_SECONDS,
    RETRY_BASE_DELAY_SECONDS,
    SDK_VERSION,
)
from ._errors import SolverrError

Method = Literal["GET", "POST", "DELETE"]

# Characters http.client cannot send in a header value; such a key fails before any request is sent.
_INVALID_HEADER_VALUE = re.compile(r"[\x00\r\n]|[^\x00-\xff]")


class _RejectRedirects(urllib.request.HTTPRedirectHandler):
    """Returns a 3xx response as an error instead of following it, so credentials never move to another URL."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[no-untyped-def]
        return None


def _retry_delay(attempt: int) -> float:
    """Exponential backoff with up to 25% random jitter."""
    return RETRY_BASE_DELAY_SECONDS * 2.0**attempt * (1 + random.random() / 4)


def path_segment(value: str) -> str:
    """An id as one URL path segment; empty, ``.`` and ``..`` are refused because they would point at another path."""
    if value in ("", ".", ".."):
        raise ValueError(f"{value!r} is not a valid id.")
    return urllib.parse.quote(value, safe="")


def _read_body(response: Any, deadline: float) -> bytes:
    """Reads the response body piece by piece and gives up with ``TimeoutError`` once ``deadline`` has passed."""
    chunks: list[bytes] = []
    while True:
        if time.monotonic() > deadline:
            raise TimeoutError(f"no complete response within {REQUEST_TIMEOUT_SECONDS:g} seconds")
        chunk = response.read1(READ_CHUNK_BYTES)
        if not chunk:
            return b"".join(chunks)
        chunks.append(chunk)


def _parse_json(text: bytes) -> Any:
    if not text:
        return None
    try:
        return json.loads(text)
    except ValueError:
        return None


def _retry_after_seconds(value: str | None) -> int | None:
    """``Retry-After`` in seconds; only the delay-seconds form is read, as the API never sends an HTTP date."""
    return int(value) if value is not None and value.isascii() and value.isdigit() else None


def _to_api_error(status: int, payload: Any, retry_after: str | None) -> SolverrError:
    seconds = _retry_after_seconds(retry_after)
    error = payload.get("error") if isinstance(payload, dict) else None
    if isinstance(error, dict) and isinstance(error.get("type"), str) and isinstance(error.get("message"), str):
        param, code = error.get("param"), error.get("code")
        return SolverrError(
            status,
            error["type"],
            error["message"],
            param if isinstance(param, str) else None,
            code if isinstance(code, str) else None,
            seconds,
        )
    return SolverrError(status, "api_error", f"Solverr returned HTTP {status}.", retry_after=seconds)


def _retry_after_delay(status: int, retry_after: str | None, payload: Any) -> float | None:
    """Seconds to wait before retrying a 429 or an in-progress Idempotency-Key 409; None when it must not be retried."""
    error = payload.get("error") if isinstance(payload, dict) else None
    error_type = error.get("type") if isinstance(error, dict) else None
    retryable = status == 429 or (status == 409 and error_type == "idempotency_conflict")
    seconds = _retry_after_seconds(retry_after)
    if not retryable or seconds is None:
        return None
    return float(seconds) if seconds <= MAX_RETRY_AFTER_SECONDS else None


class HttpClient:
    """Sends authenticated JSON requests, retrying network errors and 5xx responses, and 429s or in-progress 409s after a short ``Retry-After``."""

    def __init__(self, api_key: str, base_url: str) -> None:
        self._api_key = api_key
        self._base_url = base_url
        self._opener = urllib.request.build_opener(_RejectRedirects)

    def request(
        self,
        method: Method,
        path: str,
        *,
        query: Mapping[str, str | int | None] | None = None,
        body: Mapping[str, Any] | None = None,
        idempotency_key: str | None = None,
    ) -> Any:
        url = self._url(path, query or {})
        headers = {
            "Accept": "application/json",
            "Authorization": f"Bearer {self._api_key}",
            "User-Agent": f"solverr-python/{SDK_VERSION}",
        }
        payload: bytes | None = None
        if method == "POST":
            # The same key is sent on every retry, so the server never applies a POST twice.
            headers["Idempotency-Key"] = idempotency_key if idempotency_key is not None else str(uuid.uuid4())
            if _INVALID_HEADER_VALUE.search(headers["Idempotency-Key"]):
                raise ValueError("idempotency_key cannot contain line breaks, NUL or characters above U+00FF.")
            if body is not None:
                # Fields set to None are left out, because the API refuses null in place of an omitted optional field.
                fields = {name: value for name, value in body.items() if value is not None}
                headers["Content-Type"] = "application/json"
                payload = json.dumps(fields, separators=(",", ":"), ensure_ascii=False).encode("utf-8")

        attempt = 0
        retry_after_retries = 0
        while True:
            can_retry = attempt < MAX_RETRIES
            try:
                status, response_headers, text = self._send(urllib.request.Request(url, data=payload, headers=headers, method=method))
            except (urllib.error.URLError, http.client.HTTPException, OSError) as error:
                if can_retry:
                    time.sleep(_retry_delay(attempt))
                    attempt += 1
                    continue
                reason = getattr(error, "reason", error)
                raise SolverrError(0, "connection_error", f"Could not reach Solverr at {self._base_url}: {reason}") from error

            if 300 <= status < 400:
                location = response_headers.get("Location")
                target = f" to {location}" if location else ""
                raise SolverrError(
                    status, "api_error", f"Solverr answered with a redirect{target}. Set base_url to the address Solverr is served from."
                )
            if status >= 500 and can_retry:
                time.sleep(_retry_delay(attempt))
                attempt += 1
                continue
            parsed = _parse_json(text)
            retry_after = response_headers.get("Retry-After")
            delay = _retry_after_delay(status, retry_after, parsed) if retry_after_retries < MAX_RETRY_AFTER_RETRIES else None
            if delay is not None:
                time.sleep(delay)
                retry_after_retries += 1
                continue
            if status < 200 or status >= 300:
                raise _to_api_error(status, parsed, retry_after)
            if parsed is None:
                raise SolverrError(status, "api_error", "Solverr returned a response that is not JSON.")
            return parsed

    def _send(self, request: urllib.request.Request) -> tuple[int, Message, bytes]:
        """One HTTP attempt; returns the status, headers and body for every response, including 3xx, 4xx and 5xx.

        ``REQUEST_TIMEOUT_SECONDS`` is the socket timeout, and the body read stops at that deadline, so a body sent a byte at a time cannot hold the call open."""
        deadline = time.monotonic() + REQUEST_TIMEOUT_SECONDS
        try:
            with self._opener.open(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
                return response.status, response.headers, _read_body(response, deadline)
        except urllib.error.HTTPError as error:
            with error:
                return error.code, error.headers, _read_body(error, deadline)

    def _url(self, path: str, query: Mapping[str, str | int | None]) -> str:
        url = self._base_url + path
        params = {name: str(value) for name, value in query.items() if value is not None}
        return f"{url}?{urllib.parse.urlencode(params, quote_via=urllib.parse.quote)}" if params else url
