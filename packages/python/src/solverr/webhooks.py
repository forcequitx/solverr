"""Verification of the signed webhook events Solverr sends to a business's endpoint."""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import re
import time
from collections.abc import Iterable
from typing import Protocol, cast

from ._config import (
    WEBHOOK_ID_HEADER,
    WEBHOOK_SECRET_MIN_BYTES,
    WEBHOOK_SECRET_PREFIX,
    WEBHOOK_SIGNATURE_HEADER,
    WEBHOOK_TIMESTAMP_HEADER,
    WEBHOOK_TOLERANCE_SECONDS,
)
from ._errors import WebhookVerificationError
from .types import WebhookEvent

__all__ = ["WebhookHeaders", "WebhookVerificationError", "verify"]

_TIMESTAMP_PATTERN = re.compile(r"[0-9]{1,12}")
_SIGNATURE_VERSION = "v1,"


class WebhookHeaders(Protocol):
    """Request headers: a dict or any framework header object with ``items()`` (Flask, Django, Starlette)."""

    def items(self) -> Iterable[tuple[str, object]]: ...


def _read_header(headers: WebhookHeaders, name: str) -> str | None:
    """Finds a header by name with any key casing; a list value counts only when it holds exactly one string."""
    for key, value in headers.items():
        if key.lower() != name:
            continue
        if isinstance(value, (list, tuple)) and len(value) == 1:
            value = value[0]
        return value if isinstance(value, str) else None
    return None


def _secret_key(secret: str) -> bytes:
    """The HMAC key of a ``whsec_`` secret: the base64 after the prefix, decoded, and long enough to be a real secret."""
    encoded = secret[len(WEBHOOK_SECRET_PREFIX) :]
    try:
        key = base64.b64decode(encoded + "=" * (-len(encoded) % 4), validate=True)
    except binascii.Error:
        key = b""
    if len(key) < WEBHOOK_SECRET_MIN_BYTES:
        raise WebhookVerificationError(
            f"The webhook secret must be whsec_ followed by at least {WEBHOOK_SECRET_MIN_BYTES} bytes in standard base64."
        )
    return key


def verify(
    raw_body: bytes | str,
    headers: WebhookHeaders,
    secret: str,
    tolerance: int = WEBHOOK_TOLERANCE_SECONDS,
) -> WebhookEvent:
    """Checks the Standard Webhooks signature (any ``v1`` entry, so secret rotations verify) and timestamp age; returns the event.

    Pass the raw body exactly as received; ``tolerance`` is the allowed clock gap in seconds. Raises ``WebhookVerificationError``."""
    if not isinstance(tolerance, int) or tolerance < 0:
        raise WebhookVerificationError("tolerance must be a whole number of seconds, 0 or more.")
    if not isinstance(secret, str) or not secret.startswith(WEBHOOK_SECRET_PREFIX):
        raise WebhookVerificationError("The webhook secret must start with whsec_.")
    key = _secret_key(secret)
    if not isinstance(raw_body, (bytes, bytearray, memoryview, str)):
        raise WebhookVerificationError("Pass the raw request body as bytes or str, not parsed JSON.")

    message_id = _read_header(headers, WEBHOOK_ID_HEADER)
    timestamp = _read_header(headers, WEBHOOK_TIMESTAMP_HEADER)
    signatures = _read_header(headers, WEBHOOK_SIGNATURE_HEADER)
    if not message_id or not timestamp or not signatures:
        raise WebhookVerificationError("The webhook-id, webhook-timestamp or webhook-signature header is missing.")
    if not _TIMESTAMP_PATTERN.fullmatch(timestamp):
        raise WebhookVerificationError("webhook-timestamp must be a unix time in seconds.")

    body = raw_body.encode("utf-8") if isinstance(raw_body, str) else bytes(raw_body)
    signed = f"{message_id}.{timestamp}.".encode("utf-8") + body
    # Compared as exact standard base64 text, as in every Solverr SDK, so no other spelling of the same bytes is accepted.
    expected = base64.b64encode(hmac.new(key, signed, hashlib.sha256).digest())
    received = [
        entry[len(_SIGNATURE_VERSION) :].encode("ascii", "replace")
        for entry in signatures.split(" ")
        if entry.startswith(_SIGNATURE_VERSION)
    ]
    if not any(hmac.compare_digest(expected, signature) for signature in received):
        raise WebhookVerificationError(
            "The webhook signature does not match. Check the webhook secret and pass the raw request body."
        )

    if abs(int(time.time()) - int(timestamp)) > tolerance:
        raise WebhookVerificationError(f"The webhook timestamp is more than {tolerance} seconds from the current time.")

    try:
        event = json.loads(body)
    except ValueError:
        raise WebhookVerificationError("The webhook body is not valid JSON.") from None
    if not isinstance(event, dict):
        raise WebhookVerificationError("The webhook body is not a JSON object.")
    return cast(WebhookEvent, event)
