# <img src="https://github.com/forcequitx/solverr/raw/main/app/icon.svg" alt="Solverr" width="30" height="30"> solverr-embed

**A Solverr pay button for any web page, with no dependencies.**

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/lightbulb.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Overview

`solverr-embed` adds a Solverr pay button to any web page. The button opens the full checkout page by default, or a popup over your page if you choose. It has no dependencies.

- **Script tag:** you add `embed.js` and a button with a payment link id or an invoice id -> a click opens the checkout for it.
- **Your own code:** you call `window.Solverr.open()`, or `open()` from the npm package -> the checkout opens without a button.
- **Popup:** you add `data-solverr-mode="overlay"` -> the checkout opens over your page, and a `solverr:paid` event tells the page when the customer has paid.

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/mouse-pointer-click.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Add a Pay Button

1. Add the script once, anywhere on the page. Replace `https://pay.example.com` with the address of your Solverr app.
2. Add `data-solverr-link` with a payment link id, or `data-solverr-invoice` with an invoice id your server created.

```html
<script src="https://pay.example.com/embed.js" async></script>

<button data-solverr-link="lnk_8Fq2">Pay with crypto</button>
<button data-solverr-invoice="inv_7h3K9dWq2LmN4pRt6vXy">Pay invoice</button>
```

Clicking the button goes to the full checkout page in the same tab: `https://pay.example.com/l/<link id>` for a payment link, or `https://pay.example.com/pay/<invoice id>` for an invoice. Ctrl-click (Cmd-click on a Mac) opens it in a new tab.

The full page is the default because the checkout gets the whole screen, and wallet apps and browser wallet extensions connect more reliably on a full page than inside a frame. The amount always comes from the payment link or the invoice, never from the page, so a customer cannot change the price.

### Loading the script

The script finds your Solverr app from its own `src`. Always load it from your Solverr app's address, over `https://` (`http://` works only for `localhost`, `127.0.0.1` and `[::1]`). If a script loader, such as a tag manager, adds the tag for you, add a `data-solverr-embed` attribute to it so the script can still find its own tag. Loading the script twice on one page does nothing extra.

If your site sends a strict `Content-Security-Policy`, allow the script from your Solverr app in `script-src` (`script-src https://pay.example.com`, next to the sources your page already allows). This applies to the full checkout page and the popup alike.

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/bell.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Know When the Customer Has Paid

The customer leaves your page to pay, so learn about the payment on your server from the `invoice.paid` webhook or `GET /api/v1/invoices/:id`.

- **Invoice:** for an invoice your server creates, set `redirect_url` when you create it. After payment, the checkout shows a "Back to" button with the business's name that sends the customer to that address. A visit to that address does not prove a payment, so confirm it on your server before you ship anything.
- **Payment link:** set a return address when you create the link (`redirect_url`). Without one, the checkout sends the customer to the business website from the business profile. When neither is set, the customer stays on the "Payment complete" screen, which links to the receipt.

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/code-xml.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Open the Checkout from Your Code

```js
window.Solverr.open({ link: "lnk_8Fq2" });
// or
window.Solverr.open({ invoice: "inv_7h3K9dWq2LmN4pRt6vXy" });
```

With a bundler, install the package and pass your app's address:

```bash
npm install solverr-embed
```

```js
import { open } from "solverr-embed";

open({ baseUrl: "https://pay.example.com", link: "lnk_8Fq2" });
```

`open({ baseUrl })` follows the same rule as the script's `src`: `baseUrl` must be `https://`, or `http://` on a local address.

The package declares its entry points only in package `exports`. Parcel 2 reads them only when you add `"@parcel/resolver-default": { "packageExports": true }` to your app's `package.json`. Without it, the build fails with "Failed to resolve 'solverr-embed'".

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/app-window.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Open the Checkout in a Popup

To keep the customer on your page, open the checkout in a popup over it:

```html
<button data-solverr-link="lnk_8Fq2" data-solverr-mode="overlay">Pay with crypto</button>
```

```js
window.Solverr.open({ link: "lnk_8Fq2" }, "overlay");
```

```js
import { open, PAID_EVENT } from "solverr-embed";

open({ baseUrl: "https://pay.example.com", link: "lnk_8Fq2", mode: "overlay" });
window.addEventListener(PAID_EVENT, (event) => console.log(event.detail.invoice.id));
```

### Know when the customer has paid in the popup

```html
<script>
  window.addEventListener("solverr:paid", (event) => {
    console.log("Paid invoice", event.detail.invoice.id);
    // Show a thank-you message. Fulfill the order from your server's webhook.
  });
</script>
```

The `solverr:paid` event fires on the button that opened the popup and bubbles up to `window`. When your code opened the popup, the event fires on `window`. `event.detail.invoice` has `id`, `object`, `mode`, `status`, `amount`, `currency`, `order_id` and `receipt_url`.

Treat the event as a signal to update the page only. Confirm the payment on your server with the `invoice.paid` webhook or `GET /api/v1/invoices/:id` before you ship anything. The popup does not use `redirect_url`.

### How the popup behaves

- **Layout:** the popup fills the screen on phones and is a centered panel on larger screens. It follows the visitor's light or dark setting.
- **Closing:** it closes with the close button, the Escape key, the browser's close request (such as the Android back gesture), or when the checkout asks to close.
- **Focus:** page scrolling is paused and keyboard focus stays in the popup until it closes. Focus then returns to the element that had it when the popup opened, usually the button that opened it.
- **Motion:** animations are turned off for visitors who ask for reduced motion.
- **Messages:** the popup passes your page's origin to the checkout (`?embed=1&origin=…`), and the checkout sends its paid and close messages to that origin only. Only messages from the checkout frame on your Solverr app's origin are accepted.
- **Content-Security-Policy:** the popup adds one `<style>` element to the page and loads the checkout in a frame. If your site sends a strict `Content-Security-Policy`, allow inline styles (`style-src 'unsafe-inline'`) and frames from your Solverr app (`frame-src https://pay.example.com`). The full checkout page needs neither.

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/shield-check.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> Tests

The tests in `tests/` run with Vitest in jsdom. They stub `matchMedia`, `showModal`, `scrollTo` and page navigation, which jsdom does not provide. They also post checkout messages from the overlay's frame window.

```bash
cd packages
npm ci                                  # install the pinned dev dependencies of every package
cd embed
npx vitest run                          # run every test
npx tsc --noEmit -p tests/tsconfig.json # type-check the tests
```

## <img src="https://github.com/forcequitx/solverr/raw/main/assets/icons/file-text.svg" width="24" height="24" style="vertical-align: middle; margin-right: 4px;"> License

Released under the **MIT License**.
