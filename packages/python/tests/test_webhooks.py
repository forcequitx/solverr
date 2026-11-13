from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
import unittest

from solverr import WebhookVerificationError, webhooks

_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"


def new_secret(size: int = 32) -> str:
    return "whsec_" + base64.b64encode(os.urandom(size)).decode()


def sign(secret: str, message_id: str, timestamp: str, body: bytes) -> str:
    key = base64.b64decode(secret[len("whsec_") :])
    digest = hmac.new(key, f"{message_id}.{timestamp}.".encode() + body, hashlib.sha256).digest()
    return base64.b64encode(digest).decode()


class VerifyTest(unittest.TestCase):
    def setUp(self) -> None:
        self.secret = new_secret()
        self.body = json.dumps({"id": "evt_1", "type": "invoice.paid", "data": {"invoice": {"id": "inv_1"}}}).encode()

    def headers(self, *, secret: str | None = None, timestamp: int | None = None, body: bytes | None = None, signature: str | None = None) -> dict[str, str]:
        stamp = str(int(time.time()) if timestamp is None else timestamp)
        value = signature if signature is not None else "v1," + sign(secret or self.secret, "evt_1", stamp, self.body if body is None else body)
        return {"webhook-id": "evt_1", "webhook-timestamp": stamp, "webhook-signature": value}

    def assert_refused(self, body: bytes | str, headers: dict[str, object], secret: str | None = None, fragment: str = "") -> None:
        with self.assertRaises(WebhookVerificationError) as caught:
            webhooks.verify(body, headers, secret or self.secret)  # type: ignore[arg-type]
        self.assertIn(fragment, str(caught.exception))

    def test_valid_signature_returns_the_event(self) -> None:
        event = webhooks.verify(self.body, self.headers(), self.secret)
        self.assertEqual(event["type"], "invoice.paid")

    def test_string_body_and_any_header_casing_and_single_item_lists_verify(self) -> None:
        signed = self.headers()
        headers = {"Webhook-Id": [signed["webhook-id"]], "WEBHOOK-TIMESTAMP": signed["webhook-timestamp"], "Webhook-Signature": (signed["webhook-signature"],)}
        self.assertEqual(webhooks.verify(self.body.decode(), headers, self.secret)["id"], "evt_1")

    def test_tampered_body_is_refused(self) -> None:
        self.assert_refused(self.body.replace(b"inv_1", b"inv_2"), self.headers(), fragment="does not match")

    def test_signature_from_another_secret_is_refused(self) -> None:
        self.assert_refused(self.body, self.headers(secret=new_secret()), fragment="does not match")

    def test_tampered_message_id_is_refused(self) -> None:
        headers = self.headers() | {"webhook-id": "evt_2"}
        self.assert_refused(self.body, headers, fragment="does not match")

    def test_timestamps_outside_the_tolerance_are_refused_both_ways(self) -> None:
        now = int(time.time())
        for stamp in (now - 400, now + 400):
            with self.subTest(stamp=stamp):
                self.assert_refused(self.body, self.headers(timestamp=stamp), fragment="300 seconds")

    def test_timestamp_inside_the_tolerance_verifies(self) -> None:
        now = int(time.time())
        for stamp in (now - 290, now + 290):
            with self.subTest(stamp=stamp):
                webhooks.verify(self.body, self.headers(timestamp=stamp), self.secret)

    def test_custom_tolerance_applies_and_must_not_be_negative(self) -> None:
        old = self.headers(timestamp=int(time.time()) - 60)
        with self.assertRaises(WebhookVerificationError):
            webhooks.verify(self.body, old, self.secret, tolerance=30)
        webhooks.verify(self.body, old, self.secret, tolerance=120)
        with self.assertRaises(WebhookVerificationError):
            webhooks.verify(self.body, old, self.secret, tolerance=-1)

    def test_rotation_header_verifies_when_any_v1_entry_matches(self) -> None:
        current = self.headers()["webhook-signature"]
        stale = "v1," + sign(new_secret(), "evt_1", self.headers()["webhook-timestamp"], self.body)
        headers = self.headers(signature=f"{stale} {current}")
        self.assertEqual(webhooks.verify(self.body, headers, self.secret)["id"], "evt_1")

    def test_signatures_of_another_version_are_ignored(self) -> None:
        signature = self.headers()["webhook-signature"].replace("v1,", "v2,")
        self.assert_refused(self.body, self.headers(signature=signature), fragment="does not match")

    def test_unpadded_or_url_safe_signatures_are_refused(self) -> None:
        good = self.headers()["webhook-signature"][3:]
        for spelling in (good.rstrip("="), good.replace("+", "-").replace("/", "_")):
            if spelling == good:
                continue
            with self.subTest(spelling=spelling):
                self.assert_refused(self.body, self.headers(signature="v1," + spelling), fragment="does not match")

    def test_non_canonical_base64_spelling_of_a_valid_signature_is_refused(self) -> None:
        """The same signature bytes spelled with different unused trailing bits do not verify; only exact base64 text does."""
        good = self.headers()["webhook-signature"][3:]
        flipped = good[:42] + _ALPHABET[_ALPHABET.index(good[42]) ^ 1] + good[43:]
        self.assert_refused(self.body, self.headers(signature="v1," + flipped), fragment="does not match")

    def test_bad_secrets_are_refused(self) -> None:
        raw = os.urandom(32)
        while not ({"+", "/"} & set(base64.b64encode(raw).decode())):
            raw = os.urandom(32)
        standard = base64.b64encode(raw).decode()
        url_safe = "whsec_" + base64.urlsafe_b64encode(raw).decode()
        cases = {
            "missing prefix": standard,
            "url-safe alphabet": url_safe,
            "too short": new_secret(16),
            "whitespace inside": "whsec_" + standard[:20] + " " + standard[20:],
            "empty": "whsec_",
        }
        for name, secret in cases.items():
            with self.subTest(name), self.assertRaises(WebhookVerificationError):
                webhooks.verify(self.body, self.headers(), secret)

    def test_unpadded_secret_verifies(self) -> None:
        unpadded = self.secret.rstrip("=")
        self.assertEqual(webhooks.verify(self.body, self.headers(), unpadded)["id"], "evt_1")

    def test_missing_headers_are_refused(self) -> None:
        for name in ("webhook-id", "webhook-timestamp", "webhook-signature"):
            with self.subTest(name):
                headers = self.headers()
                del headers[name]
                self.assert_refused(self.body, headers, fragment="missing")

    def test_header_lists_with_two_values_are_refused(self) -> None:
        headers: dict[str, object] = dict(self.headers())
        headers["webhook-signature"] = [headers["webhook-signature"], headers["webhook-signature"]]
        self.assert_refused(self.body, headers, fragment="missing")

    def test_non_numeric_timestamp_is_refused(self) -> None:
        headers = self.headers() | {"webhook-timestamp": "1e9"}
        self.assert_refused(self.body, headers, fragment="unix time")

    def test_signed_body_that_is_not_a_json_object_is_refused(self) -> None:
        for body, fragment in ((b"[1,2]", "not a JSON object"), (b"{oops", "not valid JSON")):
            with self.subTest(body=body):
                self.assert_refused(body, self.headers(body=body), fragment=fragment)


if __name__ == "__main__":
    unittest.main()
