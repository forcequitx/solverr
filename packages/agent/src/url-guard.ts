import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { Agent } from "undici";
import { PaymentError } from "./errors.js";
import { isHostAllowed } from "./limits.js";

/** Loopback, private, shared, link-local (cloud metadata), multicast and reserved ranges. IPv4-mapped IPv6 addresses match the IPv4 ranges. */
const PRIVATE_RANGES = new BlockList();
const IPV4_RANGES = [
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
] as const;
const IPV6_RANGES = [
  ["::", 96],
  ["100::", 64],
  ["2001::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const;
for (const [network, prefix] of IPV4_RANGES) PRIVATE_RANGES.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of IPV6_RANGES) PRIVATE_RANGES.addSubnet(network, prefix, "ipv6");

/** NAT64 prefix (`64:ff9b::/96`) whose last 32 bits are an IPv4 address. */
const NAT64_PREFIX = "64:ff9b::";

/** True for an address in a private or reserved range, including an IPv4 address inside the NAT64 prefix. Unparsable input counts as private. */
function isPrivateAddress(address: string): boolean {
  try {
    const family = isIP(address);
    if (family === 4) return PRIVATE_RANGES.check(address, "ipv4");
    if (family !== 6) return true;
    if (PRIVATE_RANGES.check(address, "ipv6")) return true;
    const normalized = new URL(`http://[${address}]`).hostname.slice(1, -1);
    if (!normalized.startsWith(NAT64_PREFIX)) return false;
    const tail = normalized.slice(NAT64_PREFIX.length).split(":").filter(Boolean).map((hextet) => parseInt(hextet, 16));
    while (tail.length < 2) tail.unshift(0);
    const [high, low] = tail;
    return PRIVATE_RANGES.check(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`, "ipv4");
  } catch {
    return true;
  }
}

/** Refuses a host off the allow list or resolving to any private address, unless the URL names that IP or `localhost` and it is allowed exactly.
    Returns the checked public addresses for `pinnedDispatcher`; empty for an IP or `localhost` allowed exactly, which needs no pinning. */
export async function assertFetchAllowed(url: URL, allow: readonly string[]): Promise<string[]> {
  const host = url.hostname.toLowerCase();
  if (!isHostAllowed(host, allow)) {
    throw new PaymentError("host_not_allowed", `Requests to ${host} are not allowed. Add it to the allow list to use this site.`);
  }
  const literal = host.replace(/^\[|\]$/g, "");
  if ((isIP(literal) || host === "localhost") && allow.includes(host)) return [];
  const addresses = isIP(literal) ? [literal] : (await lookup(literal, { all: true, verbatim: true })).map((entry) => entry.address);
  const blocked = addresses.find(isPrivateAddress);
  if (blocked) {
    throw new PaymentError("host_not_allowed", `${host} resolves to the private address ${blocked}. Only public addresses can be requested.`);
  }
  return addresses;
}

/** Dispatcher that connects only to `addresses`, so a DNS answer changed after `assertFetchAllowed` cannot reach a private network.
    Undefined when there is nothing to pin; close it once the response body is read. */
export function pinnedDispatcher(addresses: readonly string[]): Agent | undefined {
  if (addresses.length === 0) return undefined;
  return new Agent({
    connect: {
      lookup: (_hostname, options, callback) => {
        if (options.all) callback(null, addresses.map((address) => ({ address, family: isIP(address) })));
        else callback(null, addresses[0], isIP(addresses[0]));
      },
    },
  });
}
