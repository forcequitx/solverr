import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fetch } from "undici";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentError } from "../src/errors.js";
import { assertFetchAllowed, pinnedDispatcher } from "../src/url-guard.js";

const dns = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: dns.lookup }));

/** Makes the mocked DNS answer `addresses` for every host. */
function resolvesTo(...addresses: string[]) {
  dns.lookup.mockResolvedValue(addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })));
}

const check = (url: string, allow: string[] = ["api.example.com"]) => assertFetchAllowed(new URL(url), allow);

async function expectRefused(promise: Promise<unknown>) {
  const error = await promise.then(() => undefined, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(PaymentError);
  expect(error).toMatchObject({ code: "host_not_allowed", fundsSent: false });
}

beforeEach(() => dns.lookup.mockReset());

describe("assertFetchAllowed", () => {
  it("refuses a host off the allow list without resolving it", async () => {
    await expectRefused(check("https://evil.example.net/"));
    expect(dns.lookup).not.toHaveBeenCalled();
  });

  it("returns every public address the host resolves to, for pinning", async () => {
    resolvesTo("93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946");
    await expect(check("https://api.example.com/data")).resolves.toEqual(["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"]);
    expect(dns.lookup).toHaveBeenCalledWith("api.example.com", { all: true, verbatim: true });
  });

  it("matches wildcard allow entries on subdomains only", async () => {
    resolvesTo("93.184.216.34");
    await expect(check("https://a.b.example.com/", ["*.example.com"])).resolves.toEqual(["93.184.216.34"]);
    await expectRefused(check("https://example.com/", ["*.example.com"]));
    await expectRefused(check("https://evilexample.com/", ["*.example.com"]));
  });

  it.each([
    "0.0.0.0",
    "10.1.2.3",
    "100.64.0.1",
    "127.0.0.1",
    "127.255.255.254",
    "169.254.169.254",
    "172.16.5.4",
    "172.31.255.255",
    "192.0.0.8",
    "192.168.1.1",
    "198.18.0.1",
    "224.0.0.1",
    "255.255.255.255",
  ])("refuses a host resolving to the private or reserved IPv4 address %s", async (address) => {
    resolvesTo(address);
    await expectRefused(check("https://api.example.com/"));
  });

  it.each(["::", "::1", "100::1", "2001::1", "2002::1", "fc00::1", "fd12:3456::1", "fe80::1", "fec0::1", "ff02::1"])(
    "refuses a host resolving to the private or reserved IPv6 address %s",
    async (address) => {
      resolvesTo(address);
      await expectRefused(check("https://api.example.com/"));
    },
  );

  it.each(["::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1", "::ffff:169.254.169.254"])("refuses the IPv4-mapped private address %s", async (address) => {
    resolvesTo(address);
    await expectRefused(check("https://api.example.com/"));
  });

  it.each(["64:ff9b::7f00:1", "64:ff9b::10.0.0.1", "64:ff9b::a9fe:a9fe", "64:ff9b::1"])("refuses the NAT64 address %s that wraps a private IPv4 address", async (address) => {
    resolvesTo(address);
    await expectRefused(check("https://api.example.com/"));
  });

  it.each(["::ffff:8.8.8.8", "64:ff9b::808:808", "64:ff9b::8.8.4.4"])("accepts %s, which wraps a public IPv4 address", async (address) => {
    resolvesTo(address);
    await expect(check("https://api.example.com/")).resolves.toEqual([address]);
  });

  it("refuses the host when any one of its addresses is private", async () => {
    resolvesTo("93.184.216.34", "10.0.0.5");
    await expectRefused(check("https://api.example.com/"));
  });

  it("treats an address it cannot parse as private", async () => {
    resolvesTo("not-an-address");
    await expectRefused(check("https://api.example.com/"));
  });

  it("lets an exactly allowed IP literal or localhost through without resolving or pinning", async () => {
    await expect(check("http://127.0.0.1:8080/", ["127.0.0.1"])).resolves.toEqual([]);
    await expect(check("http://[::1]:8080/", ["[::1]"])).resolves.toEqual([]);
    await expect(check("http://localhost:3000/", ["localhost"])).resolves.toEqual([]);
    expect(dns.lookup).not.toHaveBeenCalled();
  });

  it("still checks a private IP literal that only a wildcard allows", async () => {
    await expectRefused(check("http://10.0.0.1/", ["*.0.0.1"]));
    expect(dns.lookup).not.toHaveBeenCalled();
  });

  it("checks a public IP literal itself instead of resolving it", async () => {
    await expect(check("https://93.184.216.34/", ["*.216.34"])).resolves.toEqual(["93.184.216.34"]);
    expect(dns.lookup).not.toHaveBeenCalled();
  });

  it("resolves and refuses a wildcard-allowed name that points at loopback", async () => {
    resolvesTo("127.0.0.1");
    await expectRefused(check("http://app.localhost/", ["*.localhost"]));
    expect(dns.lookup).toHaveBeenCalledWith("app.localhost", { all: true, verbatim: true });
  });
});

describe("pinnedDispatcher", () => {
  let server: Server;
  let port: number;
  let seenHost: string | undefined;

  beforeEach(async () => {
    server = createServer((request, response) => {
      seenHost = request.headers.host;
      response.end("pinned");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("returns undefined when there is nothing to pin", () => {
    expect(pinnedDispatcher([])).toBeUndefined();
  });

  it("connects to the checked address whatever the host name resolves to", async () => {
    const dispatcher = pinnedDispatcher(["127.0.0.1"]);
    expect(dispatcher).toBeDefined();
    try {
      const response = await fetch(`http://never-resolved.invalid:${port}/`, { dispatcher });
      expect(await response.text()).toBe("pinned");
      expect(seenHost).toBe(`never-resolved.invalid:${port}`);
    } finally {
      await dispatcher?.close();
    }
  });
});
