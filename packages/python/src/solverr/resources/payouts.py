from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import cast

from .._http import HttpClient, path_segment
from ..types import Payout, PayoutBatch, PayoutList


def _payout_path(payout_id: str) -> str:
    return f"/api/v1/payouts/{path_segment(payout_id)}"


class Payouts:
    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def create(
        self,
        *,
        recipient: str,
        asset_id: str,
        amount: str,
        idempotency_key: str | None = None,
    ) -> Payout:
        """Creates a payout of the coin ``asset_id``, taken from ``tokens.list()``; the business completes it by signing at ``sign_url``."""
        body = {"recipient": recipient, "asset_id": asset_id, "amount": amount}
        return cast(Payout, self._http.request("POST", "/api/v1/payouts", body=body, idempotency_key=idempotency_key))

    def create_batch(
        self,
        *,
        payouts: Sequence[Mapping[str, str]],
        idempotency_key: str | None = None,
    ) -> PayoutBatch:
        """Creates 1 to 200 payouts that share one ``batch_id``; every row is checked before any payout is created.

        Each item has the keys ``recipient``, ``asset_id`` and ``amount``."""
        body = {"payouts": [dict(payout) for payout in payouts]}
        return cast(PayoutBatch, self._http.request("POST", "/api/v1/payouts/batch", body=body, idempotency_key=idempotency_key))

    def retrieve(self, payout_id: str) -> Payout:
        return cast(Payout, self._http.request("GET", _payout_path(payout_id)))

    def list(self, *, limit: int | None = None, starting_after: str | None = None) -> PayoutList:
        query = {"limit": limit, "starting_after": starting_after}
        return cast(PayoutList, self._http.request("GET", "/api/v1/payouts", query=query))

    def cancel(self, payout_id: str, *, idempotency_key: str | None = None) -> Payout:
        """Cancels a payout that was not sent. Raises a 409 error once it was sent."""
        return cast(Payout, self._http.request("POST", f"{_payout_path(payout_id)}/cancel", body={}, idempotency_key=idempotency_key))
