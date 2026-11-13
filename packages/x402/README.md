# <img src="https://github.com/forcequitx/solverr/raw/main/app/icon.svg" alt="Solverr" width="30" height="30"> solverr-x402

**x402 v2 paywall for Next.js and Express that charges AI agents per request through Solverr.**

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/lightbulb.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Overview

`solverr-x402` charges AI agents per request with [x402 v2](https://github.com/x402-foundation/x402) and Solverr. Agents pay with a coin they hold on NEAR, Base or another supported chain, and you receive the coin you chose in your own wallet.

- **`solverr` payments:** a request without payment gets a 402 that names a Solverr invoice -> the agent pays the invoice, and the paid invoice pays for one request. Each payment is single-use.
- **Standard x402 (optional):** set `exact` -> the 402 also offers the standard `exact` scheme for USDC on Base, Ethereum, Arbitrum, Polygon or Avalanche, so any standard x402 client can pay (see Standard x402 below).
- **Prepaid credits (optional):** set `credits: true` -> the paywall also accepts `Authorization: Bearer solverr_credit_…`.

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/puzzle.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Compatibility

| Item | Details |
| --- | --- |
| **Frameworks** | Works as a Next.js App Router route export (any Web `Request` → `Response` handler) and as Express middleware. |
| **Protocol** | Uses the x402 v2 headers `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE` and `PAYMENT-RESPONSE` (base64 JSON) with a custom scheme named `solverr`. |
| **Dependency** | One runtime dependency, [`@x402/core`](https://www.npmjs.com/package/@x402/core), for the x402 types, the header encoders and decoders, and the facilitator client. The package re-exports the types and the header functions (`encodePaymentRequiredHeader`, `decodePaymentSignatureHeader`, …), and `readHeader(value, decoder)` returns `undefined` instead of throwing for a missing or malformed header. |
| **Runtimes** | Node 22.12 or later. `paywall(...)` uses only Web-standard APIs (`fetch`, `crypto.randomUUID`, `TextEncoder`, `btoa`/`atob`), so it also runs on Bun, Deno and edge runtimes. `paywallExpress(...)` needs Node. |

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/package.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Install

```bash
npm install solverr-x402
```

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/terminal.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Quick Start

### Next.js route

```ts
// app/api/premium/route.ts
import { paywall } from "solverr-x402";

export const GET = paywall(
  {
    price: "0.05",
    currency: "USD",
    apiKey: process.env.SOLVERR_SECRET_KEY!,
    baseUrl: process.env.SOLVERR_URL!, // your Solverr app, for example https://pay.example.com
    description: "Premium market data",
  },
  async () => Response.json({ data: "premium" }),
);
```

### Express

```ts
import express from "express";
import { paywallExpress, priceList, expressHandler } from "solverr-x402";

const app = express();
const priced = { price: "0.05", currency: "USD", apiKey: process.env.SOLVERR_SECRET_KEY!, baseUrl: process.env.SOLVERR_URL! } as const;

app.get("/premium", paywallExpress(priced), (req, res) => res.json({ data: "premium" }));

app.get(
  "/.well-known/solverr.json",
  expressHandler(priceList([{ path: "/premium", method: "GET", price: "0.05", currency: "USD", description: "Premium market data" }], { merchant: "Acme Data" })),
);
```

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/list.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Price List

`priceList(routes, { merchant })` returns a handler that serves `/.well-known/solverr.json`, so agents can see prices before calling:

```json
{ "version": 1, "merchant": "Acme Data", "endpoints": [{ "path": "/premium", "method": "GET", "price": "0.05", "currency": "USD", "description": "Premium market data" }] }
```

In Next.js, export it from `app/.well-known/solverr.json/route.ts`: `export const GET = priceList([...])`.

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/settings.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Options

| Option | Required | Meaning |
| --- | --- | --- |
| `price` | yes | Decimal string with up to 2 decimals, for example `"0.05"` |
| `currency` | yes | `USD`, `EUR` or `INR` |
| `apiKey` | yes | Solverr API key, `sk_live_…` |
| `baseUrl` | yes | Base URL of the Solverr app; https, or http only for `localhost`, `127.0.0.1` or `[::1]` |
| `description` | no | Shown on the invoice and the credit charge; defaults to `Access to GET /premium` on the invoice and `GET /premium` on the credit charge (the request's method and path) |
| `credits` | no | `true` to also accept credit tokens. Needs `currency: "USD"`, because credit balances are kept in USD |
| `expiresIn` | no | Invoice lifetime in seconds, 900–86400 (default 900) |
| `timeoutMs` | no | Timeout of each attempt of a Solverr API call (default 10 s). Network errors, timeouts, a success answer that is not JSON, 429, 5xx and a 409 for an Idempotency-Key still in progress are retried up to twice. Other errors fail at once, and so does a `Retry-After` longer than 5 s |
| `exact` | no | Also accept standard x402 `exact` payments in USDC (Base by default). Needs `currency: "USD"`. See Standard x402 (exact in USDC) below |
| `discovery` | no | Bazaar discovery metadata (`info` and its JSON `schema`) sent in every 402. See Bazaar Discovery below |
| `challengeLimit` | no | `{ key: (request) => string \| undefined, perMinute }`. Each 402 creates an invoice, and a key can create 1200 a minute. This option caps challenges per client. Name the client by the IP your own proxy sets, not a header the client can choose. Past the cap, the paywall answers 429 with `Retry-After` and creates no invoice. A client over the cap is refused before any Solverr call, so fake payment headers cannot spend your key's limits either |
| `claimStore` | no | Where the paywall keeps its payment claims. Defaults to memory, which covers one server process. On serverless hosts or with several processes, pass one shared store (`RedisClaimStore`, `PostgresClaimStore` or your own). See Several Instances and Serverless below |

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/workflow.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> How a Paid Request Works

A `solverr` payment passes between the agent, your API (`solverr-x402`) and Solverr like this:

1. The agent sends `GET /premium` to your API.
2. Your API creates an invoice with `POST /api/v1/invoices`, with `metadata.solverr_resource` set to `"GET /premium"`.
3. Your API answers `402` with a `PAYMENT-REQUIRED` header whose `accepts[0].scheme` is `"solverr"`.
4. The agent pays the invoice through Solverr: it gets a quote, sends the transfer, reports the deposit and waits until the invoice is paid.
5. The agent sends `GET /premium` again with a `PAYMENT-SIGNATURE` header that holds `{ payload: { invoice_id } }`.
6. Your API reads the invoice from Solverr and checks its resource, its price and that it is paid.
7. Your handler runs.
8. Only when your handler answered below 400, your API redeems the invoice with `POST /api/v1/invoices/:id/redeem`.
9. The agent gets `200` with a `PAYMENT-RESPONSE` header and your data.

### The `solverr` payment requirement

```json
{
  "scheme": "solverr",
  "network": "eip155:8453",
  "amount": "50000",
  "asset": "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
  "payTo": "inv_…",
  "maxTimeoutSeconds": 899,
  "extra": {
    "invoice_id": "inv_…",
    "mode": "live",
    "checkout_url": "https://…/pay/inv_…",
    "quote_url": "https://…/api/v1/invoices/inv_…/quote",
    "deposit_url": "https://…/api/v1/invoices/inv_…/deposit",
    "status_url": "https://…/api/v1/invoices/inv_…/status",
    "price": "0.05",
    "currency": "USD",
    "settlement": { "asset_id": "…", "symbol": "USDC", "blockchain": "base", "amount": "0.05" },
    "expires_at": "…",
    "credits": true
  }
}
```

- `network`, `asset` and `amount` describe what your business receives (CAIP-2 network, 1Click asset ID, base units). A chain without a CAIP-2 ID gets `solverr:<code>`, where `<code>` is its 1Click blockchain code.
- `payTo` is the invoice ID. The payer gets a one-time deposit address for the coin it chooses from `quote_url`.
- The client answers with `PAYMENT-SIGNATURE` = base64 of `{ "x402Version": 2, "accepted": <the requirement>, "payload": { "invoice_id": "inv_…" } }`.

### Responses

| Situation | Status | Headers |
| --- | --- | --- |
| No payment | 402 | `PAYMENT-REQUIRED` |
| Invoice unpaid, already used, for another path, or for another price | 402 | `PAYMENT-RESPONSE` (`success: false`, `errorReason`) and a new `PAYMENT-REQUIRED` |
| `PAYMENT-SIGNATURE` that is not base64 JSON, or has no valid `payload.invoice_id` | 400 | |
| `PAYMENT-SIGNATURE` with another x402 version or scheme | 402 | `PAYMENT-RESPONSE` (`success: false`, `errorReason`) and a new `PAYMENT-REQUIRED` |
| Paid | handler's status | `PAYMENT-RESPONSE` (`success: true`, `transaction`, `network`, `amount`, `payer`; see below) |
| Credit token charged | handler's status | `Solverr-Credit-Balance` when the handler answers below 400 (otherwise the charge is refunded) |
| Solverr unreachable, an answer that is not JSON, or a `claimStore` that fails to claim | 503 | `Retry-After: 5`. The reason is logged with `console.error` |
| API key rejected, Solverr refuses to create the invoice (for example because the coin you receive is not supported), or `baseUrl` answers with a redirect | 500 | When the invoice cannot be created, Solverr's reason is logged with `console.error`; a redirect names the address it points to. A key rejected later, while reading or redeeming the invoice or charging credits, is not logged |

For a paid `solverr` invoice, `PAYMENT-RESPONSE` holds these fields:

| Field | Meaning |
| --- | --- |
| `transaction` | The transaction that delivered the payment to your business wallet, or `""` for a private payment or when no delivery is recorded. |
| `network` | The CAIP-2 network your business receives on. |
| `amount` | What your business receives, in base units. |
| `payer` | The payer's refund address. It is left out when Solverr returns no payment for the invoice. |

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/badge-dollar-sign.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Standard x402 (exact in USDC)

Set `exact` and the 402 lists a second payment option: the standard x402 `exact` scheme for native USDC, on Base mainnet unless you choose another network. Standard x402 clients, such as `@x402/fetch` or `@x402/axios` with `@x402/evm`, skip the `solverr` entry they don't know and pay this one. USDC goes straight to your `payTo` address. Solverr plays no part in the payment.

| `exact` field | Required | Meaning |
| --- | --- | --- |
| `payTo` | yes | Your EVM address that receives USDC on `network` |
| `facilitatorUrl` | yes | An x402 facilitator that supports `exact` on `network` |
| `network` | no | The CAIP-2 network USDC is paid on: `"eip155:8453"` (Base, the default), `"eip155:1"` (Ethereum), `"eip155:42161"` (Arbitrum One), `"eip155:137"` (Polygon) or `"eip155:43114"` (Avalanche C-Chain). `EXACT_USDC` lists the USDC contract and EIP-712 domain of each, the same as the default assets of `@x402/evm` |
| `createAuthHeaders` | no | Facilitator auth headers keyed by path (`verify`, `settle`), the format `@x402/core` uses |
| `timeoutMs` | no | Timeout per facilitator call (default 30 s) |

The route's price must be in USD. `price: "0.05"` becomes `amount: "50000"` (USDC has 6 decimals). The paywall throws when it is created if `currency` is not `USD`.

### Facilitators on mainnet

The public `https://x402.org/facilitator` is **testnet only** (Base Sepolia and other test networks). The x402 docs say it "is not intended for mainnet routes". For mainnet, use a facilitator that supports `exact` on the network you choose. For Base mainnet you can use one of these:

| Facilitator | Details |
| --- | --- |
| **Coinbase CDP facilitator** | `https://api.cdp.coinbase.com/platform/v2/x402`. It supports `exact` on `eip155:8453` and needs a CDP API key. CDP's docs say the first 1,000 transactions each month are free, then each one costs $0.001. |
| **Others on the x402 list** | Other facilitators that the [x402 facilitator list](https://docs.x402.org/dev-tools/facilitators) names for Base mainnet, such as X Pay, Mogami and the NEAR x402 Facilitator. Check each one's terms and authentication before you use it. |
| **Your own** | A facilitator you host yourself. |

### Example with the CDP facilitator

```ts
// app/api/premium/route.ts
import { paywall } from "solverr-x402";
import { createFacilitatorConfig } from "@coinbase/x402";

const cdp = createFacilitatorConfig(process.env.CDP_API_KEY_ID, process.env.CDP_API_KEY_SECRET);

export const GET = paywall(
  {
    price: "0.05",
    currency: "USD",
    apiKey: process.env.SOLVERR_SECRET_KEY!,
    baseUrl: process.env.SOLVERR_URL!,
    exact: {
      payTo: "0xYourBaseAddress",
      facilitatorUrl: cdp.url!,
      createAuthHeaders: cdp.createAuthHeaders,
    },
  },
  async () => Response.json({ data: "premium" }),
);
```

`paywallExpress(...)` takes the same options.

### The `exact` payment requirement

```json
{
  "scheme": "exact",
  "network": "eip155:8453",
  "amount": "50000",
  "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "payTo": "0xYourBaseAddress",
  "maxTimeoutSeconds": 300,
  "extra": { "name": "USD Coin", "version": "2" }
}
```

`extra.name` and `extra.version` are the EIP-712 domain of USDC on the chosen network. The payer signs an EIP-3009 `transferWithAuthorization` for exactly `amount` to `payTo`.

### How an `exact` payment works

An `exact` payment passes between the agent (a standard x402 client), your API (`solverr-x402`) and the facilitator like this:

1. The agent, any standard x402 client, sends `GET /premium` to your API.
2. Your API answers `402` with a `PAYMENT-REQUIRED` header that accepts both `solverr` and `exact`.
3. The agent sends `GET /premium` again with a `PAYMENT-SIGNATURE` header that holds an `exact` payment: a signed authorization.
4. Your API asks the facilitator to check it with `POST /verify`, and the facilitator answers whether it is valid.
5. Your handler runs.
6. Only when your handler answered below 400, your API asks the facilitator to move the USDC with `POST /settle`, and the facilitator answers with the transaction.
7. The agent gets your handler's response with a `PAYMENT-RESPONSE` header.

| Situation | Status | Headers |
| --- | --- | --- |
| `accepted` differs from the current requirement (price, payTo, asset) | 402 | `PAYMENT-RESPONSE` (`invalid_payment_requirements`) and a new `PAYMENT-REQUIRED` |
| Facilitator says the payment is invalid | 402 | `PAYMENT-RESPONSE` with the facilitator's `invalidReason`, and a new `PAYMENT-REQUIRED`. Your handler does not run |
| The same payment is already unlocking another request, or was already settled | 402 | `PAYMENT-RESPONSE` (`invalid_transaction_state`) and a new `PAYMENT-REQUIRED`. Your handler does not run |
| Facilitator unreachable during verify (after 2 retries) | 503 | `Retry-After: 5`. The reason is logged with `console.error` |
| Your handler answers 400 or higher | handler's status | Nothing is settled and the payer is not charged |
| Settlement fails or times out | 402 | `PAYMENT-RESPONSE` (`errorReason`) and a new `PAYMENT-REQUIRED`. Your handler's response is discarded |
| Settled | handler's status | `PAYMENT-RESPONSE` (`success: true`, `transaction`, `network`, and `payer` and `amount` when the facilitator returns them) |

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/search.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Bazaar Discovery

The x402 [Bazaar extension](https://docs.x402.org/extensions/bazaar) lets agents find paid routes. Set `discovery` and every 402 carries it as `extensions.bazaar`:

```ts
export const GET = paywall(
  {
    price: "0.05",
    currency: "USD",
    apiKey: process.env.SOLVERR_SECRET_KEY!,
    baseUrl: process.env.SOLVERR_URL!,
    exact: { payTo: "0xYourBaseAddress", facilitatorUrl: cdp.url!, createAuthHeaders: cdp.createAuthHeaders },
    discovery: {
      info: {
        input: { type: "http", method: "GET", queryParams: { city: "Paris" } },
        output: { type: "json", example: { city: "Paris", temperature: 12 } },
      },
      schema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: {
          input: {
            type: "object",
            properties: {
              type: { type: "string", const: "http" },
              method: { type: "string", enum: ["GET"] },
              queryParams: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
            },
            required: ["type", "method"],
            additionalProperties: false,
          },
          output: { type: "object", properties: { type: { type: "string" }, example: { type: "object" } }, required: ["type"] },
        },
        required: ["input"],
      },
    },
  },
  async () => Response.json({ city: "Paris", temperature: 12 }),
);
```

A route is listed only when an agent echoes the extension in its payment and a facilitator that runs a Bazaar processes that payment. In practice that means an `exact` payment through such a facilitator, because `solverr` payments never reach a facilitator. The paywall forwards the agent's payment to the facilitator unchanged. The facilitator checks `info` against `schema` before it lists the route, so keep them in step.

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/database.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Several Instances and Serverless

Before your handler runs, the paywall claims the payment, so a copy of the same payment sent at the same time gets a 402 instead of a second handler run. By default these claims live in memory, which covers one long-running server process.

On Vercel and other serverless hosts, in a Node cluster, or with several containers, each instance has its own memory. A copy of one payment sent to several instances at once then runs your handler on each of them. Only one copy is redeemed or settled, so you are paid once, but your handler's work (database writes, emails, calls to paid APIs) happens more than once.

To prevent that, give every instance the same `claimStore`. The package includes one for Redis or Valkey and one for Postgres, with no extra dependencies: you pass in the client you already use. Both work with a server you run yourself or the free tier of a hosted service.

With a shared claim store, two copies of one payment are handled like this:

1. The agent sends `GET /premium` with a `PAYMENT-SIGNATURE` header to instance 1, and the same request with the same payment to instance 2.
2. Instance 1 claims the payment in the shared claim store and gets it.
3. Instance 2 tries to claim the same payment, and the store answers that it is already claimed.
4. Instance 2 answers `402` (`invalid_transaction_state`).
5. Your handler runs once, on instance 1, which answers `200` with a `PAYMENT-RESPONSE` header.

### Redis or Valkey

`RedisClaimStore` takes a function that sends one raw command through your client and returns its reply. It claims with `SET key <owner token> NX PX <ms>`. It renews and releases with two short Lua scripts sent through `EVAL`, which change the key only while it still holds this request's owner token. Redis deletes each key when its time runs out. Your Redis user must be allowed to run `EVAL`. Scripting is on by default, but ACL rules and hosted plans can turn it off.

```ts
// app/api/premium/route.ts, with node-redis
import { createClient } from "redis";
import { paywall, RedisClaimStore } from "solverr-x402";

const redis = await createClient({ url: process.env.REDIS_URL }).connect();
const claimStore = new RedisClaimStore((args) => redis.sendCommand(args));

export const GET = paywall(
  { price: "0.05", currency: "USD", apiKey: process.env.SOLVERR_SECRET_KEY!, baseUrl: process.env.SOLVERR_URL!, claimStore },
  async () => Response.json({ data: "premium" }),
);
```

With ioredis, pass `([name, ...args]) => redis.call(name, ...args)` instead. Keys start with `solverr:x402:claim:` followed by the SHA-256 hex of the payment's claim key (`invoice:<id>` for a `solverr` payment, or the payer and nonce of an `exact` transfer). Set `keyPrefix` in the second argument to change the start.

### Postgres

Create the table once:

```sql
CREATE TABLE x402_payment_claims (
  claim_key text PRIMARY KEY,
  owner text NOT NULL,
  expires_at timestamptz NOT NULL
);
```

Then pass any client with a `query(text, params)` method that returns `{ rows }`, such as a `pg` pool:

```ts
import pg from "pg";
import { paywall, PostgresClaimStore } from "solverr-x402";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const claimStore = new PostgresClaimStore(pool);
```

With postgres.js, wrap it: `new PostgresClaimStore({ query: async (text, params) => ({ rows: await sql.unsafe(text, params) }) })`.

- A claim inserts the row, or takes over a row whose time has run out, in one statement, so two instances can never both win. Expiry uses the database clock.
- Renewing and releasing match the `owner` column, so they never touch a row another request has taken over.
- Every 100th claim from one store also deletes expired rows. To clean up on a schedule as well, call `claimStore.prune()`.
- To use another table name or a schema, pass `{ table: "billing.x402_claims" }` as the second argument (lowercase letters, digits and `_` only).

### How the store is used

- Create one store per process and share it between all your routes. A claim names the payment, not the route.
- A claim lasts 5 minutes. After a payment is redeemed or settled, the paywall holds its claim for 5 more minutes, so a copy that read the payment just before cannot run your handler.
- Each claim gets a random owner token, and only that token can renew or release it. If your handler runs longer than 5 minutes, another copy of the payment can take the expired claim. When the older request then finishes or fails, it never frees or extends the newer request's claim.
- If the store fails while claiming, the request gets a 503 with `Retry-After: 5`, your handler does not run, and the error is logged with `console.error`. If the store fails while releasing or renewing a claim, the paywall logs the error and the claim ends on its own after 5 minutes.

To use another backend, implement the `ClaimStore` interface:

| Method | What it must do |
| --- | --- |
| `claim(key, ttlMs)` | Returns a new random owner token for exactly one caller while the key is held, and `null` for everyone else. |
| `renew(key, owner, ttlMs)` | Holds the key for `ttlMs` from now when `owner` holds it or nobody does. |
| `release(key, owner)` | Frees the key only while `owner` holds it. |

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/circle-question-mark.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Points That Cause Confusion

- **One invoice, one request, and only for a response that worked.** The paywall checks that the invoice is paid and claims it before your handler runs, then redeems it only after your handler answers below 400. If your handler throws or answers 400 or higher, the invoice stays unused. By default, claims live in memory and cover one server process. Set `claimStore` (see Several Instances and Serverless above) to cover several.
- **Credits are given back on failure.** Credits are charged before your handler runs (so an empty balance never reaches it) and refunded through `POST /api/v1/credits/charges/:id/refund` when your handler throws or answers 400 or higher. If that refund still fails after its retries, the paywall logs the charge id with `console.error`, so you can refund it yourself. Both `paywall(...)` and `paywallExpress(...)` wait for that refund, or for the release of a payment claim, before they send a response of 400 or higher, so a serverless host does not stop it halfway.
- **`exact` settles after your handler.** Your handler runs once the facilitator has verified the signature, but the USDC moves only at settle. If settlement fails, the agent gets a 402 instead of your response, even though your handler already ran. In Express, the paywall holds what your handler writes until settlement finishes.
- **One `exact` payment, one handler run.** The paywall claims each verified payment (by payer and nonce) until it is settled, so copies sent at the same time get a 402. A handler that throws or answers 400 or higher, or a settlement that fails before anything is broadcast, releases the claim. By default, claims live in memory and cover one server process. Set `claimStore` (see Several Instances and Serverless above) to cover several. If you call `Paywall.authorize` yourself, call the decision's `release()` when you send the handler's response without calling `settle()`.
- **A settle timeout is uncertain.** The transfer may still complete on-chain. The agent gets a 402 with `unexpected_settle_error`.
- **Credits are USD.** With `credits: true`, the paywall sends `currency: "USD"` with each charge. It throws when it is created if the route is priced in EUR or INR.
- **Paths are matched exactly.** An invoice created for `GET /premium` cannot pay for `GET /other` or `POST /premium`. Query strings are ignored.
- **Unpaid challenges send `invoice.expired`.** Each 402 creates an invoice, and each one that is never paid later expires and sends an `invoice.expired` webhook. You can recognize these invoices by the `solverr_resource` key in their `metadata`, which holds the method and path the invoice pays for, such as `GET /premium`.
- **At most 120 `solverr` payments start each minute.** Each `solverr` payment needs its own deposit address, and one business gets at most 120 new deposit addresses a minute across all its checkouts. Past that, the payer gets 429 with `Retry-After` before anything is sent, so nothing is paid. solverr-agent asks again once when `Retry-After` is 5 seconds or less. With a longer wait, `agent.fetch` throws a `SolverrApiError` with status 429, and the caller can try again after that wait. Credits and `exact` payments need no deposit address.
- **Every invoice is live.** API keys are live keys only, so each 402 asks for a real payment. To see the checkout without moving real money, open the demo store at `/demo` on your Solverr app.
- **Browsers.** Paywall responses list `PAYMENT-REQUIRED`, `PAYMENT-RESPONSE` and `Solverr-Credit-Balance` in `Access-Control-Expose-Headers`. Other CORS headers and preflight handling are up to your app. In Express, CORS headers set before the paywall stay on its responses, including a 402 that replaces your handler's response.

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/shield-check.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Build and Tests

```bash
cd packages
npm ci                                  # install the pinned dev dependencies of every package
cd x402
npm run build
npm test
npx tsc --noEmit -p tests/tsconfig.json # type-check the tests
```

`npm test` runs the Vitest suite in `tests/`. It replaces `fetch` with an in-memory Solverr API and facilitator (`tests/fake-api.ts`) and tests the Redis and Postgres stores against in-memory fakes (`tests/fakes.ts`), so it reaches no network.

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/file-text.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> License

Released under the **MIT License**.
