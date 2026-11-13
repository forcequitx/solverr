from __future__ import annotations

from typing import cast

from .._http import HttpClient
from ..types import WebhookTest


class Webhooks:
    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def send_test(self) -> WebhookTest:
        """Queues a signed ``test.ping`` event to the business's webhook URL; raises ``SolverrError`` 409 when none is set."""
        return cast(WebhookTest, self._http.request("POST", "/api/v1/webhooks/test"))
