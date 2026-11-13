# <img src="app/icon.svg" alt="Solverr" width="30" height="30"> Solverr

**Get paid by humans and AI agents, in any coin.** Solverr is a non-custodial crypto payment gateway built on [NEAR Intents](https://docs.near-intents.org).

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/banner-dark.svg">
  <img src="assets/banner-light.svg" width="100%" alt="Solverr - Get paid by humans and AI agents, in any coin.">
</picture>

---

*Non-custodial · 0% gateway fee · 31 chains · Built on NEAR Intents*

[Live Demo](https://solverr.xyz/demo) · [Docs](https://solverr.xyz/docs) · [Overview](#-overview) · [Try It](#try-it-as-a-judge) · [Integrate](#-integrate-in-minutes) · [Telegram](#-telegram-bot) · [Quick Start](#-quick-start) · [Tests](#-run-all-tests) · [Deployment Guide](deploy/README.md) · [License](LICENSE)

## <img src="assets/icons/lightbulb.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Overview

Most crypto payment gateways hold the business's money, accept a fixed list of coins and take a fee on every payment. AI agents cannot pay them at all.

<img src="assets/screenshots/problem.jpg" width="100%" alt="Crypto payments are still hard: gateways hold your money, accept a short list of coins, take a cut of every sale, and AI agents cannot pay">

Solverr is a non-custodial payment gateway built on **NEAR Intents**. Customers and AI agents pay a business with a coin they already hold on any of **31 chains**. NEAR Intents converts the payment and delivers the coin the business chose straight to the business's own wallet. Solverr charges no fee and never holds funds or private keys.

- **Checkout:** the business creates an invoice -> the customer picks a coin, pays a one-time address, and the business's server gets a signed `invoice.paid` webhook.
- **Payment links:** the business shares a link with a fixed amount or an open tip field -> no code needed.
- **AI agents:** the business's API answers `402 Payment Required` -> the agent pays within its spending limits, or spends prepaid credits per call.

The invoice amount is what the business receives. The customer covers the NEAR Intents swap fee and the network fee of their own transfer.

> [!TIP]
> The full user docs are at [solverr.xyz/docs](https://solverr.xyz/docs), and a local app serves them at `/docs`.

## <img src="assets/icons/trophy.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> NEAR Hackathon

### How Solverr uses NEAR

| NEAR piece | What it does in Solverr |
| --- | --- |
| **NEAR Intents (1Click API)** | Quotes every payment for the exact amount the business receives, gives the one-time payment address, converts the coin and delivers it. |
| **Confidential Intents** | Private payments hide the on-chain link between a customer's payment and the business's payout. |
| **NEAR wallets** | Sign in with a NEAR account, pay from a NEAR wallet through NEAR Connect, and receive payouts on NEAR. |
| **NEAR RPC** | Checks NEAR transfers on-chain and that a signing key is a full-access key of the account. |
| **Agent kit** | `solverr-agent` pays 402 paywalls from a NEAR or Base wallet. |

<img src="assets/screenshots/near.jpg" width="100%" alt="NEAR powers every step: NEAR Intents 1Click API, Confidential Intents, NEAR wallets and NEAR RPC">

### Try it as a judge

**Live, with nothing to install.** Solverr runs at [solverr.xyz](https://solverr.xyz). Its demo store runs in test mode, so no real money moves.

1. Open [solverr.xyz/demo](https://solverr.xyz/demo), press **Pay with crypto** on a fixed-price product (the tip product asks you to type an amount first), then **Continue to payment**.
2. Choose a network and a coin and press **Continue**. Choose **Send manually**, tick the network box, enter any valid address on that network for refunds, and press **Show payment address**. Then press **Paid** in the Simulate panel. The status moves to paid within a few seconds, like a real payment, and the "Payment complete" screen links to the receipt.
3. Read how businesses and AI agents integrate it in the docs at [solverr.xyz/docs](https://solverr.xyz/docs).

<table>
  <tr>
    <td width="50%" valign="top"><img src="assets/screenshots/demo.jpg" alt="The demo store with three products and Pay with crypto buttons"></td>
    <td width="50%" valign="top"><img src="assets/screenshots/checkout-coin.jpg" alt="Checkout step 1: choose the coin and network to pay with, from 31 networks"></td>
  </tr>
  <tr>
    <td align="center"><sub>1. The demo store</sub></td>
    <td align="center"><sub>2. Choose a network and a coin</sub></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><img src="assets/screenshots/checkout-address.jpg" alt="Checkout step 2: the exact amount, a QR code and the one-time payment address"></td>
    <td width="50%" valign="top"><img src="assets/screenshots/receipt.jpg" alt="The receipt: what the customer paid, what the business received, and the NEAR Intents details to check it"></td>
  </tr>
  <tr>
    <td align="center"><sub>3. Send the exact amount to a one-time address</sub></td>
    <td align="center"><sub>4. The receipt shows what the business received</sub></td>
  </tr>
</table>

**On your own machine.** Follow the Quick Start below and open http://localhost:3002/demo for step 1. Then run the suites in Run All Tests below: the app, its database, the browser tests, every SDK and the WooCommerce plugin.

## <img src="assets/icons/plug.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Integrate in Minutes

A business picks the way that fits its site, from no code at all to a few lines on its server.

| Way | Effort | How the business does it |
| --- | --- | --- |
| **Payment link** | No code | Create a link in **Dashboard → Payment links** and share it, or its QR code, anywhere. A tip link lets the customer type the amount. |
| **[Telegram bot](#-telegram-bot)** | No code | Create invoices, payment links and tip links with bot commands, and get a message for every payment. |
| **Pay button** | Copy and paste | **Dashboard → Pay button** turns a payment link into a ready-made HTML or React button. |
| **WooCommerce** | Upload a plugin | Upload the plugin zip in WordPress, enter the Solverr address, API key and webhook secret, tick **Enable**, and Solverr appears at checkout. |
| **AI code editor** | One command | Add the remote MCP server, then ask in plain words: "Add crypto checkout to this site with Solverr." |
| **Server SDKs and API** | A few lines | Create invoices, refunds and payouts and verify webhooks with the Node, PHP or Python SDK, or the REST API. |
| **Agent paywall** | One middleware | `solverr-x402` makes a Next.js route or an Express endpoint answer `402` and get paid per request. |

<img src="assets/screenshots/integrate.jpg" width="100%" alt="From no code to a few lines: payment link, pay button, Telegram bot, WooCommerce, server SDKs, REST API, MCP server and agent paywall">

The pay button for any website is two lines:

```html
<script src="https://your-solverr-host/embed.js" async></script>
<button data-solverr-link="lnk_8Fq2">Pay with crypto</button>
```

> [!NOTE]
> The price always comes from the payment link on the server, so a visitor cannot change it by editing the page.

## <img src="assets/icons/send.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Telegram Bot

A business can take payments from a private Telegram chat. One command creates an invoice or a payment link, and the bot sends a message the moment a payment completes. The invoices and links it creates are the same ones the dashboard shows, and they send the usual webhooks.

<img src="assets/screenshots/telegram.jpg" width="100%" alt="A chat with the Solverr bot: connect, create an invoice and a tip link, get a payment message and list payments">

**Connect a chat**

1. Open **Dashboard → Settings → Telegram** and select **Connect a Telegram chat**. Solverr shows a one-time code and a link to the bot.
2. Select the link and press **Start** in Telegram, or send `/connect CODE` to the bot.
3. The bot answers "Connected to" and the business name. A code works once, for 10 minutes.

| Command | What it does |
| --- | --- |
| `/invoice 25 USD Two coffees` | Creates an invoice and answers with its payment page. The description is optional. |
| `/paylink 4.50 USD Flat white` | Creates a reusable payment link with a fixed price. The title is required. |
| `/tiplink Tip jar` | Creates a tip link in USD, where the customer types the amount. |
| `/payments` | Lists the five newest invoices with their amount, status and description. |
| `/disconnect` | Unlinks the chat, so it stops getting payment messages. |
| `/help` | Lists the commands. |

Every chat linked to the business gets `Payment received: 25.00 USD · Two coffees` when an invoice is paid. The currency is `USD`, `EUR` or `INR`.

- The bot answers only in a private chat. In a group it asks for a direct message.
- `/invoice`, `/paylink` and `/tiplink` need a verified payout wallet.
- A chat acts with the role of the teammate who connected it. Only owners and developers can connect one, and a viewer's chat can only list payments.

> [!NOTE]
> A self-hosted server turns the bot on with `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET`, then registers its webhook once. The [Telegram bot docs](https://solverr.xyz/docs/no-code/telegram) and [deploy/README.md](deploy/README.md) cover the steps.

## <img src="assets/icons/sparkles.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Features

<img src="assets/screenshots/dashboard.jpg" width="100%" alt="Dashboard overview: payment health, paid revenue and the daily rhythm of payments">
<p align="center"><sub>Dashboard → Overview</sub></p>

<table width="100%" style="border-collapse: collapse; border: none;">
  <tr style="border: none;">
    <td width="50%" valign="top" style="border: none; padding: 6px;">
      <h4>Non-Custodial</h4>
      <p style="font-size: 0.9em; line-height: 1.4;">Funds move from the customer to a one-time NEAR Intents address, then straight to the business's wallet. Payouts go only to a wallet the business verified by signing a message.</p>
    </td>
    <td width="50%" valign="top" style="border: none; padding: 6px;">
      <h4>0% Gateway Fee</h4>
      <p style="font-size: 0.9em; line-height: 1.4;">Solverr takes nothing. NEAR Intents charges about 0.2% per swap, or 0.01% between stablecoins, plus 0.25% when the server has no NEAR Intents partner key, and the customer pays it on top of the price.</p>
    </td>
  </tr>
  <tr style="border: none;">
    <td width="50%" valign="top" style="border: none; padding: 6px;">
      <h4>Mistake-Proof Checkout</h4>
      <p style="font-size: 0.9em; line-height: 1.4;">The checkout checks the network, the exact amount, memos and refund addresses before anything is sent. Too little sent is refunded automatically.</p>
    </td>
    <td width="50%" valign="top" style="border: none; padding: 6px;">
      <h4>Live Status</h4>
      <p style="font-size: 0.9em; line-height: 1.4;">The checkout updates live as a payment moves, and the business's server gets signed webhooks with automatic retries.</p>
    </td>
  </tr>
  <tr style="border: none;">
    <td width="50%" valign="top" style="border: none; padding: 6px;">
      <h4>Payments for AI Agents</h4>
      <p style="font-size: 0.9em; line-height: 1.4;">A 402 paywall, prepaid credit balances, and an agent wallet with spending limits that runs as a local MCP server.</p>
    </td>
    <td width="50%" valign="top" style="border: none; padding: 6px;">
      <h4>MCP for Code Editors</h4>
      <p style="font-size: 0.9em; line-height: 1.4;">A remote MCP server lets a developer's code editor create invoices, payment links and refunds, and fetch ready-to-paste integration code.</p>
    </td>
  </tr>
  <tr style="border: none;">
    <td width="50%" valign="top" style="border: none; padding: 6px;">
      <h4>Private Payments</h4>
      <p style="font-size: 0.9em; line-height: 1.4;">NEAR Intents Confidential Intents hide the on-chain link between a customer's payment and the business's payout. Needs a NEAR Intents partner key.</p>
    </td>
    <td width="50%" valign="top" style="border: none; padding: 6px;">
      <h4>Business Dashboard</h4>
      <p style="font-size: 0.9em; line-height: 1.4;">Payments, refunds, payouts, subscriptions, revenue splits, team roles, Telegram alerts and CSV export.</p>
    </td>
  </tr>
</table>

## <img src="assets/icons/workflow.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> How It Works

### A customer pays an invoice

```mermaid
sequenceDiagram
  autonumber
  participant B as Business server
  participant S as Solverr
  participant C as Customer
  participant N as NEAR Intents
  participant W as Business wallet
  B->>S: POST /api/v1/invoices
  S-->>B: checkout_url
  C->>S: Open the checkout and choose a coin
  S->>N: Quote for the exact amount the business receives
  N-->>S: One-time payment address
  C->>N: Send the coin from a wallet or by hand
  N->>W: Convert and deliver the coin the business chose
  S->>N: Worker follows the payment status
  S->>B: Signed invoice.paid webhook
  S-->>C: Receipt
```

### An AI agent pays for an API call

<img src="assets/screenshots/agents.jpg" width="100%" alt="AI agents pay per request with 402: the paywall route, the agent wallet with spending limits, and the six steps from request to 200 OK">

```mermaid
sequenceDiagram
  autonumber
  participant A as AI agent with solverr-agent
  participant P as Business API with solverr-x402
  participant S as Solverr
  participant N as NEAR Intents
  A->>P: GET /premium
  P->>S: Create an invoice for the price
  P-->>A: 402 with PAYMENT-REQUIRED
  A->>A: Check the spending limits
  A->>S: Get a payment address for a coin it holds
  A->>N: Send the exact amount
  N-->>S: Payment delivered, invoice paid
  A->>P: Retry with PAYMENT-SIGNATURE
  P->>S: Check the invoice is paid, unused and for this route
  P-->>A: 200 with PAYMENT-RESPONSE
```

### What runs where

```mermaid
flowchart TB
  Users["Customers, AI agents and business servers"] -->|checkout, 402, MCP, REST| Web
  subgraph Vercel
    Web["Next.js app<br/>checkout, dashboard, API, MCP server, docs"]
  end
  subgraph VPS["VPS with Docker Compose"]
    Bouncer["PgBouncer"] --> DB[("Postgres")]
    Worker["Worker"] --> DB
  end
  Web -->|TLS| Bouncer
  Web -->|quotes| OneClick["NEAR Intents 1Click API"]
  Worker -->|payment status| OneClick
  Worker -->|signed webhooks, alerts| Out["Business webhooks and Telegram"]
```

## <img src="assets/icons/terminal.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Quick Start

### Prerequisites

- **Node.js 24**
- **Docker** (runs the local Postgres 17 database)
- A **Reown project id** from [dashboard.reown.com](https://dashboard.reown.com), with `localhost:3002` on its allowed domains, to connect wallets

### Install and run

```bash
# 1. Install packages
npm install

# 2. Create the env file, then set ENCRYPTION_KEY and BETTER_AUTH_SECRET
#    to two separate outputs of: openssl rand -base64 32,
#    and NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID to your Reown project id
cp .env.example .env

# 3. Start Postgres, apply migrations and generate the Prisma client
npm run db:up
npm run db:migrate
npm run db:generate

# 4. Start the app on http://localhost:3002
npm run dev

# 5. Start the worker in a second terminal
npm run worker
```

Open http://localhost:3002/demo to try the checkout without real money. The worker creates the demo store and its payment links when it starts, so start it before you open the demo. To use the API, sign in, finish setup and create an API key in **Developers**.

`npm run dev` and `npm run worker` start the local database when it is not running and stop an earlier copy of themselves. `npm run dev` uses port 3002 unless `PORT` is set, and `APP_URL` must use the same port. Run `npm run db:generate` again after every schema change.

### Production build

```bash
npm run build
npm run start
```

`npm run start` runs the standalone server on port 3002, or on `PORT` when it is set, and reads the project's `.env`.

## <img src="assets/icons/shield-check.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Run All Tests

Every suite below runs on each push in `.github/workflows/ci.yml`. The tests never contact real chains, NEAR Intents or email services: those are mocked. Run each block from the repository root, after steps 1 to 3 of Install and run (the tests need the `.env` file and the generated Prisma client).

> [!IMPORTANT]
> Stop `npm run dev` first, because `npm run typecheck` rewrites the route types in `.next` that a running dev server also uses.

### App: type check, lint and unit tests

```bash
npm run typecheck
npm run lint
npm test
```

`npm test` runs the unit tests in `tests/unit`, with no database or network.

### App: database tests

> [!WARNING]
> `npm run test:db` wipes the database in `TEST_DATABASE_URL`, so it refuses a database whose name does not contain `test`.

Start a throwaway one first:

```bash
docker run -d --rm --name solverr-test-pg -e POSTGRES_PASSWORD=test -e POSTGRES_DB=solverr_test -p 127.0.0.1:55432:5432 postgres:17.11
until docker exec solverr-test-pg pg_isready -h 127.0.0.1 -U postgres -d solverr_test; do sleep 1; done
TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:55432/solverr_test npm run test:db
docker rm -f solverr-test-pg
```

### App: browser tests

`npm run test:e2e` drives the real pages in Chromium the way customers, business owners and developers use them:
- **Setup:** the three steps, the logo checks, and switching networks.
- **Demo checkout:** paying with USDC on NEAR through to the receipt, the refund outcome, refund address and tip amount checks, and the phone layout.
- **Dashboard:** sign-in required, payment links and the pay button, and changing the coin in Settings.
- **API:** keys, invoices and idempotency.

The tests start their own app on port 3100, building into `.next-e2e` so a running `npm run dev` is not disturbed. They also start the worker and a local stand-in for the NEAR Intents API. The browser may only reach `localhost`, so nothing leaves the machine. Like the database tests, they wipe the database in `TEST_DATABASE_URL`:

```bash
npx playwright install chromium
docker run -d --rm --name solverr-test-pg -e POSTGRES_PASSWORD=test -e POSTGRES_DB=solverr_test -p 127.0.0.1:55432:5432 postgres:17.11
until docker exec solverr-test-pg pg_isready -h 127.0.0.1 -U postgres -d solverr_test; do sleep 1; done
TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:55432/solverr_test npm run test:e2e
docker rm -f solverr-test-pg
```

The first run takes a few minutes while the dev server compiles each page. Screenshots and traces of failed tests are saved in your system's temp folder under `solverr-e2e`.

### Packages and plugin

<details>
<summary><b>TypeScript packages</b></summary>

```bash
(cd packages && npm ci && npm run build --workspace embed && npm run build --workspace x402)
for pkg in embed react x402 agent; do
  (cd "packages/$pkg" && npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tests/tsconfig.json && npx vitest run)
done
(cd packages/node && npm ci && npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tests/tsconfig.json && npx vitest run)
```

`embed` and `x402` are built first, because `react` type-checks against the `embed` build and `agent` imports `solverr-x402`. The Node SDK has its own lockfile, so it installs separately.

</details>

<details>
<summary><b>Python SDK</b></summary>

Python 3.11 or later; the SDK has no dependencies to install.

```bash
(cd packages/python && python3 -I -m unittest discover -s tests -t .)
```

On Windows, use `python` instead of `python3`.

</details>

<details>
<summary><b>PHP SDK and WooCommerce plugin</b></summary>

With PHP 8.3 or later and Composer 2:

```bash
(cd packages/php && composer install --no-interaction --no-progress && vendor/bin/phpunit)
(cd plugins/woocommerce/tests && composer install --no-interaction --no-progress && vendor/bin/phpunit)
```

Without PHP, run the same commands in Docker's official Composer image, which includes PHP. In Git Bash on Windows, put `MSYS_NO_PATHCONV=1` in front of each `docker run`, so the paths reach Docker unchanged:

```bash
docker run --rm -v "$PWD/packages/php:/app" -w /app composer:2 sh -c "composer install --no-interaction --no-progress && vendor/bin/phpunit"
docker run --rm -v "$PWD/plugins/woocommerce:/app" -w /app/tests composer:2 sh -c "composer install --no-interaction --no-progress && vendor/bin/phpunit"
```

The plugin's order lock is also tested in real WordPress and MariaDB containers. It needs Docker and downloads its pinned images on the first run:

```bash
bash plugins/woocommerce/tests/integration/order-lock.sh
```

</details>

## <img src="assets/icons/settings.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Configuration

Copy `.env.example` to `.env`. Only `ENCRYPTION_KEY`, `BETTER_AUTH_SECRET` and the Reown project id need a value for local use; the rest have working defaults or are optional. Every `NEXT_PUBLIC_*` value reaches the browser, and an empty value counts as unset.

| Variable | Scope | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | server | Postgres connection. The default matches the local Docker database. |
| `APP_URL` | server | Public address of the app, `http://localhost:3002` locally. Sign-in cookies and origin checks rely on it. |
| `ENCRYPTION_KEY` | server | **Required.** 32 random bytes in base64. Encrypts webhook secrets and stored API responses. |
| `BETTER_AUTH_SECRET` | server | **Required.** Signs sign-in sessions. |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | browser | Reown project id for the wallet modal (EVM, Solana, Bitcoin, TRON, TON) and NEAR QR connect. Built into the page, so rebuild after changing it. |
| `ONECLICK_BASE_URL` | server | NEAR Intents 1Click API address. |
| `ONECLICK_API_KEY` | server | Optional partner key. Without it, 1Click adds 0.25% per swap. |
| `ONECLICK_CONFIDENTIALITY` | server | Optional `basic` or `advanced` for private payments. Needs the partner key. |
| `RESEND_API_KEY`, `EMAIL_FROM` | server | Optional. Together they turn on email sign-in and receipts. |
| `NEAR_RPC_URL`, `SOLANA_RPC_URL`, `EVM_RPC_URLS` | server | Optional RPCs for transfer checks, smart-wallet sign-ins and Earn balances. Public endpoints by default. |
| `NEXT_PUBLIC_SOLANA_RPC_URL`, `NEXT_PUBLIC_NEAR_RPC_URL` | browser | Optional RPCs for wallet balances and Solana payments. Visible to everyone, so restrict keys to the site's domain. |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` | server | Optional Telegram bot. Both must be set. |
| `SENTRY_DSN` | server | Optional GlitchTip DSN for error reports. |
| `DATABASE_CA_CERT`, `DATABASE_CLIENT_CERT`, `DATABASE_CLIENT_KEY`, `DATABASE_POOL_MAX` | server | Production database TLS and pool size, set on Vercel. See [deploy/README.md](deploy/README.md). |

## <img src="assets/icons/rocket.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Deployment

The website and API run on **Vercel**. The worker, Postgres, PgBouncer, GlitchTip and backups run on **one VPS** with Docker Compose, because Vercel functions cannot run the always-on worker.

[deploy/README.md](deploy/README.md) covers the first deploy, the Vercel settings, error tracking, the Telegram bot, updates, backups and restores.

## <img src="assets/icons/file-text.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Disclaimer & License

Solverr is non-custodial: it never holds funds or private keys, and NEAR Intents delivers each payment straight to the payout wallet the business verified. On-chain transfers cannot be reversed. This software is provided as-is, without warranty.

Released under the **MIT License**. The WooCommerce plugin in `plugins/woocommerce` is GPL-2.0-or-later, as WordPress requires.
