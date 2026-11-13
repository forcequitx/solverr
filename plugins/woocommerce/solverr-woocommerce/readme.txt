=== Solverr for WooCommerce ===
Contributors: solverr
Tags: crypto, payments, woocommerce, payment gateway, near
Requires at least: 6.5
Tested up to: 7.1
Requires PHP: 8.3
WC requires at least: 8.0
WC tested up to: 11.2
Stable tag: 0.1.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Accept crypto payments on 31 chains. You receive the coin you chose in your own wallet.

== Description ==

Solverr is a non-custodial crypto payment gateway built on NEAR Intents. Your customers pay with a coin they already hold on any supported chain, and you receive the coin you chose in your own wallet. Solverr never holds your funds.

How a payment works:

1. The customer chooses "Solverr — pay with any crypto" (the default title) at checkout and places the order.
2. The plugin creates a Solverr invoice for the order total and sends the customer to the Solverr payment page.
3. The customer pays. Solverr sends a signed webhook to your store.
4. The plugin checks the signature and marks the order as paid. The customer returns to your order confirmation page.

Features:

* Works with the classic checkout and the Cart and Checkout blocks.
* Compatible with High-Performance Order Storage (HPOS).
* The plugin checks every webhook's HMAC-SHA256 signature and rejects events whose timestamp is more than 5 minutes off the store's clock. A repeated delivery is applied once.
* Retrying a checkout reuses the order's invoice when the order total and currency have not changed and a payment for the invoice is under way, or the invoice still waits for payment with at least 10 minutes left. Underpaid, failed, refunded and expired invoices are never reused. Otherwise the plugin creates a new invoice for the order.
* The webhook handler locks the order, so deliveries for one order are applied one at a time. When another delivery holds the lock for more than 3 seconds, the store answers 503 and Solverr retries the delivery on its webhook schedule.

Supported store currencies: USD, EUR and INR. With any other store currency the payment method is hidden at checkout and an admin notice explains why.

= Order updates from webhooks =

* `invoice.paid`: the order is marked as paid, and a note records the amount you received. If the invoice is not a live invoice, or its amount or currency does not match the order total, the order is put on hold with a note instead. If the order had moved to another payment method, its payment method is first set back to Solverr. If another invoice already paid the order, only a note is added, asking you to refund this payment from your Solverr dashboard.
* `invoice.expired`: a pending order is cancelled when the expired invoice is the order's current one. An order on hold stays on hold.
* `invoice.failed`: Solverr opens a support case. The order is marked as failed only when the failed invoice is the order's current one and the order is unpaid; otherwise a note is added.
* `invoice.underpaid`: a note records that less than the full amount arrived. NEAR Intents returns those coins to the payer, and the order stays unpaid.
* `invoice.refunded`: a note records that the coins were returned to the payer.
* `invoice.extra_payment`: a note asks you to refund the second payment from your Solverr dashboard.
* Any other event: the store answers 200 and the order does not change.

Refunds you make in Solverr are not applied to the WooCommerce order. Record them in WooCommerce yourself.

== External services ==

This plugin connects to the Solverr server whose address you enter as the API base URL. It needs that server to create a payment page for each order.

When a customer places an order with Solverr, the plugin sends the server the order total, the currency, the order number and id, a description with your store name, the order confirmation address, and the customer's billing email if it is valid. The server uses the email only to send the customer a receipt. Nothing is sent before the customer places the order.

The Solverr server then quotes and routes the payment through NEAR Intents. Read the terms and privacy policy of whoever runs your Solverr server, and the NEAR Intents terms at https://near-intents.org, before you take payments.

== Installation ==

1. Download `solverr-woocommerce.zip` from your Solverr server at `/downloads/solverr-woocommerce.zip`, for example `https://pay.example.com/downloads/solverr-woocommerce.zip`, and upload it under Plugins > Add New Plugin > Upload Plugin. Or unzip it and upload the `solverr-woocommerce` folder to `/wp-content/plugins/`.
2. Activate the plugin. WooCommerce must be active.
3. Open WooCommerce > Settings > Payments > Solverr.
4. Enter your Solverr server address as the API base URL, for example `https://pay.example.com`.
5. In your Solverr dashboard, create an API key and paste it into API key. It starts with `sk_live_`.
6. In your Solverr dashboard, set the webhook URL to the address shown under Webhook secret in the plugin settings (it ends in `/wc-api/solverr/`, or in `?wc-api=solverr` when your permalinks are set to Plain), then paste the webhook signing secret into Webhook secret. A business has one webhook URL, so this replaces any URL saved before. Solverr shows a new signing secret only when the business has none yet; if none appears, select Rotate signing secret, then Rotate it, and paste the new secret. The old secret keeps signing events beside the new one for 24 hours.
7. Tick Enable and save.

The webhook URL must use https, because Solverr only delivers webhooks to public https addresses.

== Frequently Asked Questions ==

= Why is Solverr missing from the checkout? =

The payment method is shown only when it is enabled, the API base URL, an API key that starts with `sk_live_` and a webhook secret that starts with `whsec_` are all filled in, and the store currency is USD, EUR or INR. While Solverr is enabled but hidden, an admin notice says why: it names your store currency when Solverr does not accept it, and otherwise lists the three settings above.

= What happens when the customer pays after the invoice expired? =

If the payment still arrives, Solverr marks the invoice as paid with a late flag and the plugin completes the order, even if it was cancelled.

= How do you try a payment without real money? =

Every API key is a live key, so every order takes a real payment. To see the Solverr checkout without moving real money, open the demo store at `/demo` on your Solverr server.

= Where are errors logged? =

In WooCommerce > Status > Logs, under the source `solverr`. Logs never contain your API key or webhook secret.

== Changelog ==

= 0.1.0 =
* Initial release.
