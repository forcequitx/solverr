import { BASE_URL_ENV, LOCAL_HOSTS } from "./config.js";
import { HttpClient } from "./http.js";
import { Credits } from "./resources/credits.js";
import { Invoices } from "./resources/invoices.js";
import { PaymentLinks } from "./resources/payment-links.js";
import { Payouts } from "./resources/payouts.js";
import { Refunds } from "./resources/refunds.js";
import { Subscriptions } from "./resources/subscriptions.js";
import { Tokens } from "./resources/tokens.js";
import { Webhooks } from "./resources/webhooks.js";

export interface SolverrOptions {
  /** API key starting with `sk_live_`. */
  apiKey: string | undefined;
  /** Origin of the Solverr app, such as "https://pay.example.com". Defaults to the SOLVERR_URL environment variable. */
  baseUrl?: string;
}

const API_KEY_PATTERN = /^sk_live_[\x21-\x7E]+$/;

function resolveBaseUrl(baseUrl: string | undefined): URL {
  const value = baseUrl ?? process.env[BASE_URL_ENV];
  if (!value) throw new TypeError(`Pass baseUrl to new Solverr() or set the ${BASE_URL_ENV} environment variable.`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`baseUrl is not a valid URL: ${value}`);
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname))) {
    throw new TypeError("baseUrl must be an https URL (http only for localhost).");
  }
  return url;
}

export class Solverr {
  readonly invoices: Invoices;
  readonly paymentLinks: PaymentLinks;
  readonly refunds: Refunds;
  readonly payouts: Payouts;
  readonly subscriptions: Subscriptions;
  readonly credits: Credits;
  readonly tokens: Tokens;
  readonly webhooks: Webhooks;

  constructor(options: SolverrOptions) {
    if (!options.apiKey || !API_KEY_PATTERN.test(options.apiKey)) {
      throw new TypeError("apiKey must be a Solverr API key starting with sk_live_.");
    }
    const http = new HttpClient(options.apiKey, resolveBaseUrl(options.baseUrl));
    this.invoices = new Invoices(http);
    this.paymentLinks = new PaymentLinks(http);
    this.refunds = new Refunds(http);
    this.payouts = new Payouts(http);
    this.subscriptions = new Subscriptions(http);
    this.credits = new Credits(http);
    this.tokens = new Tokens(http);
    this.webhooks = new Webhooks(http);
  }
}
