from __future__ import annotations

from typing import cast

from .._http import HttpClient, path_segment
from ..types import Currency, Subscription, SubscriptionInterval, SubscriptionList


class Subscriptions:
    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def create(
        self,
        *,
        customer_email: str,
        amount: str,
        currency: Currency,
        interval: SubscriptionInterval,
        description: str | None = None,
        idempotency_key: str | None = None,
    ) -> Subscription:
        """Creates a subscription that issues an invoice to the customer every ``interval``."""
        body = {
            "customer_email": customer_email,
            "amount": amount,
            "currency": currency,
            "interval": interval,
            "description": description,
        }
        return cast(Subscription, self._http.request("POST", "/api/v1/subscriptions", body=body, idempotency_key=idempotency_key))

    def list(self, *, limit: int | None = None, starting_after: str | None = None) -> SubscriptionList:
        query = {"limit": limit, "starting_after": starting_after}
        return cast(SubscriptionList, self._http.request("GET", "/api/v1/subscriptions", query=query))

    def cancel(self, subscription_id: str) -> Subscription:
        """Cancels a subscription and returns it with status ``canceled``; invoices already sent stay payable."""
        path = f"/api/v1/subscriptions/{path_segment(subscription_id)}"
        return cast(Subscription, self._http.request("DELETE", path))
