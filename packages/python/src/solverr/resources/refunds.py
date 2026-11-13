from __future__ import annotations

from typing import cast

from .._http import HttpClient, path_segment
from ..types import Refund, RefundList


def _refund_path(refund_id: str) -> str:
    return f"/api/v1/refunds/{path_segment(refund_id)}"


class Refunds:
    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def create(
        self,
        *,
        invoice_id: str,
        payment_id: str | None = None,
        amount: str | None = None,
        idempotency_key: str | None = None,
    ) -> Refund:
        """Refunds the payment that paid the invoice, or ``payment_id`` for an extra payment; the business signs it at ``sign_url``.

        ``amount`` is in the settlement coin; leave it out to refund what is left of that payment."""
        body = {"invoice_id": invoice_id, "payment_id": payment_id, "amount": amount}
        return cast(Refund, self._http.request("POST", "/api/v1/refunds", body=body, idempotency_key=idempotency_key))

    def retrieve(self, refund_id: str) -> Refund:
        return cast(Refund, self._http.request("GET", _refund_path(refund_id)))

    def list(self, *, limit: int | None = None, starting_after: str | None = None) -> RefundList:
        query = {"limit": limit, "starting_after": starting_after}
        return cast(RefundList, self._http.request("GET", "/api/v1/refunds", query=query))

    def cancel(self, refund_id: str, *, idempotency_key: str | None = None) -> Refund:
        """Cancels a refund that was not sent; its amount can then be refunded again. Raises a 409 error once it was sent."""
        return cast(Refund, self._http.request("POST", f"{_refund_path(refund_id)}/cancel", body={}, idempotency_key=idempotency_key))
