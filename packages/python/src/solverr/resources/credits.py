from __future__ import annotations

from typing import Literal, cast

from .._http import HttpClient, path_segment
from ..types import CreditCharge, CreditTopup


class Credits:
    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def topup(
        self,
        *,
        amount: str,
        currency: Literal["USD"],
        credit_account_id: str | None = None,
        idempotency_key: str | None = None,
    ) -> CreditTopup:
        """Creates a USD credit account and the invoice that funds it; the balance is added once the invoice is paid.

        Pass ``credit_account_id`` to add to an existing account instead of creating a new one (and a new token)."""
        body = {"amount": amount, "currency": currency, "credit_account_id": credit_account_id}
        return cast(CreditTopup, self._http.request("POST", "/api/v1/credits/topup", body=body, idempotency_key=idempotency_key))

    def charge(
        self,
        *,
        token: str,
        amount: str,
        currency: Literal["USD"] | None = None,
        description: str | None = None,
        idempotency_key: str | None = None,
    ) -> CreditCharge:
        """Deducts an amount from the credit account that owns ``token`` and returns the charge with the remaining balance.

        Credit balances are kept in USD; other currencies are rejected."""
        body = {"token": token, "amount": amount, "currency": currency, "description": description}
        return cast(CreditCharge, self._http.request("POST", "/api/v1/credits/charge", body=body, idempotency_key=idempotency_key))

    def refund_charge(self, charge_id: str, *, idempotency_key: str | None = None) -> CreditCharge:
        """Gives a charge back to its credit account, once; for a request the charge paid for that then failed."""
        path = f"/api/v1/credits/charges/{path_segment(charge_id)}/refund"
        return cast(CreditCharge, self._http.request("POST", path, body={}, idempotency_key=idempotency_key))
