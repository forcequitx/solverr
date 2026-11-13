# <img src="https://github.com/forcequitx/solverr/raw/main/app/icon.svg" alt="Solverr" width="30" height="30"> solverr-react

**Add the Solverr crypto checkout to a React app with one component.**

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/lightbulb.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Overview

A React pay button for Solverr. It links to the full checkout page by default, or opens the checkout in a popup over your page if you choose. It works with React 18 and 19, including server rendering and the Next.js App Router.

- **Full page:** the button links to the Solverr checkout page (the default) -> the customer pays there with the whole screen.
- **Popup:** you set `mode="overlay"` -> the checkout opens over your page, and `onPaid` and `onClose` tell your page what happened.
- **Fixed price:** the amount comes from the payment link or the invoice -> a customer cannot change the price in the browser.

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/package.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Install

```bash
npm install solverr-react
```

The package is ES modules only. It loads `solverr-embed` as `solverr-embed/core`. Both packages declare their entry points only in package `exports`, which Next.js, Vite, webpack 5, Rollup and esbuild support. Parcel 2 reads package `exports` only when you turn them on in your app's `package.json` with `"@parcel/resolver-default": { "packageExports": true }`. Without it, the build fails with "Failed to resolve 'solverr-react'". TypeScript finds its types with any `moduleResolution` setting, including `node`.

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/mouse-pointer-click.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Add a Pay Button

Replace `https://pay.example.com` with the address of your Solverr app.

```tsx
import { PayButton } from "solverr-react";

export function Checkout() {
  return <PayButton baseUrl="https://pay.example.com" link="lnk_8Fq2" />;
}
```

Pass `link` for a payment link, or `invoice` for an invoice your server created with `solverr-node`. The amount always comes from the link or the invoice, never from the browser, so a customer cannot change the price.

The button renders a normal link (`<a href>`) to `https://pay.example.com/l/<link id>` or `https://pay.example.com/pay/<invoice id>`, and the customer pays on that page. The full page is the default because the checkout gets the whole screen, and wallet apps and browser wallet extensions connect more reliably on a full page than inside a frame.

### Set the app address once

```tsx
import { SolverrProvider, PayButton } from "solverr-react";

<SolverrProvider baseUrl="https://pay.example.com">
  <PayButton invoice={invoiceId}>Pay now</PayButton>
</SolverrProvider>;
```

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/bell.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Know When the Customer Has Paid

The customer leaves your page to pay, so learn about the payment on your server from the `invoice.paid` webhook or `GET /api/v1/invoices/:id`.

- **Invoice:** for an invoice your server creates, set `redirect_url` when you create it. After payment, the checkout shows a "Back to" button with your business name that sends the customer to that address. A visit to that address does not prove a payment, so confirm it on your server before you ship anything.
- **Payment link:** set a return address when you create it (`redirect_url`). Without one, the checkout sends the customer to the business website from your profile. When neither is set, the customer stays on the "Payment complete" screen, which links to the receipt.

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/app-window.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Open the Checkout in a Popup

To keep the customer on your page, set `mode="overlay"`. `onPaid` and `onClose` work only in this mode.

```tsx
"use client";

import { PayButton } from "solverr-react";

export function Checkout() {
  return (
    <PayButton
      baseUrl="https://pay.example.com"
      link="lnk_8Fq2"
      mode="overlay"
      onPaid={(invoice) => console.log("Paid", invoice.id)}
      onClose={() => console.log("Popup closed")}
    />
  );
}
```

In the Next.js App Router, the file that passes `onPaid` or `onClose` must start with `"use client"`, because a Server Component cannot pass functions to `PayButton`.

`onPaid` is a signal to update the page, for example to show a thank-you message. Confirm the payment on your server with the `invoice.paid` webhook before you ship anything. The popup does not use `redirect_url`.

### How the popup behaves

- **Layout:** the popup fills the screen on phones and is a centered panel on larger screens. It follows the visitor's light or dark setting.
- **Closing:** it closes with the close button, the Escape key, the browser's close request (such as the Android back gesture), or when the checkout asks to close.
- **Focus:** page scrolling is paused and keyboard focus stays in the popup until it closes. Focus then returns to the element that had it when the popup opened, usually the button that opened it.
- **Motion:** animations are turned off for visitors who ask for reduced motion.
- **Messages:** the popup passes your page's origin to the checkout, and the checkout sends its paid and close messages to that origin only. Only messages from the checkout frame on your Solverr app's origin are accepted.
- **Content-Security-Policy:** the popup loads the checkout in a frame. With a strict `Content-Security-Policy`, also allow frames from your Solverr app (`frame-src https://pay.example.com`).

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/settings.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Props

| Prop | Type | What it does |
| --- | --- | --- |
| `link` | `string` | Payment link id (`lnk_…`). Use this or `invoice`. |
| `invoice` | `string` | Invoice id (`inv_…`). Use this or `link`. |
| `baseUrl` | `string` | Your Solverr app's address, with `https://` (`http://` only for `localhost`, `127.0.0.1` and `[::1]`). Defaults to the nearest `SolverrProvider`. |
| `mode` | `"page"` or `"overlay"` | `"page"` (the default) links to the full checkout page. `"overlay"` opens the checkout in a popup over your page. |
| `onPaid` | `(invoice) => void` | Popup only. Called when the checkout reports payment. |
| `onClose` | `() => void` | Popup only. Called after the popup closes. |
| `className` | `string` | Your own button class. The default blue style is then not applied. |
| `children` | `ReactNode` | Button label. Defaults to "Pay with crypto". |

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/info.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> How the Button Behaves

- **Wrong setup:** if the button is set up wrong (no `baseUrl`, an `http://` address that is not local, or a missing or malformed `link` or `invoice` id), it renders disabled and logs the reason with `console.error`, instead of breaking your page.
- **Styles:** the component adds one `<style>` element to the page for the button and popup styles. With a strict `Content-Security-Policy`, allow inline styles (`style-src 'unsafe-inline'`).

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/shield-check.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Tests

The tests in `tests/` run with Vitest, jsdom and Testing Library. `vitest.config.ts` points `solverr-embed/core` at the embed source in this repository, so the tests need no embed build. Type-checking the tests reads embed's `dist` types, so build embed first for that.

```bash
cd packages
npm ci                                  # install the pinned dev dependencies of every package
npm run build -w embed                  # the type check reads solverr-embed's build
cd react
npx vitest run                          # run every test
npx tsc --noEmit -p tests/tsconfig.json # type-check the tests
```

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/rocket.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Build and Publish

The popup, the checkout URLs and the shared types come from `solverr-embed/core`, the module entry of `solverr-embed` (not the `embed.js` script). That is why `solverr-react` depends on `solverr-embed` at an exact version. Both are members of the npm workspace in `packages/`, so during development the dependency resolves to the local `packages/embed` folder. Build embed first, because React compiles against its `dist`:

```bash
cd packages
npm install
npm run build -w embed
npm run build -w react
```

Publish `solverr-embed` before `solverr-react`. When embed gets a new version, set the same exact version in React's `dependencies` and run `npm install` in `packages/` to update the lockfile.

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/file-text.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> License

Released under the **MIT License**.
