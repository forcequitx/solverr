import { assertPrice, type Currency } from "./price.js";

/** Path at which agents look for a merchant's price list. */
export const PRICE_LIST_PATH = "/.well-known/solverr.json";

export interface PricedRoute {
  path: string;
  method: string;
  price: string;
  currency: Currency;
  description: string;
}

/** Document served at `/.well-known/solverr.json`. */
export interface PriceListDocument {
  version: 1;
  merchant?: string;
  endpoints: PricedRoute[];
}

export interface PriceListOptions {
  /** Merchant name shown to agents. */
  merchant?: string;
}

/** Builds the price list document, validating every route. */
export function priceListDocument(routes: PricedRoute[], options: PriceListOptions = {}): PriceListDocument {
  const endpoints = routes.map((route) => {
    assertPrice(route.price, route.currency);
    if (!route.path.startsWith("/")) throw new Error(`Route path must start with "/"; got ${JSON.stringify(route.path)}.`);
    return { path: route.path, method: route.method.toUpperCase(), price: route.price, currency: route.currency, description: route.description };
  });
  return { version: 1, ...(options.merchant ? { merchant: options.merchant } : {}), endpoints };
}

/** Web-standard handler that serves the price list; mount it at `/.well-known/solverr.json`. */
export function priceList(routes: PricedRoute[], options: PriceListOptions = {}): (request: Request) => Response {
  const body = JSON.stringify(priceListDocument(routes, options));
  return () =>
    new Response(body, {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" },
    });
}
