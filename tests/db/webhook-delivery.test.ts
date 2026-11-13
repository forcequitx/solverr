import { createHmac } from "node:crypto";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Merchant } from "@/generated/prisma/client";
import { encryptSecret } from "@/lib/crypto";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/ids";
import { deliverDueWebhooks, sendDelivery } from "@/lib/webhooks/deliver";
import { newWebhookSecret } from "@/lib/webhooks/signature";
import { createMerchant } from "./factories";

type Received = { path: string; headers: IncomingHttpHeaders; body: string };
/** `together` holds each answer until that many requests are waiting, then answers them all at once, so parallel lanes fail at the same moment. */
type Answer = { status: number; headers?: Record<string, string>; together?: number };

/** A local endpoint on 127.0.0.1 (allowed outside production) that records requests and answers as the test sets. */
let server: Server;
let received: Received[];
let answer: Answer;
let baseUrl: string;

beforeEach(async () => {
  received = [];
  answer = { status: 204 };
  const held: (() => void)[] = [];
  server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString()));
    request.on("end", () => {
      received.push({ path: request.url ?? "", headers: request.headers, body });
      held.push(() => response.writeHead(answer.status, answer.headers).end());
      if (held.length >= (answer.together ?? 1)) held.splice(0).forEach((send) => send());
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function queuedDelivery(merchant: Merchant) {
  const id = newId("evt");
  const delivery = await getDb().webhookDelivery.create({
    data: { id, merchantId: merchant.id, eventType: "invoice.paid", payload: { id, type: "invoice.paid", data: { invoice: { id: "inv_1" } } } },
  });
  return { ...delivery, merchant };
}

async function merchantWithEndpoint(secret = newWebhookSecret()) {
  const merchant = await createMerchant({ webhookUrl: `${baseUrl}/hook`, webhookSecretEnc: encryptSecret(secret) });
  return { merchant, secret };
}

describe("sendDelivery", () => {
  it("posts the event signed the Standard Webhooks way and marks it delivered", async () => {
    const { merchant, secret } = await merchantWithEndpoint();
    const delivery = await queuedDelivery(merchant);

    expect(await sendDelivery(delivery)).toEqual({ ok: true, responseCode: 204 });
    const [request] = received;
    expect(request.path).toBe("/hook");
    expect(JSON.parse(request.body)).toEqual(delivery.payload);
    expect(request.headers["content-type"]).toBe("application/json");
    expect(request.headers["webhook-id"]).toBe(delivery.id);
    const key = Buffer.from(secret.slice("whsec_".length), "base64");
    const expected = createHmac("sha256", key).update(`${delivery.id}.${request.headers["webhook-timestamp"]}.${request.body}`).digest("base64");
    expect(request.headers["webhook-signature"]).toBe(`v1,${expected}`);
    expect(await getDb().webhookDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).toMatchObject({ status: "delivered", attempts: 1 });
  });

  it("does not follow a redirect, and schedules a retry", async () => {
    const { merchant } = await merchantWithEndpoint();
    answer = { status: 302, headers: { location: `${baseUrl}/elsewhere` } };
    const delivery = await queuedDelivery(merchant);

    expect(await sendDelivery(delivery)).toMatchObject({ ok: false, responseCode: 302 });
    expect(received.map((request) => request.path)).toEqual(["/hook"]);
    const after = await getDb().webhookDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(after).toMatchObject({ status: "pending", attempts: 1, responseCode: 302 });
    expect(after.nextRetryAt!.getTime()).toBeGreaterThan(Date.now() + 50_000);
  });

  it("waits as long as a throttled endpoint's Retry-After asks", async () => {
    const { merchant } = await merchantWithEndpoint();
    answer = { status: 503, headers: { "retry-after": "600" } };
    const delivery = await queuedDelivery(merchant);
    await sendDelivery(delivery);
    const after = await getDb().webhookDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(after.nextRetryAt!.getTime()).toBeGreaterThan(Date.now() + 590_000);
  });

  it("turns webhooks off for an endpoint that answers 410 Gone", async () => {
    const { merchant } = await merchantWithEndpoint();
    answer = { status: 410 };
    const delivery = await queuedDelivery(merchant);
    const waiting = await queuedDelivery(merchant);
    await sendDelivery(delivery);
    expect((await getDb().merchant.findUniqueOrThrow({ where: { id: merchant.id } })).webhookDisabledAt).not.toBeNull();
    expect(await getDb().webhookDelivery.findUniqueOrThrow({ where: { id: waiting.id } })).toMatchObject({ status: "failed" });
  });

  it("pauses an endpoint that does not answer at all", async () => {
    const { merchant } = await merchantWithEndpoint();
    await new Promise((resolve) => server.close(resolve));
    server = createServer();
    const outcome = await sendDelivery(await queuedDelivery(merchant));
    expect(outcome).toMatchObject({ ok: false, unreachable: true });
    expect((await getDb().merchant.findUniqueOrThrow({ where: { id: merchant.id } })).webhookPausedUntil).not.toBeNull();
  });

  it("sends nothing to a private address, even one saved before the check existed", async () => {
    const merchant = await createMerchant({ webhookUrl: "https://10.0.0.5/hook", webhookSecretEnc: encryptSecret(newWebhookSecret()) });
    expect(await sendDelivery(await queuedDelivery(merchant))).toMatchObject({ ok: false, error: "The webhook URL must point to a public internet address." });
  });

  it("leases a delivery so a second sender does not send it again", async () => {
    const { merchant } = await merchantWithEndpoint();
    const delivery = await queuedDelivery(merchant);
    const [first, second] = await Promise.all([sendDelivery(delivery), sendDelivery(delivery)]);
    expect([first.ok, second.ok].sort()).toEqual([false, true]);
    expect(received).toHaveLength(1);
  });

  it("ends a delivery at once, with no retry or alert, when webhooks are off or no URL is set", async () => {
    const unset = await createMerchant();
    const { merchant: off } = await merchantWithEndpoint();
    await getDb().merchant.update({ where: { id: off.id }, data: { webhookDisabledAt: new Date() } });

    for (const merchant of [unset, await getDb().merchant.findUniqueOrThrow({ where: { id: off.id } })]) {
      const delivery = await queuedDelivery(merchant);
      expect(await sendDelivery(delivery)).toMatchObject({ ok: false, ended: true });
      expect(await getDb().webhookDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).toMatchObject({ status: "failed", attempts: 1, nextRetryAt: null });
    }
    expect(received).toHaveLength(0);
    expect(await getDb().alert.count()).toBe(0);
  });
});

describe("deliverDueWebhooks", () => {
  it("raises one failed-webhook alert per business even when several deliveries fail their last attempt at once", async () => {
    answer = { status: 500, together: 4 };
    const { merchant } = await merchantWithEndpoint();
    for (let index = 0; index < 4; index++) {
      const delivery = await queuedDelivery(merchant);
      await getDb().webhookDelivery.update({ where: { id: delivery.id }, data: { attempts: 8, nextRetryAt: new Date(Date.now() - 1_000) } });
    }

    await deliverDueWebhooks(new AbortController().signal);
    expect(await getDb().webhookDelivery.count({ where: { status: "failed" } })).toBe(4);
    expect(await getDb().alert.count({ where: { merchantId: merchant.id, kind: "webhook_failed" } })).toBe(1);
  });
});
