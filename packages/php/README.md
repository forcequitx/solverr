# <img src="https://github.com/forcequitx/solverr/raw/main/app/icon.svg" alt="Solverr" width="30" height="30"> solverr/solverr-php

**The PHP server SDK for the Solverr crypto payment API.**

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/lightbulb.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Overview

Your server uses this SDK to create invoices, payment links, refunds, payouts, subscriptions and credit charges, to list the coins the checkout accepts, and to verify the signed webhooks Solverr sends.

- **Checkout:** your server calls `$solverr->invoices->create` -> the customer pays at the invoice's `checkout_url`.
- **Webhooks:** Solverr sends a signed `invoice.paid` event -> `Webhook::verify` checks it and returns the event.
- **Paid content:** `$solverr->invoices->redeem` marks a paid invoice as used -> one payment grants access only once.

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/package.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Install

The SDK needs PHP 8.3 or later with the `curl` and `json` extensions, and has no other dependencies.

```bash
composer require solverr/solverr-php
```

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/terminal.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Quick Start

Create an invoice and send the customer to checkout:

```php
<?php

require __DIR__ . '/vendor/autoload.php';

$solverr = new Solverr\Client([
    'api_key' => getenv('SOLVERR_SECRET_KEY'), // sk_live_…
    'base_url' => getenv('SOLVERR_URL'),       // the origin of your Solverr app
]);

$invoice = $solverr->invoices->create([
    'amount' => '25.00',
    'currency' => 'USD',
    'order_id' => '1042',
    'redirect_url' => 'https://shop.example/thanks',
]);

header('Location: ' . $invoice['checkout_url'], true, 303);
```

`base_url` can be left out when the `SOLVERR_URL` environment variable is set. It must be an https URL. Plain http works only for `localhost`, `127.0.0.1` and `[::1]`, so your API key never travels unencrypted. Requests and responses are plain PHP arrays with the API's own field names (`order_id`, `checkout_url`), so the API reference applies as written.

Every key is a live key, so every invoice you create takes real payments. To see the checkout without moving real money, open the demo store at `/demo` on the Solverr app that `base_url` points to.

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/bell.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Webhooks

Confirm a payment with a webhook. Pass the raw request body exactly as it arrived: decoded and re-encoded JSON will not match the signature.

```php
<?php

require __DIR__ . '/vendor/autoload.php';

use Solverr\Exception\WebhookVerificationException;
use Solverr\Webhook;

try {
    $event = Webhook::verify(
        file_get_contents('php://input'),
        getallheaders(),
        getenv('SOLVERR_WEBHOOK_SECRET'),
    );
} catch (WebhookVerificationException $error) {
    http_response_code(400);
    echo $error->getMessage();
    exit;
}

if ($event['type'] === 'invoice.paid') {
    markOrderPaid($event['data']['invoice']['order_id']);
}
http_response_code(200);
```

In Laravel or Symfony, pass `$request->getContent()` as the body and `$request->headers->all()` as the headers. With PSR-7, pass `(string) $request->getBody()` and `$request->getHeaders()`.

### How `verify` checks an event

- `verify` checks the Standard Webhooks signature. The `webhook-signature` header holds `v1,` and the base64 HMAC-SHA256 of `id.timestamp.body` (`webhook-id`, `webhook-timestamp` and the raw body). The HMAC key is the part of the secret after `whsec_`, decoded from base64.
- Any `v1` entry may match, so events signed with both secrets during a rotation still pass.
- It compares with `hash_equals`.
- It rejects events whose `webhook-timestamp` is more than 300 seconds from now. Change that window with the fourth argument, in seconds.
- Header names can use any casing.
- The same event can arrive more than once, so use `$event['id']` to skip events you already handled.

Each business has one webhook URL and one signing secret.

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/boxes.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Resources

| Call | Endpoint |
| --- | --- |
| `invoices->create($params, ['idempotency_key' => …])` | `POST /api/v1/invoices` |
| `invoices->retrieve($id)` | `GET /api/v1/invoices/:id` |
| `invoices->list(['limit' => …, 'starting_after' => …, 'status' => …])` | `GET /api/v1/invoices` |
| `invoices->listAll($params)` | Generator over every matching invoice, fetching the next page as the loop goes on |
| `invoices->redeem($id)` | `POST /api/v1/invoices/:id/redeem` |
| `paymentLinks->create(['title', 'amount'?, 'currency', 'redirect_url'?])`, `paymentLinks->list()` | `/api/v1/payment-links` |
| `paymentLinks->deactivate($id)` | `DELETE /api/v1/payment-links/:id` |
| `refunds->create(['invoice_id', 'payment_id'?, 'amount'?])`, `refunds->list()` | `/api/v1/refunds` |
| `payouts->create(['recipient', 'asset_id', 'amount'])`, `payouts->list()` | `/api/v1/payouts` |
| `payouts->createBatch(['payouts' => [['recipient', 'asset_id', 'amount'], …]])` | `POST /api/v1/payouts/batch` |
| `refunds->retrieve($id)`, `payouts->retrieve($id)` | `GET /api/v1/refunds/:id`, `GET /api/v1/payouts/:id` |
| `refunds->cancel($id)`, `payouts->cancel($id)` | `POST /api/v1/refunds/:id/cancel`, `POST /api/v1/payouts/:id/cancel` |
| `subscriptions->create(['customer_email', 'amount', 'currency', 'interval', 'description'?])`, `subscriptions->list()` | `/api/v1/subscriptions` |
| `subscriptions->cancel($id)` | `DELETE /api/v1/subscriptions/:id` |
| `credits->topup(['amount', 'currency' => 'USD', 'credit_account_id'?])` | `POST /api/v1/credits/topup` |
| `credits->charge(['token', 'amount', 'currency'?, 'description'?])` | `POST /api/v1/credits/charge` |
| `credits->refundCharge($id)` | `POST /api/v1/credits/charges/:id/refund` |
| `tokens->list()` | `GET /api/v1/tokens` |
| `webhooks->sendTest()` | `POST /api/v1/webhooks/test` |
| `Webhook::verify($rawBody, $headers, $secret, $tolerance = 300)` | Local check, no request |

Every `create`, `createBatch`, `topup`, `charge`, `refundCharge` and `redeem` call, and `refunds->cancel` and `payouts->cancel`, takes an optional second argument, `['idempotency_key' => '…']`.

### Refunds and payouts

`refunds->create` refunds the payment that paid the invoice. To refund an extra payment on the same invoice, pass its id as `payment_id`. Leave out `amount` to refund what is left of that payment.

The `asset_id` of a payout is the coin the recipient receives. Take it from `tokens->list()`, which returns every coin the checkout accepts, with its chain, decimals and USD price.

### Lists and pages

Every list call except `tokens->list()` returns `['object' => 'list', 'data' => [...], 'has_more' => bool]`. To get the next page, pass the last item's id as `starting_after`, or loop over `listAll()`:

```php
foreach ($solverr->invoices->listAll(['status' => 'paid']) as $invoice) {
    echo $invoice['id'], PHP_EOL;
}
```

`tokens->list()` returns every coin in one `['object' => 'list', 'data' => [...]]` response, without pages.

### Grant access once per paid invoice

`invoices->redeem($id)` marks a paid invoice as used. Call it before you deliver a download or show paid content, so one payment cannot be used twice.

```php
use Solverr\Exception\ApiException;

try {
    $solverr->invoices->redeem($invoiceId);
    // deliver the content
} catch (ApiException $error) {
    if ($error->status === 409) {
        // $error->type is "invalid_state" (not paid) or "already_redeemed"
    }
}
```

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/triangle-alert.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Errors and Retries

API errors throw `Solverr\Exception\ApiException` with these public properties, and the message from `getMessage()`:

| Property | Meaning |
| --- | --- |
| `status` | The HTTP status, or `0` when the API cannot be reached. |
| `type` | The error type, or `connection_error` when the API cannot be reached. |
| `param` | The invalid field, when a field is invalid. |
| `errorCode` | The API's `code`: a finer reason, set when the API adds one. None of the endpoints this SDK calls send one today. |
| `retryAfter` | The seconds the API asked you to wait, on a `429` for example. |

```php
use Solverr\Exception\ApiException;

try {
    $solverr->invoices->create(['amount' => '0', 'currency' => 'USD']);
} catch (ApiException $error) {
    echo $error->status, ' ', $error->type, ' ', $error->param, ': ', $error->getMessage();
    // 400 invalid_request amount: amount must be greater than 0.
}
```

Text you send must be valid UTF-8. Other text, such as ISO-8859-1 from an older database, throws PHP's `\JsonException` before anything is sent, so convert it with `mb_convert_encoding()` first.

### Timeouts and retries

Each attempt times out after 15 seconds, counting the response headers and body.

| Response | How the SDK retries |
| --- | --- |
| A timeout, a network error or a 5xx response | Twice, with a growing delay. |
| A `429` (rate limit), or a `409` that says an earlier request with the same `Idempotency-Key` is still being processed | Up to three times, after the wait in its `Retry-After` header. When `Retry-After` asks for more than 10 seconds, the error is thrown right away. |

With those retries, one call can take up to about 47 seconds for timeouts and 5xx responses. `Retry-After` retries add to that.

### Idempotency keys

Every POST carries an `Idempotency-Key` header. The SDK generates one when you do not pass one, and every retry sends the same key, so a retried POST never creates a second object. Pass your own key to make retries across process restarts safe too.

A key belongs to the business for 24 hours and covers every endpoint. Give each operation its own key, for example `invoice-order-1042` for the invoice of order 1042 and `refund-order-1042` for its refund, not the order id alone. If you send a key again with a different request (another body or another endpoint), the API answers `409` with type `idempotency_conflict`, and the SDK throws it without a retry.

```php
$invoice = $solverr->invoices->create(
    ['amount' => '25.00', 'currency' => 'USD', 'order_id' => '1042'],
    ['idempotency_key' => 'invoice-order-1042'],
);
```

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/shield-check.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Tests

The tests use PHPUnit, which is listed in `require-dev`. HTTP tests start a `php -S` server on `127.0.0.1` from `tests/Support/router.php` and never reach a real host. Webhook tests generate their own secrets. From this folder, run:

```bash
composer install
vendor/bin/phpunit
```

Without a local PHP, use Docker. Composer resolves the packages, and PHPUnit runs on PHP 8.3, the oldest version the SDK supports. On Windows Git Bash, put `MSYS_NO_PATHCONV=1` before each command and give the folder as a Windows path:

```bash
docker run --rm -v "$PWD:/app" -w /app composer:2 composer install
docker run --rm -v "$PWD:/app" -w /app php:8.3-cli vendor/bin/phpunit
```

The 15-second request timeout is a class constant, so the tests do not exercise it. Waiting for it would take more than 45 seconds per test.

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/file-text.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> License

Released under the **MIT License**.
