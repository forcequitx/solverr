from __future__ import annotations

import unittest
from collections.abc import Callable
from typing import Any

from solverr import Solverr

from .support import TEST_API_KEY, Reply, ScriptedServer


class ResourcesTest(unittest.TestCase):
    """Each resource method against a local server: HTTP method, encoded path, JSON body and idempotency key."""

    def setUp(self) -> None:
        self.server = ScriptedServer().__enter__()
        self.addCleanup(self.server.__exit__, None, None, None)
        self.client = Solverr(TEST_API_KEY, self.server.base_url + "/")

    def check(self, call: Callable[[Solverr], Any], method: str, path: str, body: Any = None) -> None:
        self.server.requests.clear()
        call(self.client)
        (sent,) = self.server.requests
        self.assertEqual((sent.method, sent.path), (method, path))
        if body is None:
            self.assertEqual(sent.body, b"")
        else:
            self.assertEqual(sent.json(), body)
        self.assertEqual("idempotency-key" in sent.headers, method == "POST")

    def test_invoices(self) -> None:
        self.check(lambda c: c.invoices.create(amount="25.00", currency="USD"), "POST", "/api/v1/invoices", {"amount": "25.00", "currency": "USD"})
        self.check(
            lambda c: c.invoices.create(
                amount="1.00",
                currency="EUR",
                order_id="o1",
                description="d",
                redirect_url="https://shop.example.com/done",
                customer_email="a@example.com",
                metadata={"k": "v"},
                expires_in=900,
            ),
            "POST",
            "/api/v1/invoices",
            {
                "amount": "1.00",
                "currency": "EUR",
                "order_id": "o1",
                "description": "d",
                "redirect_url": "https://shop.example.com/done",
                "customer_email": "a@example.com",
                "metadata": {"k": "v"},
                "expires_in": 900,
            },
        )
        self.check(lambda c: c.invoices.retrieve("inv/1"), "GET", "/api/v1/invoices/inv%2F1")
        self.check(lambda c: c.invoices.list(limit=10, status="paid"), "GET", "/api/v1/invoices?limit=10&status=paid")
        self.check(lambda c: c.invoices.list(), "GET", "/api/v1/invoices")
        self.check(lambda c: c.invoices.redeem("inv_1"), "POST", "/api/v1/invoices/inv_1/redeem")

    def test_payment_links(self) -> None:
        self.check(lambda c: c.payment_links.create(title="Tip", currency="USD"), "POST", "/api/v1/payment-links", {"title": "Tip", "currency": "USD"})
        self.check(lambda c: c.payment_links.list(starting_after="pl_9"), "GET", "/api/v1/payment-links?starting_after=pl_9")
        self.check(lambda c: c.payment_links.deactivate("pl_1"), "DELETE", "/api/v1/payment-links/pl_1")

    def test_refunds(self) -> None:
        self.check(lambda c: c.refunds.create(invoice_id="inv_1"), "POST", "/api/v1/refunds", {"invoice_id": "inv_1"})
        self.check(
            lambda c: c.refunds.create(invoice_id="inv_1", payment_id="pay_1", amount="0.5"),
            "POST",
            "/api/v1/refunds",
            {"invoice_id": "inv_1", "payment_id": "pay_1", "amount": "0.5"},
        )
        self.check(lambda c: c.refunds.retrieve("rf_1"), "GET", "/api/v1/refunds/rf_1")
        self.check(lambda c: c.refunds.list(limit=1), "GET", "/api/v1/refunds?limit=1")
        self.check(lambda c: c.refunds.cancel("rf_1"), "POST", "/api/v1/refunds/rf_1/cancel", {})

    def test_payouts(self) -> None:
        row = {"recipient": "alice.near", "asset_id": "nep141:usdc", "amount": "1"}
        self.check(lambda c: c.payouts.create(**row), "POST", "/api/v1/payouts", row)
        self.check(lambda c: c.payouts.create_batch(payouts=[row, row]), "POST", "/api/v1/payouts/batch", {"payouts": [row, row]})
        self.check(lambda c: c.payouts.retrieve("po_1"), "GET", "/api/v1/payouts/po_1")
        self.check(lambda c: c.payouts.list(), "GET", "/api/v1/payouts")
        self.check(lambda c: c.payouts.cancel("po_1"), "POST", "/api/v1/payouts/po_1/cancel", {})

    def test_subscriptions(self) -> None:
        self.check(
            lambda c: c.subscriptions.create(customer_email="a@example.com", amount="5.00", currency="USD", interval="month"),
            "POST",
            "/api/v1/subscriptions",
            {"customer_email": "a@example.com", "amount": "5.00", "currency": "USD", "interval": "month"},
        )
        self.check(lambda c: c.subscriptions.list(limit=3), "GET", "/api/v1/subscriptions?limit=3")
        self.check(lambda c: c.subscriptions.cancel("sub_1"), "DELETE", "/api/v1/subscriptions/sub_1")

    def test_credits(self) -> None:
        self.check(lambda c: c.credits.topup(amount="10", currency="USD"), "POST", "/api/v1/credits/topup", {"amount": "10", "currency": "USD"})
        self.check(lambda c: c.credits.charge(token="tok", amount="1"), "POST", "/api/v1/credits/charge", {"token": "tok", "amount": "1"})
        self.check(lambda c: c.credits.refund_charge("ch_1"), "POST", "/api/v1/credits/charges/ch_1/refund", {})

    def test_tokens(self) -> None:
        self.check(lambda c: c.tokens.list(), "GET", "/api/v1/tokens")

    def test_webhooks_send_test(self) -> None:
        self.check(lambda c: c.webhooks.send_test(), "POST", "/api/v1/webhooks/test")

    def test_idempotency_key_is_passed_through_by_resource_methods(self) -> None:
        self.client.invoices.create(amount="1.00", currency="USD", idempotency_key="key-1")
        self.client.refunds.cancel("rf_1", idempotency_key="key-2")
        self.assertEqual([r.headers["idempotency-key"] for r in self.server.requests], ["key-1", "key-2"])

    def test_path_ids_that_climb_out_are_refused_before_any_request(self) -> None:
        calls = [
            lambda: self.client.invoices.retrieve(".."),
            lambda: self.client.invoices.redeem("."),
            lambda: self.client.refunds.cancel(""),
            lambda: self.client.payouts.retrieve(".."),
            lambda: self.client.payment_links.deactivate(".."),
            lambda: self.client.subscriptions.cancel(".."),
            lambda: self.client.credits.refund_charge(".."),
        ]
        for call in calls:
            with self.assertRaises(ValueError):
                call()
        self.assertEqual(self.server.requests, [])

    def test_list_all_follows_pages_with_the_last_id(self) -> None:
        self.server.script += [
            Reply(body={"object": "list", "data": [{"id": "inv_3"}, {"id": "inv_2"}], "has_more": True}),
            Reply(body={"object": "list", "data": [{"id": "inv_1"}], "has_more": False}),
        ]
        ids = [invoice["id"] for invoice in self.client.invoices.list_all(limit=2)]
        self.assertEqual(ids, ["inv_3", "inv_2", "inv_1"])
        self.assertEqual(
            [r.path for r in self.server.requests],
            ["/api/v1/invoices?limit=2", "/api/v1/invoices?limit=2&starting_after=inv_2"],
        )


if __name__ == "__main__":
    unittest.main()
