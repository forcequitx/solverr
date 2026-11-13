from __future__ import annotations

from typing import cast

from .._http import HttpClient
from ..types import TokenList


class Tokens:
    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def list(self) -> TokenList:
        """Lists the coins the checkout accepts, with USD prices; the API caches the list for 60 seconds."""
        return cast(TokenList, self._http.request("GET", "/api/v1/tokens"))
