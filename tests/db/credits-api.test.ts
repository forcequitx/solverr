import { describe, expect, it, vi } from "vitest";
import type { Merchant } from "@/generated/prisma/client";
import { POST as chargeRoute } from "@/app/api/v1/credits/charge/route";
import { POST as refundRoute } from "@/app/api/v1/credits/charges/[id]/refund/route";
import { POST as topupRoute } from "@/app/api/v1/credits/topup/route";
import { createApiKey } from "@/lib/api/keys";
import { charge } from "@/lib/credits/credits";
import { getDb } from "@/lib/db";
import { createMerchant } from "./factories";
import { fundCredits } from "./settle";

/** Top-ups price their invoice from the token list, which stands in for 1Click here. */
vi.mock("@/lib/oneclick/tokens", async (importOriginal) => {
  const { TEST_TOKENS } = await import("./factories");
  return {
    ...(await importOriginal<typeof import("@/lib/oneclick/tokens")>()),
    findToken: async (assetId: string) => TEST_TOKENS.find((token) => token.assetId === assetId),
  };
});

/** A POST to the API as the paywall middleware sends it; `secret` null sends no Authorization header. */
function post(path: string, secret: string | null, body?: object, idempotencyKey?: string): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret) headers.authorization = `Bearer ${secret}`;
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  return new Request(`http://localhost:3000${path}`, { method: "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

const refund = (chargeId: string, secret: string, idempotencyKey?: string) =>
  refundRoute(post(`/api/v1/credits/charges/${chargeId}/refund`, secret, undefined, idempotencyKey), { params: Promise.resolve({ id: chargeId }) });

const balanceOf = async (accountId: string) => (await getDb().creditAccount.findUniqueOrThrow({ where: { id: accountId } })).balance.toFixed(6);

/** A business with a live API key and an agent holding `amount` USD of credits. */
async function fundedBusiness(amount = "5"): Promise<{ merchant: Merchant; secret: string } & Awaited<ReturnType<typeof fundCredits>>> {
  const merchant = await createMerchant();
  const { secret } = await createApiKey(merchant.id);
  return { merchant, secret, ...(await fundCredits(merchant, amount)) };
}

describe("POST /api/v1/credits/topup", () => {
  it("needs a valid live API key", async () => {
    const merchant = await createMerchant();
    const { id, secret } = await createApiKey(merchant.id);

    const anonymous = await topupRoute(post("/api/v1/credits/topup", null, { amount: "5", currency: "USD" }));
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("WWW-Authenticate")).toBe("Bearer");
    expect(await anonymous.json()).toMatchObject({ error: { type: "authentication_failed" } });

    await getDb().apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
    expect((await topupRoute(post("/api/v1/credits/topup", secret, { amount: "5", currency: "USD" }))).status).toBe(401);
    expect(await getDb().creditAccount.count()).toBe(0);
  });

  it("creates one account for a retried request and replays the same token", async () => {
    const merchant = await createMerchant();
    const { secret } = await createApiKey(merchant.id);
    const body = { amount: "5", currency: "USD" };

    const first = await topupRoute(post("/api/v1/credits/topup", secret, body, "topup-1"));
    const retry = await topupRoute(post("/api/v1/credits/topup", secret, body, "topup-1"));
    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retry.headers.get("Idempotent-Replayed")).toBe("true");
    const [created, replayed] = [await first.json(), await retry.json()];
    expect(replayed).toEqual(created);
    expect(created.credit_account.token).toMatch(/^solverr_credit_/);
    expect(await getDb().creditAccount.count()).toBe(1);
    expect(await getDb().invoice.count()).toBe(1);
  });

  it("refuses amounts finer than cents and currencies other than USD", async () => {
    const merchant = await createMerchant();
    const { secret } = await createApiKey(merchant.id);

    const cents = await topupRoute(post("/api/v1/credits/topup", secret, { amount: "1.005", currency: "USD" }));
    expect(cents.status).toBe(400);
    expect(await cents.json()).toEqual({ error: { type: "invalid_request", message: "Top-ups use at most 2 decimals.", param: "amount" } });

    const euros = await topupRoute(post("/api/v1/credits/topup", secret, { amount: "5", currency: "EUR" }));
    expect(euros.status).toBe(400);
    expect(await euros.json()).toEqual({ error: { type: "invalid_request", message: "Credits are kept in USD.", param: "currency" } });
    expect(await getDb().creditAccount.count()).toBe(0);
  });
});

describe("POST /api/v1/credits/charge", () => {
  it("charges once per Idempotency-Key, however often the request is retried", async () => {
    const { secret, token, accountId } = await fundedBusiness();
    const first = await chargeRoute(post("/api/v1/credits/charge", secret, { token, amount: "1.5" }, "call-1"));
    const retry = await chargeRoute(post("/api/v1/credits/charge", secret, { token, amount: "1.5" }, "call-1"));

    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ object: "credit_charge", amount: "1.500000", balance: "3.500000", currency: "USD" });
    expect(retry.headers.get("Idempotent-Replayed")).toBe("true");
    expect(await balanceOf(accountId)).toBe("3.500000");
    expect(await getDb().creditUsage.count()).toBe(1);
  });

  it("answers 409 insufficient_credit when the balance is too low", async () => {
    const { secret, token, accountId } = await fundedBusiness("1");
    const response = await chargeRoute(post("/api/v1/credits/charge", secret, { token, amount: "1.000001" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { type: "insufficient_credit", message: "This credit balance is too low. Top it up to continue." } });
    expect(await balanceOf(accountId)).toBe("1.000000");
  });

  it("refuses more than six decimals and prices in another currency", async () => {
    const { secret, token, accountId } = await fundedBusiness();

    const fine = await chargeRoute(post("/api/v1/credits/charge", secret, { token, amount: "0.0000001" }));
    expect(fine.status).toBe(400);
    expect(await fine.json()).toMatchObject({ error: { type: "invalid_request", param: "amount" } });

    const euros = await chargeRoute(post("/api/v1/credits/charge", secret, { token, amount: "1", currency: "EUR" }));
    expect(euros.status).toBe(400);
    expect(await euros.json()).toMatchObject({ error: { type: "invalid_request", param: "currency" } });
    expect(await balanceOf(accountId)).toBe("5.000000");
  });

  it("does not charge a token with another business's key", async () => {
    const { token, accountId } = await fundedBusiness();
    const { secret: strangerSecret } = await createApiKey((await createMerchant()).id);

    const response = await chargeRoute(post("/api/v1/credits/charge", strangerSecret, { token, amount: "1" }));
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { type: "not_found", param: "token" } });
    expect(await balanceOf(accountId)).toBe("5.000000");
  });
});

describe("POST /api/v1/credits/charges/:id/refund", () => {
  it("gives the charge back once; a second refund is refused", async () => {
    const { merchant, secret, token, accountId } = await fundedBusiness();
    const charged = await charge(merchant, { token, amount: "2" });

    const first = await refund(charged.id, secret);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ id: charged.id, object: "credit_charge", amount: "2.000000", refunded: true, balance: "5.000000", currency: "USD" });

    const second = await refund(charged.id, secret);
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: { type: "invalid_state", message: "This charge was already refunded." } });
    expect(await balanceOf(accountId)).toBe("5.000000");
  });

  it("replays a retried refund instead of refusing it", async () => {
    const { merchant, secret, token } = await fundedBusiness();
    const charged = await charge(merchant, { token, amount: "2" });

    expect((await refund(charged.id, secret, "refund-1")).status).toBe(200);
    const retry = await refund(charged.id, secret, "refund-1");
    expect(retry.status).toBe(200);
    expect(retry.headers.get("Idempotent-Replayed")).toBe("true");
  });

  it("does not find another business's charge or an unknown one", async () => {
    const { merchant, token, accountId } = await fundedBusiness();
    const charged = await charge(merchant, { token, amount: "2" });
    const { secret: strangerSecret } = await createApiKey((await createMerchant()).id);

    const response = await refund(charged.id, strangerSecret);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { type: "not_found", message: "No credit charge with this id.", param: "id" } });
    expect((await refund("cru_unknown", strangerSecret)).status).toBe(404);
    expect(await balanceOf(accountId)).toBe("3.000000");
  });
});
