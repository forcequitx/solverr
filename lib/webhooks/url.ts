import { Resolver } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

const DNS_TIMEOUT_MS = 3_000;
const DNS_TRIES = 2;
/** Queries DNS directly with a bounded timeout instead of the libuv threadpool lookup, which has none. */
const resolver = new Resolver({ timeout: DNS_TIMEOUT_MS, tries: DNS_TRIES });

/** Webhook URLs are supplied by merchants, so the server must never be pointed at its own private network. */
const blocked = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 96],
  ["::1", 128],
  /** IPv4-mapped addresses (::ffff:a.b.c.d) are checked against the IPv4 rules above; a ::ffff:0:0/96 rule would block every IPv4 address. */
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(network, prefix, "ipv6");
}

const isDevelopment = () => process.env.NODE_ENV !== "production";

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/** Every A and AAAA address of `host`; fails when it has neither. */
async function resolveHost(host: string): Promise<string[]> {
  const results = await Promise.allSettled([resolver.resolve4(host), resolver.resolve6(host)]);
  const addresses = results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  if (addresses.length === 0) throw new Error(`No addresses for ${host}`);
  return addresses;
}

/** A checked webhook URL and the public addresses it resolved to; sending must connect only to these. Empty for local development hosts. */
export type WebhookTarget = { url: URL; addresses: string[] };

/** Checks `raw` as a webhook URL and returns where it may be sent, or why it is not allowed. */
export async function checkWebhookUrl(raw: string): Promise<{ target: WebhookTarget } | { problem: string }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { problem: "Enter a full URL, such as https://shop.example/webhooks/solverr." };
  }
  if (url.username || url.password) return { problem: "The webhook URL must not contain a username or password." };

  if (isDevelopment() && isLocalHost(url.hostname)) {
    return url.protocol === "http:" || url.protocol === "https:" ? { target: { url, addresses: [] } } : { problem: "The webhook URL must use http or https." };
  }
  if (url.protocol !== "https:") return { problem: "The webhook URL must use https." };

  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : await resolveHost(host);
  } catch {
    return { problem: `The host ${host} could not be found.` };
  }
  const isPrivate = addresses.some((address) => blocked.check(address, isIP(address) === 6 ? "ipv6" : "ipv4"));
  return isPrivate ? { problem: "The webhook URL must point to a public internet address." } : { target: { url, addresses } };
}

/** Returns an error message when `raw` is not an allowed webhook URL, or `undefined` when it is. */
export async function webhookUrlProblem(raw: string): Promise<string | undefined> {
  const checked = await checkWebhookUrl(raw);
  return "problem" in checked ? checked.problem : undefined;
}
