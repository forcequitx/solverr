from __future__ import annotations

import copy
import pickle
import time
import unittest
import uuid
from unittest import mock

from solverr import Solverr, SolverrError, __version__
from solverr import _http
from solverr._http import HttpClient, path_segment

from .support import TEST_API_KEY, Reply, ScriptedServer, drip_body, drop_connection, json_error, stall


class ServerTestCase(unittest.TestCase):
    """Starts a scripted local server per test and records the delays the client would sleep instead of sleeping."""

    def setUp(self) -> None:
        self.server = ScriptedServer().__enter__()
        self.addCleanup(self.server.__exit__, None, None, None)
        self.http = HttpClient(TEST_API_KEY, self.server.base_url)
        sleep = mock.patch("time.sleep")
        self.sleep = sleep.start()
        self.addCleanup(sleep.stop)

    def slept(self) -> list[float]:
        return [call.args[0] for call in self.sleep.call_args_list]


class RequestHeadersTest(ServerTestCase):
    def test_get_sends_bearer_key_accept_and_user_agent_without_idempotency_key(self) -> None:
        self.server.script.append(Reply(body={"id": "inv_1"}))
        self.assertEqual(self.http.request("GET", "/api/v1/invoices/inv_1"), {"id": "inv_1"})
        sent = self.server.requests[0]
        self.assertEqual(sent.method, "GET")
        self.assertEqual(sent.headers["authorization"], f"Bearer {TEST_API_KEY}")
        self.assertEqual(sent.headers["accept"], "application/json")
        self.assertEqual(sent.headers["user-agent"], f"solverr-python/{__version__}")
        self.assertNotIn("idempotency-key", sent.headers)
        self.assertEqual(sent.body, b"")

    def test_post_gets_a_random_uuid4_idempotency_key_per_call(self) -> None:
        self.http.request("POST", "/a", body={})
        self.http.request("POST", "/a", body={})
        first, second = (uuid.UUID(r.headers["idempotency-key"]) for r in self.server.requests)
        self.assertEqual(first.version, 4)
        self.assertNotEqual(first, second)

    def test_post_uses_the_given_idempotency_key(self) -> None:
        self.http.request("POST", "/a", body={}, idempotency_key="order-42")
        self.assertEqual(self.server.requests[0].headers["idempotency-key"], "order-42")

    def test_idempotency_keys_http_client_cannot_send_are_refused_before_sending(self) -> None:
        for key in ("key\r\nX-Injected: 1", "key\0", "ключ"):
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, "^idempotency_key cannot contain"):
                self.http.request("POST", "/a", body={}, idempotency_key=key)
        self.assertEqual(self.server.requests, [])
        self.http.request("POST", "/a", body={}, idempotency_key="café-42")
        self.assertEqual(len(self.server.requests), 1)

    def test_post_body_leaves_out_none_fields_and_keeps_unicode(self) -> None:
        self.http.request("POST", "/a", body={"amount": "1.00", "description": None, "title": "Café"})
        sent = self.server.requests[0]
        self.assertEqual(sent.headers["content-type"], "application/json")
        self.assertEqual(sent.json(), {"amount": "1.00", "title": "Café"})

    def test_post_without_body_sends_no_content(self) -> None:
        self.http.request("POST", "/a")
        sent = self.server.requests[0]
        self.assertEqual(sent.body, b"")
        self.assertNotIn("content-type", sent.headers)
        self.assertIn("idempotency-key", sent.headers)

    def test_query_leaves_out_none_and_percent_encodes_spaces(self) -> None:
        self.http.request("GET", "/a", query={"limit": 5, "starting_after": None, "status": "a b&c"})
        self.assertEqual(self.server.requests[0].path, "/a?limit=5&status=a%20b%26c")


class PathSegmentTest(unittest.TestCase):
    def test_encodes_slashes_and_unicode_into_one_segment(self) -> None:
        self.assertEqual(path_segment("inv/../x"), "inv%2F..%2Fx")
        self.assertEqual(path_segment("ü?#"), "%C3%BC%3F%23")

    def test_refuses_empty_dot_and_dot_dot(self) -> None:
        for value in ("", ".", ".."):
            with self.subTest(value=value), self.assertRaises(ValueError):
                path_segment(value)


class RetryTest(ServerTestCase):
    def test_5xx_is_retried_twice_with_the_same_idempotency_key_and_growing_backoff(self) -> None:
        self.server.script += [Reply(500), Reply(503), Reply(body={"ok": True})]
        self.assertEqual(self.http.request("POST", "/a", body={}), {"ok": True})
        keys = {r.headers["idempotency-key"] for r in self.server.requests}
        self.assertEqual(len(self.server.requests), 3)
        self.assertEqual(len(keys), 1)
        first, second = self.slept()
        self.assertTrue(0.5 <= first <= 0.625, first)
        self.assertTrue(1.0 <= second <= 1.25, second)

    def test_5xx_after_the_last_retry_raises_with_the_api_error(self) -> None:
        self.server.script += [Reply(502, b"bad gateway")] * 3
        with self.assertRaises(SolverrError) as caught:
            self.http.request("GET", "/a")
        self.assertEqual(len(self.server.requests), 3)
        self.assertEqual((caught.exception.status, caught.exception.type), (502, "api_error"))
        self.assertEqual(caught.exception.message, "Solverr returned HTTP 502.")

    def test_dropped_connection_is_retried_with_the_same_idempotency_key(self) -> None:
        self.server.script += [Reply(action=drop_connection), Reply(body={"ok": True})]
        self.assertEqual(self.http.request("POST", "/a", body={}), {"ok": True})
        self.assertEqual(len({r.headers["idempotency-key"] for r in self.server.requests}), 1)
        self.assertEqual(len(self.slept()), 1)

    def test_429_waits_its_retry_after_and_keeps_the_idempotency_key(self) -> None:
        self.server.script += [json_error(429, "rate_limited", headers={"Retry-After": "2"}), Reply(body={"ok": True})]
        self.assertEqual(self.http.request("POST", "/a", body={}), {"ok": True})
        self.assertEqual(self.slept(), [2.0])
        self.assertEqual(len({r.headers["idempotency-key"] for r in self.server.requests}), 1)

    def test_in_progress_409_waits_its_retry_after(self) -> None:
        self.server.script += [json_error(409, "idempotency_conflict", headers={"Retry-After": "1"}), Reply(body={"ok": True})]
        self.assertEqual(self.http.request("POST", "/a", body={}), {"ok": True})
        self.assertEqual(self.slept(), [1.0])

    def test_retry_after_of_exactly_10_seconds_is_waited_for(self) -> None:
        self.server.script += [json_error(429, "rate_limited", headers={"Retry-After": "10"}), Reply(body={"ok": True})]
        self.http.request("GET", "/a")
        self.assertEqual(self.slept(), [10.0])

    def test_retry_after_over_10_seconds_raises_at_once_with_retry_after(self) -> None:
        self.server.script.append(json_error(429, "rate_limited", "Slow down.", headers={"Retry-After": "11"}))
        with self.assertRaises(SolverrError) as caught:
            self.http.request("GET", "/a")
        self.assertEqual(len(self.server.requests), 1)
        self.assertEqual(self.slept(), [])
        self.assertEqual((caught.exception.status, caught.exception.retry_after), (429, 11))

    def test_429_without_retry_after_or_with_an_http_date_is_not_retried(self) -> None:
        for headers in ({}, {"Retry-After": "Wed, 21 Oct 2026 07:28:00 GMT"}):
            with self.subTest(headers=headers):
                self.server.requests.clear()
                self.server.script.append(json_error(429, "rate_limited", headers=headers))
                with self.assertRaises(SolverrError) as caught:
                    self.http.request("GET", "/a")
                self.assertEqual(len(self.server.requests), 1)
                self.assertIsNone(caught.exception.retry_after)

    def test_retry_after_waits_stop_after_three_retries(self) -> None:
        self.server.script += [json_error(429, "rate_limited", headers={"Retry-After": "1"})] * 4
        with self.assertRaises(SolverrError) as caught:
            self.http.request("GET", "/a")
        self.assertEqual(len(self.server.requests), 4)
        self.assertEqual(self.slept(), [1.0, 1.0, 1.0])
        self.assertEqual(caught.exception.status, 429)

    def test_other_4xx_are_not_retried_even_with_retry_after(self) -> None:
        cases = [
            (400, "invalid_request"),
            (401, "authentication_error"),
            (404, "not_found"),
            (409, "invalid_state"),
            (422, "invalid_request"),
        ]
        for status, error_type in cases:
            with self.subTest(status=status):
                self.server.requests.clear()
                self.server.script.append(json_error(status, error_type, headers={"Retry-After": "1"}))
                with self.assertRaises(SolverrError) as caught:
                    self.http.request("POST", "/a", body={})
                self.assertEqual(len(self.server.requests), 1)
                self.assertEqual((caught.exception.status, caught.exception.type), (status, error_type))
        self.assertEqual(self.slept(), [])


class TimeoutTest(unittest.TestCase):
    def setUp(self) -> None:
        self.server = ScriptedServer().__enter__()
        self.addCleanup(self.server.__exit__, None, None, None)
        for name, value in (("REQUEST_TIMEOUT_SECONDS", 0.5), ("MAX_RETRIES", 0)):
            patcher = mock.patch.object(_http, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.http = HttpClient(TEST_API_KEY, self.server.base_url)

    def test_server_that_sends_nothing_fails_after_the_socket_timeout(self) -> None:
        self.server.script.append(Reply(action=stall(6)))
        started = time.monotonic()
        with self.assertRaises(SolverrError) as caught:
            self.http.request("GET", "/a")
        self.assertLess(time.monotonic() - started, 3)
        self.assertEqual((caught.exception.status, caught.exception.type), (0, "connection_error"))

    def test_body_sent_a_byte_at_a_time_fails_at_the_request_deadline(self) -> None:
        self.server.script.append(Reply(action=drip_body(100, 0.1)))
        started = time.monotonic()
        with self.assertRaises(SolverrError) as caught:
            self.http.request("GET", "/a")
        elapsed = time.monotonic() - started
        self.assertLess(elapsed, 4, "each byte arrives within the socket timeout, so only the deadline can stop the read")
        self.assertEqual((caught.exception.status, caught.exception.type), (0, "connection_error"))
        self.assertIn("no complete response within", caught.exception.message)


class RedirectTest(ServerTestCase):
    def test_redirect_is_raised_and_never_followed(self) -> None:
        target = f"{self.server.base_url}/elsewhere"
        self.server.script.append(Reply(302, b"", {"Location": target}))
        with self.assertRaises(SolverrError) as caught:
            self.http.request("GET", "/a")
        self.assertEqual([r.path for r in self.server.requests], ["/a"])
        self.assertEqual((caught.exception.status, caught.exception.type), (302, "api_error"))
        self.assertIn(target, caught.exception.message)


class SolverrErrorTest(ServerTestCase):
    def test_api_error_body_and_retry_after_fill_every_field(self) -> None:
        self.server.script.append(
            json_error(409, "invalid_state", "Invoice is paid.", headers={"Retry-After": "30"}, param="invoice_id", code="invoice_paid")
        )
        with self.assertRaises(SolverrError) as caught:
            self.http.request("POST", "/a", body={})
        error = caught.exception
        self.assertEqual(
            (error.status, error.type, error.message, error.param, error.code, error.retry_after),
            (409, "invalid_state", "Invoice is paid.", "invoice_id", "invoice_paid", 30),
        )
        self.assertEqual(str(error), "Invoice is paid.")

    def test_error_fields_of_the_wrong_type_are_dropped(self) -> None:
        self.server.script.append(Reply(400, {"error": {"type": "invalid_request", "message": "Bad.", "param": 5, "code": ["x"]}}))
        with self.assertRaises(SolverrError) as caught:
            self.http.request("GET", "/a")
        self.assertIsNone(caught.exception.param)
        self.assertIsNone(caught.exception.code)

    def test_success_that_is_not_json_raises(self) -> None:
        self.server.script.append(Reply(200, b"<html>"))
        with self.assertRaises(SolverrError) as caught:
            self.http.request("GET", "/a")
        self.assertEqual((caught.exception.status, caught.exception.type), (200, "api_error"))

    def test_error_survives_pickle_and_copy_with_every_field(self) -> None:
        error = SolverrError(429, "rate_limited", "Slow down.", "amount", "too_many", 7)
        for clone in (pickle.loads(pickle.dumps(error)), copy.copy(error)):
            self.assertEqual(repr(clone), repr(error))
            self.assertEqual(clone.retry_after, 7)

    def test_network_errors_after_the_last_retry_raise_connection_error_with_status_0(self) -> None:
        self.server.script += [Reply(action=drop_connection)] * 3
        with self.assertRaises(SolverrError) as caught:
            self.http.request("GET", "/a")
        self.assertEqual((caught.exception.status, caught.exception.type), (0, "connection_error"))
        self.assertEqual(len(self.slept()), 2)


class ClientConfigTest(unittest.TestCase):
    def test_accepts_only_live_api_keys(self) -> None:
        for key in (None, "", "sk_test_abc", "pk_live_abc", "sk_live_", "sk_live_a b", "sk_live_abc\n", "sk_live_abcé"):
            with self.subTest(key=key), self.assertRaises(ValueError):
                Solverr(key, "https://pay.example.com")
        Solverr("sk_live_abc", "https://pay.example.com")

    def test_base_url_must_be_https_except_plain_http_on_localhost(self) -> None:
        for url in ("https://pay.example.com", "http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000"):
            with self.subTest(url=url):
                Solverr(TEST_API_KEY, url)
        for url in (
            "http://pay.example.com",
            "ftp://pay.example.com",
            "pay.example.com",
            "https://pay.example.com/?a=1",
            "https://pay.example.com/#x",
            "https://pay.example.com/my app",
            "https://pay.example.com\n",
        ):
            with self.subTest(url=url), self.assertRaises(ValueError):
                Solverr(TEST_API_KEY, url)

    def test_base_url_comes_from_solverr_url_when_not_passed(self) -> None:
        with mock.patch.dict("os.environ", {"SOLVERR_URL": "https://env.example.com/"}):
            client = Solverr(TEST_API_KEY)
        self.assertEqual(client.invoices._http._base_url, "https://env.example.com")
        with mock.patch.dict("os.environ", {}, clear=True), self.assertRaises(ValueError):
            Solverr(TEST_API_KEY)


if __name__ == "__main__":
    unittest.main()
