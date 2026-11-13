import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Webhooks, WebhookVerificationError } from "../src/index.js";

const NOW_SECONDS = 1_800_000_000;
const KEY = Buffer.alloc(32, 7);
const SECRET = `whsec_${KEY.toString("base64")}`;
const BODY = JSON.stringify({ id: "evt_1", type: "invoice.paid", data: { id: "inv_1" } });

function sign(id: string, timestamp: string | number, body: string | Buffer, key: Buffer = KEY): string {
  return createHmac("sha256", key).update(`${id}.${timestamp}.`).update(body).digest("base64");
}

function headers(signature: string, timestamp: string | number = NOW_SECONDS, id = "msg_1"): Record<string, string> {
  return { "webhook-id": id, "webhook-timestamp": String(timestamp), "webhook-signature": signature };
}

const webhooks = new Webhooks();

function verifyError(run: () => unknown): WebhookVerificationError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(WebhookVerificationError);
    return error as WebhookVerificationError;
  }
  throw new Error("verify did not throw");
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW_SECONDS * 1000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a valid webhook", () => {
  it("returns the parsed event", () => {
    const event = webhooks.verify(BODY, headers(`v1,${sign("msg_1", NOW_SECONDS, BODY)}`), SECRET);
    expect(event).toEqual(JSON.parse(BODY));
  });

  it("accepts the body as bytes", () => {
    const bytes = new TextEncoder().encode(BODY);
    const event = webhooks.verify(bytes, headers(`v1,${sign("msg_1", NOW_SECONDS, BODY)}`), SECRET);
    expect(event).toEqual(JSON.parse(BODY));
  });

  it("reads a Headers instance", () => {
    const signed = new Headers(headers(`v1,${sign("msg_1", NOW_SECONDS, BODY)}`));
    expect(webhooks.verify(BODY, signed, SECRET)).toEqual(JSON.parse(BODY));
  });

  it("reads plain-object headers in any casing and single-item arrays", () => {
    const signed = { "Webhook-Id": ["msg_1"], "WEBHOOK-TIMESTAMP": String(NOW_SECONDS), "webhook-Signature": `v1,${sign("msg_1", NOW_SECONDS, BODY)}` };
    expect(webhooks.verify(BODY, signed, SECRET)).toEqual(JSON.parse(BODY));
  });

  it("accepts any matching v1 entry, as during secret rotation", () => {
    const oldKey = Buffer.alloc(32, 9);
    const signature = `v1,${sign("msg_1", NOW_SECONDS, BODY, oldKey)} v1,${sign("msg_1", NOW_SECONDS, BODY)}`;
    expect(webhooks.verify(BODY, headers(signature), SECRET)).toEqual(JSON.parse(BODY));
  });

  it("accepts a timestamp exactly at the tolerance in either direction", () => {
    for (const timestamp of [NOW_SECONDS - 300, NOW_SECONDS + 300]) {
      expect(() => webhooks.verify(BODY, headers(`v1,${sign("msg_1", timestamp, BODY)}`, timestamp), SECRET)).not.toThrow();
    }
  });

  it("uses a custom tolerance", () => {
    const timestamp = NOW_SECONDS - 1000;
    const signed = headers(`v1,${sign("msg_1", timestamp, BODY)}`, timestamp);
    expect(() => webhooks.verify(BODY, signed, SECRET, { toleranceSeconds: 1000 })).not.toThrow();
    expect(() => webhooks.verify(BODY, signed, SECRET, { toleranceSeconds: 999 })).toThrow(WebhookVerificationError);
  });
});

describe("signature checks", () => {
  it("refuses a tampered body", () => {
    const signature = `v1,${sign("msg_1", NOW_SECONDS, BODY)}`;
    const tampered = BODY.replace("inv_1", "inv_2");
    expect(verifyError(() => webhooks.verify(tampered, headers(signature), SECRET)).message).toMatch(/signature does not match/);
  });

  it("refuses a signature made for another webhook id or timestamp", () => {
    expect(() => webhooks.verify(BODY, headers(`v1,${sign("msg_2", NOW_SECONDS, BODY)}`), SECRET)).toThrow(/does not match/);
    expect(() => webhooks.verify(BODY, headers(`v1,${sign("msg_1", NOW_SECONDS - 1, BODY)}`), SECRET)).toThrow(/does not match/);
  });

  it("refuses a signature made with another secret", () => {
    const signature = `v1,${sign("msg_1", NOW_SECONDS, BODY, Buffer.alloc(32, 8))}`;
    expect(() => webhooks.verify(BODY, headers(signature), SECRET)).toThrow(/does not match/);
  });

  it("ignores entries that are not v1", () => {
    const signature = sign("msg_1", NOW_SECONDS, BODY);
    expect(() => webhooks.verify(BODY, headers(`v2,${signature} ${signature}`), SECRET)).toThrow(/does not match/);
  });

  it("refuses the signature without its base64 padding", () => {
    const signature = sign("msg_1", NOW_SECONDS, BODY);
    expect(signature.endsWith("=")).toBe(true);
    expect(() => webhooks.verify(BODY, headers(`v1,${signature.replace(/=+$/, "")}`), SECRET)).toThrow(/does not match/);
  });

  it("refuses the signature in the URL-safe base64 alphabet", () => {
    let id = "";
    let signature = "";
    for (let n = 0; !/[+/]/.test(signature); n++) {
      id = `msg_${n}`;
      signature = sign(id, NOW_SECONDS, BODY);
    }
    const urlSafe = signature.replace(/\+/g, "-").replace(/\//g, "_");
    expect(() => webhooks.verify(BODY, headers(`v1,${signature}`, NOW_SECONDS, id), SECRET)).not.toThrow();
    expect(() => webhooks.verify(BODY, headers(`v1,${urlSafe}`, NOW_SECONDS, id), SECRET)).toThrow(/does not match/);
  });
});

describe("timestamp checks", () => {
  it.each([["stale", NOW_SECONDS - 301], ["in the future", NOW_SECONDS + 301]])("refuses a correctly signed timestamp that is %s", (_label, timestamp) => {
    const signed = headers(`v1,${sign("msg_1", timestamp, BODY)}`, timestamp);
    expect(verifyError(() => webhooks.verify(BODY, signed, SECRET)).message).toMatch(/more than 300 seconds/);
  });

  it.each(["", "abc", "1.5", "-1", "1234567890123", " 1800000000"])("refuses the timestamp %j", (timestamp) => {
    const signed = headers(`v1,${sign("msg_1", timestamp, BODY)}`, timestamp);
    expect(() => webhooks.verify(BODY, signed, SECRET)).toThrow(WebhookVerificationError);
  });

  it.each([-1, 1.5, Number.NaN])("refuses the tolerance %d", (toleranceSeconds) => {
    expect(() => webhooks.verify(BODY, headers("v1,x"), SECRET, { toleranceSeconds })).toThrow(/toleranceSeconds/);
  });
});

describe("secret checks", () => {
  const signature = `v1,${sign("msg_1", NOW_SECONDS, BODY)}`;

  it.each([
    ["without the whsec_ prefix", KEY.toString("base64")],
    ["with another prefix", `whsk_${KEY.toString("base64")}`],
  ])("refuses a secret %s", (_label, secret) => {
    expect(verifyError(() => webhooks.verify(BODY, headers(signature), secret)).message).toMatch(/start with whsec_/);
  });

  it.each([
    ["shorter than 24 bytes", `whsec_${Buffer.alloc(23, 7).toString("base64")}`],
    ["empty after the prefix", "whsec_"],
    ["in the URL-safe alphabet", `whsec_${Buffer.alloc(32, 0xfb).toString("base64url")}`],
    ["with characters outside base64", `whsec_${KEY.toString("base64").slice(0, -4)}!!!!`],
    ["with misplaced padding", `whsec_=${KEY.toString("base64")}`],
  ])("refuses a secret %s", (_label, secret) => {
    expect(verifyError(() => webhooks.verify(BODY, headers(signature), secret)).message).toMatch(/at least 24 bytes in standard base64/);
  });

  it("accepts a 24-byte secret", () => {
    const key = Buffer.alloc(24, 3);
    const signed = headers(`v1,${sign("msg_1", NOW_SECONDS, BODY, key)}`);
    expect(() => webhooks.verify(BODY, signed, `whsec_${key.toString("base64")}`)).not.toThrow();
  });

  it("refuses a secret that is not a string", () => {
    expect(() => webhooks.verify(BODY, headers(signature), undefined as unknown as string)).toThrow(/start with whsec_/);
  });
});

describe("body and header checks", () => {
  it("refuses a correctly signed body that is not JSON", () => {
    const body = "not json";
    expect(verifyError(() => webhooks.verify(body, headers(`v1,${sign("msg_1", NOW_SECONDS, body)}`), SECRET)).message).toMatch(/not valid JSON/);
  });

  it.each(["[1,2]", "[]", "null", "5", '"invoice.paid"', "true"])("refuses the correctly signed body %s, which is JSON but not an object", (body) => {
    const signed = headers(`v1,${sign("msg_1", NOW_SECONDS, body)}`);
    expect(verifyError(() => webhooks.verify(body, signed, SECRET)).message).toBe("The webhook body is not a JSON object.");
  });

  it("refuses a parsed body instead of the raw one", () => {
    const parsed = JSON.parse(BODY) as unknown as string;
    expect(() => webhooks.verify(parsed, headers(`v1,${sign("msg_1", NOW_SECONDS, BODY)}`), SECRET)).toThrow(/raw request body/);
  });

  it.each(["webhook-id", "webhook-timestamp", "webhook-signature"])("refuses a request without %s", (name) => {
    const signed: Record<string, string> = headers(`v1,${sign("msg_1", NOW_SECONDS, BODY)}`);
    delete signed[name];
    expect(() => webhooks.verify(BODY, signed, SECRET)).toThrow(/header is missing/);
  });

  it("treats a header sent twice as missing", () => {
    const signed = { ...headers(`v1,${sign("msg_1", NOW_SECONDS, BODY)}`), "webhook-id": ["msg_1", "msg_2"] };
    expect(() => webhooks.verify(BODY, signed, SECRET)).toThrow(/header is missing/);
  });

  it("refuses missing headers", () => {
    expect(() => webhooks.verify(BODY, null as unknown as Headers, SECRET)).toThrow(/header is missing/);
  });
});

describe("sendTest", () => {
  it("needs a client with an API key", async () => {
    await expect(new Webhooks().sendTest()).rejects.toThrow(/needs an API key/);
  });
});
