from __future__ import annotations

from collections.abc import Iterator, Mapping
from typing import cast

from .._http import HttpClient, path_segment
from ..types import Currency, Invoice, InvoiceList, InvoiceRedemption, InvoiceStatus


def _invoice_path(invoice_id: str) -> str:
    return f"/api/v1/invoices/{path_segment(invoice_id)}"


class Invoices:
    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def create(
        self,
        *,
        amount: str,
        currency: Currency,
        order_id: str | None = None,
        description: str | None = None,
        redirect_url: str | None = None,
        customer_email: str | None = None,
        metadata: Mapping[str, str] | None = None,
        expires_in: int | None = None,
        idempotency_key: str | None = None,
    ) -> Invoice:
        """Creates an invoice; send the customer to its ``checkout_url``.

        ``amount`` has up to two decimals, such as ``"25.00"``; ``expires_in`` is the invoice lifetime in seconds, 900 to 86400."""
        body = {
            "amount": amount,
            "currency": currency,
            "order_id": order_id,
            "description": description,
            "redirect_url": redirect_url,
            "customer_email": customer_email,
            "metadata": dict(metadata) if metadata is not None else None,
            "expires_in": expires_in,
        }
        return cast(Invoice, self._http.request("POST", "/api/v1/invoices", body=body, idempotency_key=idempotency_key))

    def retrieve(self, invoice_id: str) -> Invoice:
        return cast(Invoice, self._http.request("GET", _invoice_path(invoice_id)))

    def list(
        self,
        *,
        limit: int | None = None,
        starting_after: str | None = None,
        status: InvoiceStatus | None = None,
    ) -> InvoiceList:
        """One page of invoices, newest first. ``limit`` is 1 to 100."""
        query = {"limit": limit, "starting_after": starting_after, "status": status}
        return cast(InvoiceList, self._http.request("GET", "/api/v1/invoices", query=query))

    def list_all(
        self,
        *,
        limit: int | None = None,
        starting_after: str | None = None,
        status: InvoiceStatus | None = None,
    ) -> Iterator[Invoice]:
        """Every matching invoice, newest first, fetching pages as the loop advances."""
        while True:
            page = self.list(limit=limit, starting_after=starting_after, status=status)
            yield from page["data"]
            if not page["has_more"] or not page["data"]:
                return
            starting_after = page["data"][-1]["id"]

    def redeem(self, invoice_id: str, *, idempotency_key: str | None = None) -> InvoiceRedemption:
        """Marks a paid invoice as used, so it grants access only once.

        Raises ``SolverrError`` 409 with type ``invalid_state`` when unpaid, or ``already_redeemed`` when used before."""
        path = f"{_invoice_path(invoice_id)}/redeem"
        return cast(InvoiceRedemption, self._http.request("POST", path, idempotency_key=idempotency_key))
