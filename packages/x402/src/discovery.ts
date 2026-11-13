/** Key of the x402 Bazaar discovery extension in `PaymentRequired.extensions`. */
export const BAZAAR_EXTENSION = "bazaar";

/** Bazaar discovery metadata: `info.input` says how to call the route and `info.output` what it returns;
    `schema` is the JSON Schema (draft 2020-12) a facilitator checks `info` against before it lists the route. */
export interface BazaarDiscovery {
  info: {
    input: { type: "http" | "mcp" } & Record<string, unknown>;
    output?: { type: string } & Record<string, unknown>;
  };
  schema: Record<string, unknown>;
}

/** Throws when `discovery` cannot be a Bazaar extension, so a wrong option fails when the paywall is created. */
export function assertDiscovery(discovery: BazaarDiscovery): void {
  const type = discovery?.info?.input?.type;
  if (type !== "http" && type !== "mcp") throw new Error(`discovery.info.input.type must be "http" or "mcp"; got ${JSON.stringify(type)}.`);
  if (!discovery.schema || typeof discovery.schema !== "object") throw new Error("discovery.schema must be the JSON Schema that validates discovery.info.");
}
