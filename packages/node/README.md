# <img src="https://github.com/forcequitx/solverr/raw/main/app/icon.svg" alt="Solverr" width="30" height="30"> solverr-node

**The Node.js server SDK for the Solverr crypto payment API.**

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/lightbulb.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Overview

Your server uses this SDK to create invoices, payment links, refunds, payouts, subscriptions and credit charges, to list the coins the checkout accepts, and to verify the signed webhooks Solverr sends.

- **Checkout:** your server calls `solverr.invoices.create` -> the customer pays at the invoice's `checkout_url`.
- **Webhooks:** Solverr sends a signed `invoice.paid` event -> `webhooks.verify` checks it and returns the event.
- **Paid content:** `solverr.invoices.redeem` marks a paid invoice as used -> one payment grants access only once.

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/package.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Install

The SDK has no runtime dependencies and needs Node 22.12 or later.

```bash
npm install solverr-node
```

The package is an ES module. Load it with `import`. From CommonJS, `require("solverr-node")` also works, because Node 22.12 and later load ES modules through `require()`. In a TypeScript CommonJS project, set `module` to `nodenext` or `node20` in `tsconfig.json` so the compiler accepts that `require()`.

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/terminal.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Quick Start

Create an invoice and send the customer to checkout:

```ts
import { Solverr } from "solverr-node";

const solverr = new Solverr({
  apiKey: process.env.SOLVERR_SECRET_KEY, // sk_live_…
  baseUrl: process.env.SOLVERR_URL, // the origin of your Solverr app
});

const invoice = await solverr.invoices.create({
  amount: "25.00",
  currency: "USD",
  order_id: "1042",
  redirect_url: "https://shop.example/thanks",
});

// Redirect the customer to invoice.checkout_url
```

`baseUrl` can be left out when the `SOLVERR_URL` environment variable is set. It must be an https URL. Plain http works only for `localhost`, `127.0.0.1` and `[::1]`, so your API key never travels unencrypted. Request and response fields use the API's own names (`order_id`, `checkout_url`), so the API reference applies as written.

Every key is a live key, so every invoice you create takes real payments. To see the checkout without moving real money, open the demo store at `/demo` on the Solverr app that `baseUrl` points to.

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/bell.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Webhooks

Confirm a payment with a webhook. Pass the raw request body exactly as it arrived: parsed and re-serialized JSON will not match the signature.

```ts
import express from "express";
import { Webhooks, WebhookVerificationError } from "solverr-node";

const webhooks = new Webhooks();
const app = express();

app.post("/webhooks/solverr", express.raw({ type: "application/json" }), (req, res) => {
  let event;
  try {
    event = webhooks.verify(req.body, req.headers, process.env.SOLVERR_WEBHOOK_SECRET!);
  } catch (error) {
    if (error instanceof WebhookVerificationError) return res.status(400).send(error.message);
    throw error;
  }

  if (event.type === "invoice.paid") {
    markOrderPaid(event.data.invoice.order_id);
  }
  res.sendStatus(200);
});
```

In a Next.js route handler, use `await request.text()` as the body and `request.headers` as the headers.

`new Webhooks()` needs no API key, so your webhook endpoint does not need one either. If you already have a client, `solverr.webhooks.verify` does the same check.

### How `verify` checks an event

- `verify` checks the Standard Webhooks signature. The `webhook-signature` header holds `v1,` and the base64 HMAC-SHA256 of `id.timestamp.body` (`webhook-id`, `webhook-timestamp` and the raw body). The HMAC key is the part of the secret after `whsec_`, decoded from base64.
- Any `v1` entry may match, so events signed with both secrets during a rotation still pass.
- The comparison is timing-safe.
- It rejects events whose `webhook-timestamp` is more than 300 seconds from now. Change that window with `{ toleranceSeconds }`.
- The same event can arrive more than once, so use `event.id` to skip events you already handled.

Each business has one webhook URL and one signing secret.

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/boxes.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Resources

| Call | Endpoint |
| --- | --- |
| `invoices.create(params, { idempotencyKey? })` | `POST /api/v1/invoices` |
| `invoices.retrieve(id)` | `GET /api/v1/invoices/:id` |
| `invoices.list({ limit?, starting_after?, status? })` | `GET /api/v1/invoices` |
| `invoices.listAll(params?)` | Async iterator over every matching invoice, fetching the next page as the loop goes on |
| `invoices.redeem(id)` | `POST /api/v1/invoices/:id/redeem` |
| `paymentLinks.create({ title, amount?, currency, redirect_url? })`, `paymentLinks.list()` | `/api/v1/payment-links` |
| `paymentLinks.deactivate(id)` | `DELETE /api/v1/payment-links/:id` |
| `refunds.create({ invoice_id, payment_id?, amount? })`, `refunds.list()` | `/api/v1/refunds` |
| `payouts.create({ recipient, asset_id, amount })`, `payouts.list()` | `/api/v1/payouts` |
| `payouts.createBatch({ payouts: [{ recipient, asset_id, amount }, …] })` | `POST /api/v1/payouts/batch` |
| `refunds.retrieve(id)`, `payouts.retrieve(id)` | `GET /api/v1/refunds/:id`, `GET /api/v1/payouts/:id` |
| `refunds.cancel(id)`, `payouts.cancel(id)` | `POST /api/v1/refunds/:id/cancel`, `POST /api/v1/payouts/:id/cancel` |
| `subscriptions.create({ customer_email, amount, currency, interval, description? })`, `subscriptions.list()` | `/api/v1/subscriptions` |
| `subscriptions.cancel(id)` | `DELETE /api/v1/subscriptions/:id` |
| `credits.topup({ amount, currency: "USD", credit_account_id? })` | `POST /api/v1/credits/topup` |
| `credits.charge({ token, amount, currency?, description? })` | `POST /api/v1/credits/charge` |
| `credits.refundCharge(id)` | `POST /api/v1/credits/charges/:id/refund` |
| `tokens.list()` | `GET /api/v1/tokens` |
| `webhooks.sendTest()` | `POST /api/v1/webhooks/test` |
| `webhooks.verify(rawBody, headers, secret, { toleranceSeconds? })` | Local check, no request |

Every `create`, `createBatch`, `topup`, `charge`, `refundCharge` and `redeem` call, and `refunds.cancel` and `payouts.cancel`, takes `{ idempotencyKey }` as its last argument.

### Refunds and payouts

`refunds.create` refunds the payment that paid the invoice. To refund an extra payment on the same invoice, pass its id as `payment_id`. Leave out `amount` to refund what is left of that payment.

The `asset_id` of a payout is the coin the recipient receives. Take it from `tokens.list()`, which returns every coin the checkout accepts, with its chain, decimals and USD price.

### Lists and pages

Every list call except `tokens.list()` returns `{ object: "list", data, has_more }`. To get the next page, pass the last item's id as `starting_after`.

`tokens.list()` returns every coin in one `{ object: "list", data }` response, without pages.

### Grant access once per paid invoice

`invoices.redeem(id)` marks a paid invoice as used. Call it before you deliver a download or show paid content, so one payment cannot be used twice.

```ts
import { SolverrError } from "solverr-node";

try {
  await solverr.invoices.redeem(invoiceId);
  // deliver the content
} catch (error) {
  if (error instanceof SolverrError && error.status === 409) {
    // error.type is "invalid_state" (not paid) or "already_redeemed"
  }
}
```

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/triangle-alert.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Errors and Retries

API errors throw `SolverrError` with these properties:

| Property | Meaning |
| --- | --- |
| `status` | The HTTP status, or `0` when the API cannot be reached. |
| `type` | The error type, or `connection_error` when the API cannot be reached. |
| `message` | The error message. |
| `param` | The invalid field, when a field is invalid. |
| `code` | A finer reason, when the API adds one. None of the endpoints this SDK calls send one today. |
| `retryAfter` | The seconds the API asked you to wait, on a `429` for example. |

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

A key can have 1 to 255 characters. A key with a line break, NUL or a character above U+00FF throws a `TypeError` before anything is sent.

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/shield-check.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Tests

The tests in `tests/` run with Vitest and never reach a network: `fetch` is replaced by a stub, and retry waits and timeouts run on fake timers.

```bash
cd packages/node
npm ci                                  # install the pinned dev dependencies
npx vitest run                          # run every test
npx tsc --noEmit -p tests/tsconfig.json # type-check the tests
```

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/file-text.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> License

Released under the **MIT License**.
