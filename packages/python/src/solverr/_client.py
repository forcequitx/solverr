from __future__ import annotations

import os
import re
import urllib.parse

from ._config import BASE_URL_ENV, LOCAL_HOSTS
from ._http import HttpClient
from .resources import Credits, Invoices, PaymentLinks, Payouts, Refunds, Subscriptions, Tokens, Webhooks

_API_KEY_PATTERN = re.compile(r"sk_live_[\x21-\x7e]+")
# Whitespace and control characters, which http.client refuses in a URL.
_URL_UNSAFE = re.compile(r"[\s\x00-\x1f\x7f]")


def _resolve_base_url(base_url: str | None) -> str:
    """Validates the base URL and drops a trailing slash so API paths can be appended."""
    value = base_url if base_url is not None else os.environ.get(BASE_URL_ENV)
    if not value:
        raise ValueError(f"Pass base_url to Solverr() or set the {BASE_URL_ENV} environment variable.")
    parts = urllib.parse.urlsplit(value)
    if not parts.netloc or _URL_UNSAFE.search(value):
        raise ValueError(f"base_url is not a valid URL: {value}")
    if parts.scheme != "https" and not (parts.scheme == "http" and parts.hostname in LOCAL_HOSTS):
        raise ValueError("base_url must be an https URL (http only for localhost).")
    # "?" or "#" with nothing after it gives an empty query or fragment, yet still breaks the appended API paths.
    if "?" in value or "#" in value:
        raise ValueError("base_url must not have a query string or fragment.")
    return value.rstrip("/")


class Solverr:
    """Client for the Solverr API; ``api_key`` is an API key starting with ``sk_live_``.

    ``base_url`` is the origin of the Solverr app, such as ``"https://pay.example.com"``; defaults to ``SOLVERR_URL``."""

    def __init__(self, api_key: str | None, base_url: str | None = None) -> None:
        if not api_key or not _API_KEY_PATTERN.fullmatch(api_key):
            raise ValueError("api_key must be a Solverr API key starting with sk_live_.")
        http = HttpClient(api_key, _resolve_base_url(base_url))
        self.invoices = Invoices(http)
        self.payment_links = PaymentLinks(http)
        self.refunds = Refunds(http)
        self.payouts = Payouts(http)
        self.subscriptions = Subscriptions(http)
        self.credits = Credits(http)
        self.tokens = Tokens(http)
        self.webhooks = Webhooks(http)
