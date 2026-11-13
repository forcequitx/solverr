from __future__ import annotations

from typing import cast

from .._http import HttpClient, path_segment
from ..types import Currency, PaymentLink, PaymentLinkList


class PaymentLinks:
    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def create(
        self,
        *,
        title: str,
        currency: Currency,
        amount: str | None = None,
        redirect_url: str | None = None,
        idempotency_key: str | None = None,
    ) -> PaymentLink:
        """Creates a payment link; leave out ``amount`` to let the customer choose it, and ``redirect_url`` to send customers to the business website after paying."""
        body = {"title": title, "amount": amount, "currency": currency, "redirect_url": redirect_url}
        return cast(PaymentLink, self._http.request("POST", "/api/v1/payment-links", body=body, idempotency_key=idempotency_key))

    def list(self, *, limit: int | None = None, starting_after: str | None = None) -> PaymentLinkList:
        query = {"limit": limit, "starting_after": starting_after}
        return cast(PaymentLinkList, self._http.request("GET", "/api/v1/payment-links", query=query))

    def deactivate(self, link_id: str) -> PaymentLink:
        """Turns a link off and returns it with ``active`` false; invoices already created from it stay payable."""
        path = f"/api/v1/payment-links/{path_segment(link_id)}"
        return cast(PaymentLink, self._http.request("DELETE", path))
