import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkWebhookUrl, webhookUrlProblem } from "@/lib/webhooks/url";

/** DNS answers by host name; a missing entry behaves like NXDOMAIN, so no test ever reaches a real resolver. */
const dns = vi.hoisted(() => ({ a: new Map<string, string[]>(), aaaa: new Map<string, string[]>() }));

vi.mock("node:dns/promises", () => {
  const answer = (table: Map<string, string[]>, host: string) =>
    table.has(host) ? Promise.resolve(table.get(host)!) : Promise.reject(Object.assign(new Error(`queryA ENOTFOUND ${host}`), { code: "ENOTFOUND" }));
  class Resolver {
    resolve4(host: string) {
      return answer(dns.a, host);
    }
    resolve6(host: string) {
      return answer(dns.aaaa, host);
    }
  }
  return { Resolver };
});

const PUBLIC_ONLY = "The webhook URL must point to a public internet address.";

beforeEach(() => {
  dns.a.clear();
  dns.aaaa.clear();
});

describe("checkWebhookUrl in production", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
  });

  it("accepts an https URL whose host resolves only to public addresses, and returns them", async () => {
    dns.a.set("shop.example", ["93.184.216.34"]);
    dns.aaaa.set("shop.example", ["2606:2800:220:1:248:1893:25c8:1946"]);
    const checked = await checkWebhookUrl("https://shop.example/webhooks/solverr");
    expect(checked).toEqual({ target: { url: new URL("https://shop.example/webhooks/solverr"), addresses: ["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"] } });
  });

  it("refuses http, even for localhost", async () => {
    expect(await webhookUrlProblem("http://shop.example/hook")).toBe("The webhook URL must use https.");
    expect(await webhookUrlProblem("http://localhost:3000/hook")).toBe("The webhook URL must use https.");
  });

  it("refuses text that is not a URL, and a URL with a username or password", async () => {
    expect(await webhookUrlProblem("shop.example/hook")).toMatch(/^Enter a full URL/);
    expect(await webhookUrlProblem("https://user:pass@shop.example/hook")).toBe("The webhook URL must not contain a username or password.");
  });

  it.each([
    ["loopback", "https://127.0.0.1/hook"],
    ["private 10/8", "https://10.1.2.3/hook"],
    ["private 172.16/12", "https://172.31.255.1/hook"],
    ["private 192.168/16", "https://192.168.1.1/hook"],
    ["carrier-grade NAT", "https://100.64.0.1/hook"],
    ["cloud metadata", "https://169.254.169.254/latest/meta-data"],
    ["unspecified", "https://0.0.0.0/hook"],
    ["multicast", "https://224.0.0.1/hook"],
    ["reserved", "https://240.0.0.1/hook"],
    ["benchmarking", "https://198.18.0.1/hook"],
  ])("refuses a %s IPv4 address", async (_name, url) => {
    expect(await webhookUrlProblem(url)).toBe(PUBLIC_ONLY);
  });

  it.each([
    ["decimal", "https://2130706433/hook"],
    ["hex", "https://0x7f000001/hook"],
    ["octal", "https://0177.0.0.1/hook"],
    ["short", "https://127.1/hook"],
    ["decimal private network", "https://3232235777/hook"],
    ["decimal metadata", "https://2852039166/hook"],
  ])("refuses a %s spelling of a private IPv4 address", async (_name, url) => {
    expect(await webhookUrlProblem(url)).toBe(PUBLIC_ONLY);
  });

  it.each([
    ["loopback", "https://[::1]/hook"],
    ["unspecified", "https://[::]/hook"],
    ["link-local", "https://[fe80::1]/hook"],
    ["unique local", "https://[fd12:3456:789a::1]/hook"],
    ["AWS metadata", "https://[fd00:ec2::254]/hook"],
    ["site-local", "https://[fec0::1]/hook"],
    ["multicast", "https://[ff02::1]/hook"],
    ["IPv4-mapped loopback", "https://[::ffff:127.0.0.1]/hook"],
    ["IPv4-mapped metadata in hex", "https://[::ffff:a9fe:a9fe]/hook"],
    ["IPv4-compatible loopback", "https://[::127.0.0.1]/hook"],
    ["NAT64", "https://[64:ff9b::7f00:1]/hook"],
    ["local-use NAT64", "https://[64:ff9b:1::a00:1]/hook"],
    ["6to4", "https://[2002:7f00:1::1]/hook"],
    ["Teredo", "https://[2001:0:4136:e378::1]/hook"],
    ["discard-only", "https://[100::1]/hook"],
  ])("refuses a %s IPv6 address", async (_name, url) => {
    expect(await webhookUrlProblem(url)).toBe(PUBLIC_ONLY);
  });

  it("accepts public IPv4, IPv6 and IPv4-mapped public addresses", async () => {
    expect(await webhookUrlProblem("https://93.184.216.34/hook")).toBeUndefined();
    expect(await webhookUrlProblem("https://[2606:4700:4700::1111]/hook")).toBeUndefined();
    expect(await webhookUrlProblem("https://[::ffff:8.8.8.8]/hook")).toBeUndefined();
  });

  it("refuses a host name that resolves to a private address", async () => {
    dns.a.set("internal.example", ["10.0.0.5"]);
    expect(await webhookUrlProblem("https://internal.example/hook")).toBe(PUBLIC_ONLY);
  });

  it("refuses a host name when any one of its addresses is private", async () => {
    dns.a.set("mixed.example", ["93.184.216.34"]);
    dns.aaaa.set("mixed.example", ["fd00::1"]);
    expect(await webhookUrlProblem("https://mixed.example/hook")).toBe(PUBLIC_ONLY);
  });

  it("refuses a metadata host name that resolves to the metadata address", async () => {
    dns.a.set("metadata.google.internal", ["169.254.169.254"]);
    expect(await webhookUrlProblem("https://metadata.google.internal/computeMetadata/v1/")).toBe(PUBLIC_ONLY);
  });

  it("refuses a host name with no addresses", async () => {
    expect(await webhookUrlProblem("https://missing.example/hook")).toBe("The host missing.example could not be found.");
  });

  it("does not treat localhost as local outside development", async () => {
    expect(await webhookUrlProblem("https://localhost/hook")).toBe("The host localhost could not be found.");
  });
});

describe("checkWebhookUrl in development", () => {
  it("accepts http to localhost without resolving it", async () => {
    expect(await checkWebhookUrl("http://localhost:3000/hook")).toEqual({ target: { url: new URL("http://localhost:3000/hook"), addresses: [] } });
    expect(await webhookUrlProblem("http://127.0.0.1:3000/hook")).toBeUndefined();
    expect(await webhookUrlProblem("http://[::1]:3000/hook")).toBeUndefined();
  });

  it("still refuses other schemes and other private hosts", async () => {
    expect(await webhookUrlProblem("ftp://localhost/hook")).toBe("The webhook URL must use http or https.");
    expect(await webhookUrlProblem("http://10.0.0.1/hook")).toBe("The webhook URL must use https.");
    expect(await webhookUrlProblem("https://10.0.0.1/hook")).toBe(PUBLIC_ONLY);
  });
});
