import type { HttpClient } from "../http.js";
import type { TokenList } from "../types.js";

export class Tokens {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  /** Lists the coins the checkout accepts, with USD prices; the API caches the list for 60 seconds. */
  list(): Promise<TokenList> {
    return this.#http.request({ method: "GET", path: "/api/v1/tokens" });
  }
}
