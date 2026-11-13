import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { newWebhookSecret, signedHeaders } from "@/lib/webhooks/signature";

/** Verifies a `webhook-signature` header the way a Standard Webhooks receiver does, independently of the signing code. */
function receiverAccepts(secret: string, headers: Record<string, string>, body: string): boolean {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${headers["webhook-id"]}.${headers["webhook-timestamp"]}.${body}`).digest("base64");
  return headers["webhook-signature"].split(" ").some((entry) => entry === `v1,${expected}`);
}

describe("newWebhookSecret", () => {
  it("is whsec_ plus 24 random bytes in standard base64", () => {
    const secret = newWebhookSecret();
    expect(secret).toMatch(/^whsec_[A-Za-z0-9+/]+={0,2}$/);
    expect(Buffer.from(secret.slice("whsec_".length), "base64")).toHaveLength(24);
    expect(newWebhookSecret()).not.toBe(secret);
  });
});

describe("signedHeaders", () => {
  it("matches the Standard Webhooks reference test vector", () => {
    const headers = signedHeaders(["whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw"], "msg_p5jXN8AQM9LWM0D4loKWxJek", 1614265330, '{"test": 2432232314}');
    expect(headers).toEqual({
      "webhook-id": "msg_p5jXN8AQM9LWM0D4loKWxJek",
      "webhook-timestamp": "1614265330",
      "webhook-signature": "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=",
    });
  });

  it("signs id, timestamp and body so a receiver with the secret accepts it", () => {
    const secret = newWebhookSecret();
    const body = JSON.stringify({ id: "evt_1", type: "invoice.paid" });
    const headers = signedHeaders([secret], "evt_1", 1_700_000_000, body);
    expect(receiverAccepts(secret, headers, body)).toBe(true);
    expect(receiverAccepts(secret, headers, body.replace("paid", "failed"))).toBe(false);
    expect(receiverAccepts(secret, { ...headers, "webhook-timestamp": "1700000001" }, body)).toBe(false);
    expect(receiverAccepts(newWebhookSecret(), headers, body)).toBe(false);
  });

  it("adds one signature per secret during a rotation, current secret first", () => {
    const current = newWebhookSecret();
    const previous = newWebhookSecret();
    const headers = signedHeaders([current, previous], "evt_2", 1_700_000_000, "{}");
    const signatures = headers["webhook-signature"].split(" ");
    expect(signatures).toHaveLength(2);
    expect(signatures[0]).toBe(signedHeaders([current], "evt_2", 1_700_000_000, "{}")["webhook-signature"]);
    expect(receiverAccepts(current, headers, "{}")).toBe(true);
    expect(receiverAccepts(previous, headers, "{}")).toBe(true);
  });
});
