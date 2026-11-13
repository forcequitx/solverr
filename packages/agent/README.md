# <img src="https://github.com/forcequitx/solverr/raw/main/app/icon.svg" alt="Solverr" width="30" height="30"> solverr-agent

**A wallet for AI agents that pays Solverr x402 paywalls from NEAR and Base, within the spending limits you set.**

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/lightbulb.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Overview

`solverr-agent` is a wallet for AI agents that pays [Solverr](https://www.npmjs.com/package/solverr-x402) x402 paywalls from NEAR and Base, always within the spending limits you set. It also runs as a local MCP server, so Claude Code, Cursor or any MCP client can pay for API calls.

- **Keys:** the agent keeps them in memory on your machine and uses them only to sign transfers -> they are never logged.
- **Limits:** the agent checks the per-payment limit, the rolling 24-hour limit and the allowed hosts before every quote and again before every transfer -> a payment outside them is refused.
- **Spend log:** the agent writes every payment to a local JSON spend log -> the daily limit holds across restarts and across agents that share the same log file.

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/package.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Install

```bash
npm install solverr-agent
```

The package needs Node 22.22.2 or later (required by `near-api-js` 7).

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/code-xml.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Use It in Code

```ts
import { createAgentWallet } from "solverr-agent";

const agent = createAgentWallet({
  near: { accountId: process.env.AGENT_NEAR_ACCOUNT!, privateKey: process.env.AGENT_NEAR_KEY! },
  base: { privateKey: process.env.AGENT_BASE_KEY! },
  limits: { perPaymentUsd: 5, dailyUsd: 20, allow: ["api.example.com"] },
  trustedGateways: ["https://pay.example.com"],
});

const res = await agent.fetch("https://api.example.com/premium-data"); // pays a 402 automatically
console.log(res.status, await res.json());

console.log(await agent.balances());
console.log(await agent.spending());
console.log(agent.limits());
agent.setLimits({ dailyUsd: 10 });
```

### Options

| Option | Default | Meaning |
| --- | --- | --- |
| `near` | none | `{ accountId, privateKey: "ed25519:…", rpcUrl? }` |
| `base` | none | `{ privateKey: "0x…", rpcUrl? }` |
| `limits` | required | `{ perPaymentUsd, dailyUsd, allow }`. `allow` takes hosts such as `api.example.com` or `*.example.com`; an empty list allows nothing |
| `spendLogPath` | `~/.solverr/agent-spend-log.json` | Local spend log |
| `assets` | USDC, USDT, wNEAR on NEAR; USDC, ETH on Base | Coins to check and pay with |
| `trustedGateways` | required | Solverr URLs the agent will pay through, such as `https://pay.example.com`. The gateway prices the invoice, so a paywall that names any other gateway is refused with `untrusted_gateway` |
| `paymentTimeoutMs` | 180000 | How long to wait for the invoice to be paid after sending |
| `requestTimeoutMs` | 15000 | Timeout of each RPC and gateway call |
| `resourceTimeoutMs` | 30000 | Timeout of each paid request, and of the first request when you pass no `signal`, including reading the body. Raise it for endpoints that take longer to answer or stream their body |

RPCs default to `https://free.rpc.fastnear.com` (NEAR) and `https://mainnet.base.org` (Base).

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/triangle-alert.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Errors and Retries

### Payment errors

`agent.fetch` throws a `PaymentError` when it refuses or cannot finish a payment. Check `error.code` (`host_not_allowed`, `untrusted_gateway`, `per_payment_limit`, `daily_limit`, `test_invoice`, `no_funds`, `quote_unavailable`, `quote_mismatch`, `payment_timeout`, `payment_unconfirmed`, `paid_request_failed`, …) and `error.fundsSent`. When `fundsSent` is `true`, `error.invoiceId` names the invoice the money went to: read the message before you request that URL again.

When the gateway or a wallet RPC fails before any transfer, `agent.fetch` throws that error (for example a `SolverrApiError`), and nothing was sent. A NEAR RPC error names only the RPC's origin, never its full URL, because that URL may carry an API key.

### Abort signal

A `signal` you pass in `init` covers the first request and the payment up to the transfer. Aborting before then throws the signal's reason, and nothing is sent. Once the transfer starts, the signal no longer applies: the agent always finishes the payment and the paid request, so a slow payment never costs you the response you paid for.

### Retries of the paid request

After paying, the agent sends the request with `PAYMENT-SIGNATURE`, always with the same payment and `resourceTimeoutMs` (30 seconds by default) per attempt. After a network error, 429 or 5xx, it tries again, up to 3 attempts in all. A `402` that follows an attempt with no answer also counts as a failure, because that earlier request may still be using the payment. It waits 1 second, then 2 seconds, between attempts. After a 429 or 503, it waits at least the `Retry-After` the site sends, up to 60 seconds. It stops early when the next wait would end more than `paymentTimeoutMs` after the first attempt. If it still fails, or the site answers `402` to the paid request, `agent.fetch` throws `paid_request_failed` with `fundsSent: true`.

### Kept payments

A site that answers the paid request with an error (400 or higher) does not use the payment, so the invoice can still be redeemed. The wallet keeps such a payment in memory for the same method, origin and path. It also keeps it after `paid_request_failed` from a 429, 5xx, network error, or a `402` that followed an attempt with no answer.

The next time that URL answers `402`, the wallet sends the kept payment again before it pays anything new. This costs nothing and adds nothing to the spend log. The wallet drops the kept payment once the site accepts it. It also drops it when the site answers it with `402`, and then pays the new invoice.

`agent.unusedInvoice(url, method?)` returns the invoice ID of a kept payment. Kept payments are lost when the process stops.

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/server.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> MCP Server

Start the MCP server:

```bash
AGENT_BASE_KEY=0x… \
AGENT_LIMIT_PER_PAYMENT_USD=1 \
AGENT_LIMIT_DAILY_USD=5 \
AGENT_ALLOW_HOSTS=api.example.com \
AGENT_TRUSTED_GATEWAYS=https://pay.example.com \
npx solverr-agent mcp
```

Add it to Claude Code:

```bash
claude mcp add solverr-agent \
  -e AGENT_NEAR_ACCOUNT=agent.near -e AGENT_NEAR_KEY=ed25519:… \
  -e AGENT_LIMIT_PER_PAYMENT_USD=1 -e AGENT_LIMIT_DAILY_USD=5 -e AGENT_ALLOW_HOSTS=api.example.com \
  -e AGENT_TRUSTED_GATEWAYS=https://pay.example.com \
  -- npx solverr-agent mcp
```

### Tools

| Tool | What it does |
| --- | --- |
| `pay_url` | Fetches `url` on a host in the allow list, with optional `method` (`GET` by default, or `POST`, `PUT`, `PATCH`, `DELETE`), `headers` and `body`. It pays a 402 within the limits, then returns `status`, `content_type`, the receipt as `payment`, `body` and `body_truncated`. Redirects are returned with their `location`, not followed. When the site answers with an error and a paid invoice was not used, the result also has `invoice_id` and `payment_unused: true`. Calling `pay_url` again with the same method and URL sends that payment again |
| `get_balances` | Balances of the coins the wallet can pay with |
| `get_spending` | Limits, total of the last 24 hours, recent payments |
| `set_limits` | Lowers `per_payment_usd` or `daily_usd`, or narrows the `allow` host list. It cannot raise them above the values the server started with, so text on a paid page cannot talk the model into spending more |

### Environment variables

| Variable | Required | Meaning |
| --- | --- | --- |
| `AGENT_NEAR_ACCOUNT`, `AGENT_NEAR_KEY` | one wallet | NEAR account and `ed25519:` key |
| `AGENT_BASE_KEY` | one wallet | Base private key |
| `AGENT_LIMIT_PER_PAYMENT_USD` | yes | Largest single payment |
| `AGENT_LIMIT_DAILY_USD` | yes | Largest total over 24 hours |
| `AGENT_ALLOW_HOSTS` | yes | Comma-separated hosts that `pay_url` may request and pay |
| `AGENT_TRUSTED_GATEWAYS` | yes | Comma-separated Solverr URLs the agent may pay through |
| `AGENT_NEAR_RPC_URL`, `AGENT_BASE_RPC_URL` | no | Custom RPCs |
| `AGENT_SPEND_LOG` | no | Spend log path |
| `AGENT_PAYMENT_TIMEOUT_MS` | no | Wait for payment, in ms |
| `AGENT_RESOURCE_TIMEOUT_MS` | no | `resourceTimeoutMs`, in ms |

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/workflow.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> How a Payment Works

1. The agent requests the URL with the caller's method. When the answer is not a `402`, or is a `402` without a `solverr` offer it can read, the agent returns that response as it is.
2. For a `402` with the `solverr` scheme, it checks that the host is allowed, the gateway is trusted and the invoice is live. If any check fails, it throws `PaymentError` and nothing is sent.
3. It prices the invoice in USD from `/tokens` and checks the per-payment and 24-hour limits. If the price is over a limit, it throws `PaymentError` and nothing is sent.
4. It reserves the amount in the spend log.
5. It ranks the coins it holds: the coin the business receives first, then the same coin on another chain, then stablecoins, then the rest.
6. It asks for a quote (`POST`) with its own refund address. A `422` sends it back to step 5 for the next coin.
7. It checks the quote: coin, refund address, deposit address, amount, deadline and limits. If anything does not match, it throws `PaymentError` and nothing is sent.
8. It sends exactly `amount_in_base` to `deposit_address`, reports the transaction hash (`POST` deposit) and polls the status until the invoice is paid.
9. Once the invoice is paid, it sends the same request with `PAYMENT-SIGNATURE`, up to 3 tries.
10. When the payment ends underpaid, refunded, failed or timed out, any other error happens, or the paid request still fails or answers `402`, it throws `PaymentError` with `fundsSent: true` and the `invoiceId`.

How each chain sends the transfer, and how payments take turns:

- **Base:** ERC-20 `transfer`, or a plain ETH transfer for native ETH, signed with viem.
- **NEAR:** NEP-141 `ft_transfer` with 1 yoctoNEAR. 1Click deposit addresses are usually fresh implicit accounts, so the agent checks `storage_balance_of` first. When the address is not registered with the token, the agent adds `storage_deposit` (the token's `storage_balance_bounds.min`) in the same transaction. Keep a little more than 0.01 NEAR available. The agent holds back 0.01 NEAR for gas, and it also needs the token's storage deposit when the deposit address is new.
- **One payment at a time:** payments in one process run one at a time. Every spend log write re-reads the file while it holds `agent-spend-log.json.lock`. The limit check and the reservation happen in the same locked step, so two calls or two processes cannot both pass the daily limit. Quotes and transfers run outside the lock.

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/circle-question-mark.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Points That Cause Confusion

- **Test invoices are never paid on-chain.** Only the Solverr demo store issues `mode: "test"` invoices, and they have `TEST-` deposit addresses. The agent refuses them with `test_invoice` before it asks for a quote, and it refuses any quote with a `TEST-` address.
- **Native NEAR is not used to pay.** NEAR Intents takes wNEAR (`wrap.near`). Hold wNEAR, USDC or USDT on NEAR.
- **Route minimums.** 1Click can set a temporary minimum on a route, which makes the gateway refuse a quote for that coin. The agent prefers the exact coin the business receives, then the same coin on other chains, then other stablecoins. It tries up to three coins and moves on to the next one when a route is refused.
- **The spend log counts money that may have left the wallet.** Entries that were `sent`, `paid` or `failed` count toward the daily limit. Only `aborted` entries (nothing sent) do not. A corrupt log stops payments instead of resetting the total.
- **A stuck lock file.** A process that stops while writing can leave `<spend log>.lock` behind. The agent removes a lock older than 30 seconds. A younger one makes a payment wait up to 10 seconds and then fail.
- **`pay_url` only reaches public addresses.** Besides the allow list, it resolves the host and refuses loopback, private, link-local (including cloud metadata such as `169.254.169.254`), multicast and reserved IPv4 and IPv6 addresses. To reach a local server, put its exact address in `AGENT_ALLOW_HOSTS` and use it in the URL: `127.0.0.1`, `[::1]` or `localhost`. The request then connects only to the addresses that passed this check, so a host whose DNS answer changes afterwards cannot send it to a private network.
- **Give MCP tool calls enough time.** One `pay_url` call can take about 5 minutes with the default settings: up to 60 seconds to send the transfer, up to 3 minutes (`AGENT_PAYMENT_TIMEOUT_MS`) for the invoice to be paid, then the paid request. Many MCP clients stop waiting for a tool after 60 seconds. The payment still completes, but the model never sees the result and may pay again. Raise your client's tool timeout to at least 5 minutes; in Claude Code, set `MCP_TOOL_TIMEOUT=300000`.
- **A timeout is not a refusal.** On `payment_timeout` the transfer was sent. Check the status URL in the message before paying again.
- **`fundsSent: true` means the money left the wallet.** Every error after the transfer, including a spend log or gateway failure, carries `fundsSent: true` and the `invoiceId`. The MCP server returns them as `funds_sent` and `invoice_id`. An error that is not a `PaymentError` comes back with the code `request_failed` and `funds_sent: false`: a gateway or RPC failure before any transfer, a `set_limits` value above the starting one, or a host outside the starting allow list. A spend log write that fails after the transfer does not stop the payment. The entry still counts toward the daily limit.

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/shield-check.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Tests

The tests in `tests/` run with Vitest and never send a transaction or reach a network. Chains, wallets, the gateway, DNS and `fetch` are mocked, and spend logs are written to a fresh folder under the OS temp folder. They import `solverr-x402` from its `dist`, so build x402 first.

```bash
cd packages
npm ci                                  # install the pinned dev dependencies of every package
npm run build -w x402                   # the agent imports solverr-x402's build
cd agent
npx vitest run                          # run every test
npx tsc --noEmit -p tests/tsconfig.json # type-check the tests
```

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/rocket.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Build and Publish

### Build

`solverr-agent` depends on `solverr-x402` at an exact version. Both are members of the npm workspace in `packages/` (`packages/package.json`, one `packages/package-lock.json`), so during development the dependency resolves to the local `packages/x402` folder. Build x402 first, because the agent compiles against its `dist`:

```bash
cd packages
npm install
npm run build -w x402
npm run build -w agent
```

### Publish

Publish `solverr-x402` before `solverr-agent`: the agent's `package.json` names the x402 version it needs (`"solverr-x402": "0.1.2"`), and npm can only install the agent once that version exists on the registry. When x402 gets a new version, set the same exact version in the agent's `dependencies` and run `npm install` in `packages/` to update the lockfile.

```bash
cd packages
npm publish -w x402
npm publish -w agent
```

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/file-text.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> License

Released under the **MIT License**.
