"""Shapes of the objects the Solverr API returns and the events it sends."""

from __future__ import annotations

from typing import Any, Literal, TypedDict

# Every object an API key reaches is live; test mode exists only for demo store invoices.
Mode = Literal["live"]

Currency = Literal["USD", "EUR", "INR"]

InvoiceStatus = Literal[
    "created",
    "awaiting_payment",
    "detected",
    "processing",
    "paid",
    "underpaid",
    "refunded",
    "failed",
    "expired",
]

RefundStatus = Literal["pending", "processing", "completed", "failed", "canceled"]

PayoutStatus = Literal["pending", "processing", "completed", "failed", "canceled"]

SubscriptionInterval = Literal["week", "month"]

SubscriptionStatus = Literal["active", "canceled"]


class Settlement(TypedDict):
    """The coin and amount the business receives for an invoice."""

    asset_id: str
    symbol: str
    blockchain: str
    amount: str
    amount_base: str


class Invoice(TypedDict):
    id: str
    object: Literal["invoice"]
    mode: Mode
    status: InvoiceStatus
    amount: str
    currency: Currency
    order_id: str | None
    description: str | None
    customer_email: str | None
    redirect_url: str | None
    metadata: dict[str, str]
    settlement: Settlement
    late: bool
    extra_payment: bool
    checkout_url: str
    receipt_url: str | None
    redeemed_at: str | None
    expires_at: str
    created_at: str


class PaymentCoin(TypedDict):
    asset_id: str
    symbol: str
    blockchain: str
    chain_name: str
    decimals: int


class PaymentTransaction(TypedDict):
    hash: str
    url: str | None


class Payment(TypedDict):
    """One payment attempt on an invoice: a quote and its latest network status."""

    id: str
    object: Literal["payment"]
    status: str
    coin: PaymentCoin
    amount_in: str
    amount_in_base: str
    min_amount_in_base: str
    amount_in_usd: str | None
    deposit_address: str
    deposit_memo: str | None
    refund_address: str
    # True when NEAR Intents quoted this attempt as a confidential intent (private payments).
    confidential: bool
    deadline: str
    time_estimate_seconds: int
    deposited_amount: str | None
    refunded_amount: str | None
    refund_fee: str | None
    refund_reason: str | None
    origin_transactions: list[PaymentTransaction]
    destination_transactions: list[PaymentTransaction]
    correlation_id: str
    quote_signature: str
    created_at: str


class PaymentLink(TypedDict):
    id: str
    object: Literal["payment_link"]
    mode: Mode
    url: str
    title: str
    amount: str | None
    currency: Currency
    redirect_url: str | None
    active: bool
    created_at: str


class Refund(TypedDict):
    """``amount`` is in ``source_asset``, the business's settlement coin; the payer receives ``asset_id`` at ``recipient``."""

    id: str
    object: Literal["refund"]
    status: RefundStatus
    invoice_id: str
    batch_id: str | None
    amount: str
    source_asset: str
    asset_id: str
    recipient: str
    tx_hash: str | None
    failure_reason: str | None
    sign_url: str
    created_at: str


class Payout(TypedDict):
    """``amount`` is in ``source_asset``, the business's settlement coin; the recipient receives ``asset_id``."""

    id: str
    object: Literal["payout"]
    status: PayoutStatus
    invoice_id: str | None
    batch_id: str | None
    amount: str
    source_asset: str
    asset_id: str
    recipient: str
    tx_hash: str | None
    failure_reason: str | None
    sign_url: str
    created_at: str


class PayoutBatch(TypedDict):
    """``id`` is the ``batch_id`` of every payout in ``data``."""

    object: Literal["payout_batch"]
    id: str
    data: list[Payout]


class Subscription(TypedDict):
    id: str
    object: Literal["subscription"]
    status: SubscriptionStatus
    customer_email: str
    amount: str
    currency: Currency
    interval: SubscriptionInterval
    description: str | None
    next_invoice_at: str
    created_at: str


class _CreditAccountBase(TypedDict):
    id: str
    object: Literal["credit_account"]
    balance: str
    currency: Literal["USD"]


class CreditAccount(_CreditAccountBase, total=False):
    # Returned only when the account is created. Store it like a password.
    token: str


class CreditTopup(TypedDict):
    credit_account: CreditAccount
    invoice: Invoice


class _CreditChargeBase(TypedDict):
    # Charge id (cru_…); pass it to credits.refund_charge to give the charge back.
    id: str
    object: Literal["credit_charge"]
    amount: str
    # Balance after the charge or refund, with 6 decimals.
    balance: str
    currency: Literal["USD"]


class CreditCharge(_CreditChargeBase, total=False):
    # True on the answer of credits.refund_charge.
    refunded: bool


class Token(TypedDict):
    """A coin the checkout accepts; a payout's ``asset_id`` is one of these."""

    asset_id: str
    symbol: str
    blockchain: str
    # Display name of the chain, such as "Base".
    chain_name: str
    decimals: int
    price_usd: float
    # Token contract, or None for a chain's native coin.
    contract_address: str | None


class WebhookTest(TypedDict):
    queued: Literal[True]


class InvoiceRedemption(TypedDict):
    id: str
    redeemed_at: str
    payment: Payment | None


class InvoiceList(TypedDict):
    object: Literal["list"]
    data: list[Invoice]
    has_more: bool


class PaymentLinkList(TypedDict):
    object: Literal["list"]
    data: list[PaymentLink]
    has_more: bool


class RefundList(TypedDict):
    object: Literal["list"]
    data: list[Refund]
    has_more: bool


class PayoutList(TypedDict):
    object: Literal["list"]
    data: list[Payout]
    has_more: bool


class SubscriptionList(TypedDict):
    object: Literal["list"]
    data: list[Subscription]
    has_more: bool


class TokenList(TypedDict):
    """Every coin at once; unlike other lists it has no pages and no ``has_more``."""

    object: Literal["list"]
    data: list[Token]


WebhookEventType = Literal[
    "invoice.detected",
    "invoice.paid",
    "invoice.underpaid",
    "invoice.refunded",
    "invoice.failed",
    "invoice.expired",
    "invoice.extra_payment",
    "subscription.invoice_created",
    "refund.completed",
    "refund.failed",
    "refund.canceled",
    "payout.completed",
    "payout.failed",
    "payout.canceled",
    "support_case.created",
    "test.ping",
]


class WebhookEvent(TypedDict):
    """A verified webhook event; by type, ``data`` holds ``invoice`` (and ``payment``), ``refund``, ``payout``,
    ``support_case`` with ``invoice``, or ``message`` for ``test.ping``."""

    id: str
    type: WebhookEventType
    mode: Mode
    created_at: str
    data: dict[str, Any]
