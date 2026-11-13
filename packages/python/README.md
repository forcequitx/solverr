# <img src="https://github.com/forcequitx/solverr/raw/main/app/icon.svg" alt="Solverr" width="30" height="30"> solverr

**The Python server SDK for the Solverr crypto payment API.**

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/lightbulb.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Overview

Your server uses this SDK to create invoices, payment links, refunds, payouts, subscriptions and credit charges, to list the coins the checkout accepts, and to verify the signed webhooks Solverr sends.

- **Checkout:** your server calls `client.invoices.create` -> the customer pays at the invoice's `checkout_url`.
- **Webhooks:** Solverr sends a signed `invoice.paid` event -> `solverr.webhooks.verify` checks it and returns the event.
- **Paid content:** `client.invoices.redeem` marks a paid invoice as used -> one payment grants access only once.

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/package.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Install

The SDK needs Python 3.11 or later, uses only the standard library, and ships type hints.

```bash
pip install solverr
```

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/terminal.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Quick Start

Create an invoice and send the customer to checkout:

```python
import os

from solverr import Solverr

client = Solverr(
    api_key=os.environ["SOLVERR_SECRET_KEY"],  # sk_live_…
    base_url=os.environ["SOLVERR_URL"],  # the origin of your Solverr app
)

invoice = client.invoices.create(
    amount="25.00",
    currency="USD",
    order_id="1042",
    redirect_url="https://shop.example/thanks",
)

# Redirect the customer to invoice["checkout_url"]
```

`base_url` can be left out when the `SOLVERR_URL` environment variable is set. It must be an https URL. Plain http works only for `localhost`, `127.0.0.1` and `[::1]`, so your API key never travels unencrypted. Arguments and response keys use the API's own field names (`order_id`, `checkout_url`), so the API reference applies as written. Responses are plain dictionaries, typed with the `TypedDict` classes in `solverr.types`.

Every key is a live key, so every invoice you create takes real payments. To see the checkout without moving real money, open the demo store at `/demo` on the Solverr app that `base_url` points to.

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/bell.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Webhooks

Confirm a payment with a webhook. Pass the raw request body exactly as it arrived: parsed and re-serialized JSON will not match the signature.

```python
import os

from flask import Flask, request

import solverr

app = Flask(__name__)


@app.post("/webhooks/solverr")
def solverr_webhook():
    try:
        event = solverr.webhooks.verify(
            request.get_data(),
            request.headers,
            os.environ["SOLVERR_WEBHOOK_SECRET"],
        )
    except solverr.WebhookVerificationError as error:
        return str(error), 400

    if event["type"] == "invoice.paid":
        mark_order_paid(event["data"]["invoice"]["order_id"])
    return "", 200
```

In Django, pass `request.body` and `request.headers`. In FastAPI or Starlette, pass `await request.body()` and `request.headers`.

### How `verify` checks an event

- `verify` checks the Standard Webhooks signature. The `webhook-signature` header holds `v1,` and the base64 HMAC-SHA256 of `id.timestamp.body` (`webhook-id`, `webhook-timestamp` and the raw body). The HMAC key is the part of the secret after `whsec_`, decoded from base64.
- Any `v1` entry may match, so events signed with both secrets during a rotation still pass.
- It compares the exact standard base64 text with `hmac.compare_digest`, so an unpadded or URL-safe spelling of a valid signature is refused.
- It rejects events whose `webhook-timestamp` is more than 300 seconds from now. Change that window with `tolerance=`, in seconds.
- Header names can use any casing.
- The same event can arrive more than once, so use `event["id"]` to skip events you already handled.

Each business has one webhook URL and one signing secret.

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/boxes.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Resources

| Call | Endpoint |
| --- | --- |
| `invoices.create(amount=, currency=, order_id=, description=, redirect_url=, customer_email=, metadata=, expires_in=, idempotency_key=)` | `POST /api/v1/invoices` |
| `invoices.retrieve(invoice_id)` | `GET /api/v1/invoices/:id` |
| `invoices.list(limit=, starting_after=, status=)` | `GET /api/v1/invoices` |
| `invoices.list_all(limit=, starting_after=, status=)` | Iterator over every matching invoice, fetching the next page as the loop goes on |
| `invoices.redeem(invoice_id)` | `POST /api/v1/invoices/:id/redeem` |
| `payment_links.create(title=, currency=, amount=, redirect_url=)`, `payment_links.list()` | `/api/v1/payment-links` |
| `payment_links.deactivate(link_id)` | `DELETE /api/v1/payment-links/:id` |
| `refunds.create(invoice_id=, payment_id=, amount=)`, `refunds.list()` | `/api/v1/refunds` |
| `payouts.create(recipient=, asset_id=, amount=)`, `payouts.list()` | `/api/v1/payouts` |
| `payouts.create_batch(payouts=[{"recipient": …, "asset_id": …, "amount": …}, …])` | `POST /api/v1/payouts/batch` |
| `refunds.retrieve(refund_id)`, `payouts.retrieve(payout_id)` | `GET /api/v1/refunds/:id`, `GET /api/v1/payouts/:id` |
| `refunds.cancel(refund_id)`, `payouts.cancel(payout_id)` | `POST /api/v1/refunds/:id/cancel`, `POST /api/v1/payouts/:id/cancel` |
| `subscriptions.create(customer_email=, amount=, currency=, interval=, description=)`, `subscriptions.list()` | `/api/v1/subscriptions` |
| `subscriptions.cancel(subscription_id)` | `DELETE /api/v1/subscriptions/:id` |
| `credits.topup(amount=, currency=, credit_account_id=)` | `POST /api/v1/credits/topup` |
| `credits.charge(token=, amount=, currency=, description=)` | `POST /api/v1/credits/charge` |
| `credits.refund_charge(charge_id)` | `POST /api/v1/credits/charges/:id/refund` |
| `tokens.list()` | `GET /api/v1/tokens` |
| `webhooks.send_test()` | `POST /api/v1/webhooks/test` |
| `solverr.webhooks.verify(raw_body, headers, secret, tolerance=300)` | Local check, no request |

In the resource calls, every argument except an id is keyword-only. `solverr.webhooks.verify` takes its arguments by position. Every `create`, `create_batch`, `topup`, `charge`, `refund_charge` and `redeem` call, and `refunds.cancel` and `payouts.cancel`, also takes `idempotency_key=`.

Credit balances are kept in USD: `credits.topup` needs `currency="USD"`, and `credits.charge` accepts only `"USD"` when you pass a currency.

### Refunds and payouts

`refunds.create` refunds the payment that paid the invoice. To refund an extra payment on the same invoice, pass its id as `payment_id=`. Leave out `amount=` to refund what is left of that payment.

The `asset_id=` of a payout is the coin the recipient receives. Take it from `tokens.list()`, which returns every coin the checkout accepts, with its chain, decimals and USD price.

### Lists and pages

Every list call except `tokens.list()` returns `{"object": "list", "data": [...], "has_more": bool}`. To get the next page, pass the last item's id as `starting_after`, or loop over `list_all()`:

```python
for invoice in client.invoices.list_all(status="paid"):
    print(invoice["id"])
```

`tokens.list()` returns every coin in one `{"object": "list", "data": [...]}` response, without pages.

### Grant access once per paid invoice

`invoices.redeem(invoice_id)` marks a paid invoice as used. Call it before you deliver a download or show paid content, so one payment cannot be used twice.

```python
from solverr import SolverrError

try:
    client.invoices.redeem(invoice_id)
    # deliver the content
except SolverrError as error:
    if error.status == 409:
        ...  # error.type is "invalid_state" (not paid) or "already_redeemed"
    else:
        raise
```

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/triangle-alert.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Errors and Retries

API errors raise `solverr.SolverrError` with these attributes:

| Attribute | Meaning |
| --- | --- |
| `status` | The HTTP status, or `0` when the API cannot be reached. |
| `type` | The error type, or `connection_error` when the API cannot be reached. |
| `message` | The error message. |
| `param` | The invalid field, when a field is invalid. |
| `code` | A finer reason, when the API adds one. None of the endpoints this SDK calls send one today. |
| `retry_after` | The seconds the API asked you to wait, on a `429` for example. |

```python
from solverr import SolverrError

try:
    client.invoices.create(amount="0", currency="USD")
except SolverrError as error:
    print(error.status, error.type, error.param, error.message)
    # 400 invalid_request amount amount must be greater than 0.
```

### Timeouts and retries

Each attempt allows 15 seconds to connect and 15 seconds for each wait on the network. The SDK stops reading the response body once 15 seconds have passed since the attempt began.

| Response | How the SDK retries |
| --- | --- |
| A timeout, a network error or a 5xx response | Twice, with a growing delay. |
| A `429` (rate limit), or a `409` that says an earlier request with the same `Idempotency-Key` is still being processed | Up to three times, after the wait in its `Retry-After` header. When `Retry-After` asks for more than 10 seconds, the error is raised right away. |

With those retries, one call ends after about 47 seconds when the server does not answer at all. A slow connection or slow response headers can make it longer, and `Retry-After` retries add to that.

### Idempotency keys

Every POST carries an `Idempotency-Key` header. The SDK generates one when you do not pass one, and every retry sends the same key, so a retried POST never creates a second object. Pass your own key to make retries across process restarts safe too.

A key belongs to the business for 24 hours and covers every endpoint. Give each operation its own key, for example `invoice-order-1042` for the invoice of order 1042 and `refund-order-1042` for its refund, not the order id alone. If you send a key again with a different request (another body or another endpoint), the API answers `409` with type `idempotency_conflict`, and the SDK raises it without a retry.

```python
invoice = client.invoices.create(
    amount="25.00",
    currency="USD",
    order_id="1042",
    idempotency_key="invoice-order-1042",
)
```

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/shield-check.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Tests

The tests use only the standard library (`unittest`) and need no install step: `tests/__init__.py` puts `src` on the import path. HTTP tests run against a local server on `127.0.0.1` and never reach a real host. Webhook tests generate their own secrets. From this folder, run:

```bash
python -I -m unittest
```

CI names the test folder explicitly: `python -I -m unittest discover -s tests -t .`. The `-t .` makes `tests` load as a package.

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/file-text.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> License

Released under the **MIT License**.
