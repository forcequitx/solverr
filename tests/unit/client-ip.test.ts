import { describe, expect, it } from "vitest";
import { clientIp, clientNetwork } from "@/lib/api/rate-limit";

const requestFrom = (headers: Record<string, string>) => new Request("https://solverr.example/api/v1/invoices", { headers });

describe("clientIp", () => {
  it("takes the first X-Forwarded-For entry, which the proxy sets to the client", () => {
    expect(clientIp(requestFrom({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" }))).toBe("203.0.113.5");
    expect(clientIp(requestFrom({ "x-forwarded-for": "  198.51.100.7  " }))).toBe("198.51.100.7");
  });

  it("falls back to X-Real-IP, then to unknown", () => {
    expect(clientIp(requestFrom({ "x-real-ip": "198.51.100.8" }))).toBe("198.51.100.8");
    expect(clientIp(requestFrom({}))).toBe("unknown");
    expect(clientIp(requestFrom({ "x-forwarded-for": "", "x-real-ip": "198.51.100.9" }))).toBe("198.51.100.9");
  });

  it("limits an IPv6 client by its /64", () => {
    expect(clientIp(requestFrom({ "x-forwarded-for": "2001:db8:abcd:12:1:2:3:4" }))).toBe("2001:db8:abcd:12::/64");
    expect(clientIp(requestFrom({ "x-forwarded-for": "2001:db8:abcd:12:ffff:ffff:ffff:ffff" }))).toBe("2001:db8:abcd:12::/64");
  });

  it("expands :: before cutting to the /64", () => {
    expect(clientIp(requestFrom({ "x-forwarded-for": "2001:db8::1" }))).toBe("2001:db8:0:0::/64");
    expect(clientIp(requestFrom({ "x-forwarded-for": "::1" }))).toBe("0:0:0:0::/64");
  });

  it("writes every spelling of one IPv6 network the same way", () => {
    const spellings = ["2001:DB8:0:0:1::1", "2001:db8:0000:0000:0001:0000:0000:0001", "2001:db8::1:0:0:1"];
    expect(new Set(spellings.map((ip) => clientIp(requestFrom({ "x-forwarded-for": ip }))))).toEqual(new Set(["2001:db8:0:0::/64"]));
  });

  it("drops a zone index", () => {
    expect(clientIp(requestFrom({ "x-forwarded-for": "fe80::1%eth0" }))).toBe("fe80:0:0:0::/64");
  });

  it("turns an IPv4-mapped IPv6 address into its IPv4 address", () => {
    expect(clientIp(requestFrom({ "x-forwarded-for": "::ffff:203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientIp(requestFrom({ "x-forwarded-for": "::ffff:cb00:7109" }))).toBe("203.0.113.9");
    expect(clientIp(requestFrom({ "x-forwarded-for": "0:0:0:0:0:ffff:c633:6401" }))).toBe("198.51.100.1");
  });
});

describe("clientNetwork", () => {
  it("keeps an IPv4 address as it is", () => {
    expect(clientNetwork(requestFrom({ "x-forwarded-for": "203.0.113.5" }))).toBe("203.0.113.5");
    expect(clientNetwork(requestFrom({ "x-forwarded-for": "::ffff:203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("groups IPv6 clients by their /48, so many /64s of one user count together", () => {
    const first = clientNetwork(requestFrom({ "x-forwarded-for": "2001:db8:abcd:1::5" }));
    const second = clientNetwork(requestFrom({ "x-forwarded-for": "2001:db8:abcd:ff00::9" }));
    expect(first).toBe("2001:db8:abcd::/48");
    expect(second).toBe(first);
    expect(clientNetwork(requestFrom({ "x-forwarded-for": "2001:db8:abce::1" }))).not.toBe(first);
  });
});
