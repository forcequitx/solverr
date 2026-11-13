import { ed25519 } from "@noble/curves/ed25519.js";
import { base58 } from "@scure/base";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAuth } from "@/lib/auth/server";
import { MERCHANT_COOKIE } from "@/lib/auth/session";
import { placeholderEmail } from "@/lib/auth/wallet-email";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/ids";
import { removeSignInWalletAction } from "@/lib/merchants/actions/account";
import { payoutChallengeAction, verifyPayoutAction } from "@/lib/merchants/actions/settlement";
import { consumeChallenge, createChallenge } from "@/lib/wallets/challenge";
import { verifyWalletProof } from "@/lib/wallets/verify";
import { createMerchant, createTransfer, PAYOUT_ADDRESS, USDC_SOLANA } from "./factories";

/** The browser request a dashboard action runs in: its cookies, including the session cookie a wallet sign-in set. */
const request = vi.hoisted(() => ({ cookie: "", selected: "" }));
/** A smart wallet's own check, which would ask the chain's RPC; it refuses every signature here. */
const contractCheck = vi.hoisted(() => ({ verifyMessage: vi.fn(async () => false) }));
/** Runs once while the token list is read, which a payout wallet save does between its first check and the save itself. */
const tokens = vi.hoisted(() => ({ during: undefined as (() => Promise<void>) | undefined }));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(request.cookie ? { cookie: request.cookie } : {}),
  cookies: async () => ({ get: (name: string) => (name === MERCHANT_COOKIE && request.selected ? { name, value: request.selected } : undefined) }),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

vi.mock("@/lib/chains/rpc/evm-rpc", () => ({ evmClient: () => contractCheck }));

vi.mock("@/lib/oneclick/tokens", async (importOriginal) => {
  const { TEST_TOKENS } = await import("./factories");
  return {
    ...(await importOriginal<typeof import("@/lib/oneclick/tokens")>()),
    findToken: async (assetId: string) => TEST_TOKENS.find((token) => token.assetId === assetId),
    listTokens: async () => {
      const during = tokens.during;
      tokens.during = undefined;
      await during?.();
      return TEST_TOKENS;
    },
  };
});

beforeEach(() => {
  request.cookie = "";
  request.selected = "";
  tokens.during = undefined;
});

const EXPIRED = "This sign-in request expired. Try again.";
const PAYOUT_EXPIRED = "This signing request expired. Choose your wallet again to get a new message.";

/** A Solana key pair that signs messages as a wallet does, with a base64 signature. */
function solanaWallet() {
  const secretKey = ed25519.utils.randomSecretKey();
  return {
    address: base58.encode(ed25519.getPublicKey(secretKey)),
    sign: (message: string) => Buffer.from(ed25519.sign(new TextEncoder().encode(message), secretKey)).toString("base64"),
  };
}

const challengeRow = (nonce: string) => getDb().verification.findFirst({ where: { identifier: `wallet:${nonce}` } });
const expire = (nonce: string) => getDb().verification.updateMany({ where: { identifier: `wallet:${nonce}` }, data: { expiresAt: new Date(Date.now() - 1_000) } });

/** A POST to a Better Auth endpoint, as the sign-in page sends it; `cookie` sends it from a signed-in browser. */
function authPost(path: string, body: object, cookie = ""): Promise<Response> {
  return getAuth().handler(
    new Request(`http://localhost:3000/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }),
  );
}

/** Asks for a sign-in message for the wallet; returns its nonce and the text to sign. */
async function signInChallenge(address: string): Promise<{ nonce: string; message: string }> {
  const response = await authPost("/wallet/challenge", { kind: "solana", address });
  expect(response.status).toBe(200);
  return response.json();
}

/** Signs in with a Solana wallet and returns the session cookie the browser would keep. */
async function signIn(wallet: ReturnType<typeof solanaWallet>): Promise<string> {
  const { nonce, message } = await signInChallenge(wallet.address);
  const response = await authPost("/wallet/verify", { nonce, signature: wallet.sign(message) });
  expect(response.status).toBe(200);
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

describe("wallet challenges", () => {
  it("store a single message per nonce that expires after ten minutes", async () => {
    const wallet = solanaWallet();
    const challenge = await createChallenge({ kind: "solana", address: wallet.address, purpose: "sign_in" });

    expect(challenge.message).toContain(`Nonce: ${challenge.nonce}`);
    expect(challenge.message).toContain(wallet.address);
    const row = await challengeRow(challenge.nonce);
    expect(row!.expiresAt.toISOString()).toBe(challenge.expiresAt);
    expect(row!.expiresAt.getTime() - Date.now()).toBeGreaterThan(9 * 60_000);
    expect(row!.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(10 * 60_000);
  });

  it("store an EVM address in its checksummed spelling", async () => {
    const challenge = await createChallenge({ kind: "evm", address: "0x52908400098527886e0f7030069857d2e4169ee7", purpose: "sign_in" });
    expect(challenge.address).toBe("0x52908400098527886E0F7030069857D2E4169EE7");
    expect(challenge.chainId).toBe(1);
  });

  it("can be used once", async () => {
    const challenge = await createChallenge({ kind: "solana", address: solanaWallet().address, purpose: "sign_in" });
    expect(await consumeChallenge(challenge.nonce)).toEqual(challenge);
    expect(await consumeChallenge(challenge.nonce)).toBeUndefined();
    expect(await challengeRow(challenge.nonce)).toBeNull();
  });

  it("are given to only one of several simultaneous requests", async () => {
    const challenge = await createChallenge({ kind: "solana", address: solanaWallet().address, purpose: "sign_in" });
    const results = await Promise.all(Array.from({ length: 5 }, () => consumeChallenge(challenge.nonce)));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("are refused once expired, and removed so they cannot be tried again", async () => {
    const challenge = await createChallenge({ kind: "solana", address: solanaWallet().address, purpose: "sign_in" });
    await expire(challenge.nonce);
    expect(await consumeChallenge(challenge.nonce)).toBeUndefined();
    expect(await challengeRow(challenge.nonce)).toBeNull();
    expect(await consumeChallenge("unknown-nonce")).toBeUndefined();
  });
});

describe("verifyWalletProof", () => {
  it("accepts a Solana signature of the exact message by the address's key", async () => {
    const wallet = solanaWallet();
    const challenge = await createChallenge({ kind: "solana", address: wallet.address, purpose: "sign_in" });
    expect(await verifyWalletProof(challenge, { signature: wallet.sign(challenge.message) })).toBe("key");
    expect(await verifyWalletProof(challenge, { signature: wallet.sign(`${challenge.message} `) })).toBeNull();
    expect(await verifyWalletProof(challenge, { signature: solanaWallet().sign(challenge.message) })).toBeNull();
    expect(await verifyWalletProof(challenge, { signature: "not base64 at all" })).toBeNull();
  });

  it("accepts an EVM key signature offline and asks the wallet contract only for any other signature", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const challenge = await createChallenge({ kind: "evm", address: account.address, chainId: 8453, purpose: "sign_in" });

    expect(await verifyWalletProof(challenge, { signature: await account.signMessage({ message: challenge.message }) })).toBe("key");
    expect(contractCheck.verifyMessage).not.toHaveBeenCalled();

    const stranger = privateKeyToAccount(generatePrivateKey());
    expect(await verifyWalletProof(challenge, { signature: await stranger.signMessage({ message: challenge.message }) })).toBeNull();
    expect(contractCheck.verifyMessage).toHaveBeenCalledTimes(1);
  });
});

describe("wallet sign-in", () => {
  it("signs in once per signed message; the same signature cannot sign in again", async () => {
    const wallet = solanaWallet();
    const { nonce, message } = await signInChallenge(wallet.address);
    const signature = wallet.sign(message);

    const first = await authPost("/wallet/verify", { nonce, signature });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ success: true, linked: false });
    expect(first.headers.getSetCookie().some((cookie) => cookie.includes("session_token="))).toBe(true);
    expect(await getDb().walletIdentity.findMany({ select: { kind: true, address: true, smartWallet: true } })).toEqual([{ kind: "solana", address: wallet.address, smartWallet: false }]);

    const replay = await authPost("/wallet/verify", { nonce, signature });
    expect(replay.status).toBe(401);
    expect(await replay.json()).toMatchObject({ message: EXPIRED });
    expect(await getDb().session.count()).toBe(1);
  });

  it("refuses an expired message", async () => {
    const wallet = solanaWallet();
    const { nonce, message } = await signInChallenge(wallet.address);
    await expire(nonce);

    const response = await authPost("/wallet/verify", { nonce, signature: wallet.sign(message) });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ message: EXPIRED });
    expect(await getDb().user.count()).toBe(0);
  });

  it("spends the message on a wrong signature, so it cannot be retried with another one", async () => {
    const wallet = solanaWallet();
    const { nonce, message } = await signInChallenge(wallet.address);

    const wrong = await authPost("/wallet/verify", { nonce, signature: solanaWallet().sign(message) });
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toMatchObject({ message: "The wallet signature could not be verified." });

    const right = await authPost("/wallet/verify", { nonce, signature: wallet.sign(message) });
    expect(right.status).toBe(401);
    expect(await right.json()).toMatchObject({ message: EXPIRED });
    expect(await getDb().user.count()).toBe(0);
  });

  it("lets a wallet removed from the account it created sign in again, to a new account of its own", async () => {
    const first = solanaWallet();
    const second = solanaWallet();
    request.cookie = await signIn(first);
    const created = await getDb().walletIdentity.findFirstOrThrow({ where: { address: first.address } });
    const { nonce, message } = await signInChallenge(second.address);
    expect(await (await authPost("/wallet/verify", { nonce, signature: second.sign(message) }, request.cookie)).json()).toEqual({ success: true, linked: true });

    expect(await removeSignInWalletAction(created.id)).toEqual({ ok: true });
    expect((await getDb().user.findUniqueOrThrow({ where: { id: created.userId } })).email).toBe(placeholderEmail("solana", second.address));

    request.cookie = "";
    await signIn(first);
    expect((await getDb().walletIdentity.findFirstOrThrow({ where: { address: first.address } })).userId).not.toBe(created.userId);
    expect(await getDb().user.count()).toBe(2);
  });

  it("finishes a first sign-in that stopped before its wallet was saved, on the account that sign-in created", async () => {
    const wallet = solanaWallet();
    const interrupted = await getDb().user.create({ data: { id: "user-interrupted", name: "Interrupted", email: placeholderEmail("solana", wallet.address) } });

    await signIn(wallet);
    expect((await getDb().walletIdentity.findFirstOrThrow({ where: { address: wallet.address } })).userId).toBe(interrupted.id);
    expect(await getDb().user.count()).toBe(1);
  });

  it("never attaches a wallet to another account that has wallets of its own, even one holding the wallet's placeholder email", async () => {
    const wallet = solanaWallet();
    await signIn(solanaWallet());
    await getDb().user.updateMany({ data: { email: placeholderEmail("solana", wallet.address) } });

    const { nonce, message } = await signInChallenge(wallet.address);
    const response = await authPost("/wallet/verify", { nonce, signature: wallet.sign(message) });
    expect(response.status).toBe(409);
    expect(await getDb().walletIdentity.count({ where: { address: wallet.address } })).toBe(0);
  });

  it("does not accept a payout wallet message as a sign-in", async () => {
    const wallet = solanaWallet();
    const merchant = await createMerchant();
    const challenge = await createChallenge({ kind: "solana", address: wallet.address, purpose: "payout_wallet", merchantId: merchant.id, payoutChain: "sol" });

    const response = await authPost("/wallet/verify", { nonce: challenge.nonce, signature: wallet.sign(challenge.message) });
    expect(response.status).toBe(401);
    expect(await getDb().user.count()).toBe(0);
  });
});

describe("payout wallet proof", () => {
  /** An owner signed in with a Solana wallet, with a business selected in the dashboard. */
  async function signedInOwner() {
    request.cookie = await signIn(solanaWallet());
    const { userId } = await getDb().walletIdentity.findFirstOrThrow();
    const merchant = await createMerchant();
    await getDb().teamMember.create({ data: { id: newId("tm"), merchantId: merchant.id, userId, role: "owner" } });
    request.selected = merchant.id;
    return { merchant, userId };
  }

  it("saves the proven wallet once; the same proof cannot be used again", async () => {
    const { merchant } = await signedInOwner();
    const payout = solanaWallet();
    const started = await payoutChallengeAction(merchant.id, { kind: "solana", address: payout.address, payoutChain: "sol" });
    if (!started.ok) throw new Error(started.error);
    const proof = { nonce: started.nonce, signature: payout.sign(started.message), payoutChain: "sol" };

    expect(await verifyPayoutAction(merchant.id, proof)).toEqual({ ok: true });
    expect(await getDb().merchant.findUniqueOrThrow({ where: { id: merchant.id } })).toMatchObject({ payoutChain: "sol", payoutAddress: payout.address, settlementAsset: USDC_SOLANA });

    await getDb().merchant.update({ where: { id: merchant.id }, data: { payoutAddress: "0x2222222222222222222222222222222222222222", payoutChain: "base" } });
    expect(await verifyPayoutAction(merchant.id, proof)).toEqual({ ok: false, error: PAYOUT_EXPIRED });
    expect(await getDb().merchant.findUniqueOrThrow({ where: { id: merchant.id } })).toMatchObject({ payoutChain: "base" });
  });

  it("keeps the wallet when a transfer from it is prepared while the new one is being saved", async () => {
    const { merchant } = await signedInOwner();
    const payout = solanaWallet();
    const started = await payoutChallengeAction(merchant.id, { kind: "solana", address: payout.address, payoutChain: "sol" });
    if (!started.ok) throw new Error(started.error);
    tokens.during = async () => {
      await createTransfer(merchant, { depositAddress: "0x4444444444444444444444444444444444444444", txSender: PAYOUT_ADDRESS });
    };

    const saved = await verifyPayoutAction(merchant.id, { nonce: started.nonce, signature: payout.sign(started.message), payoutChain: "sol" });
    expect(saved).toEqual({ ok: false, error: expect.stringContaining("A transfer is being sent from your current payout wallet") });
    expect(await getDb().merchant.findUniqueOrThrow({ where: { id: merchant.id } })).toMatchObject({ payoutChain: "base", payoutAddress: PAYOUT_ADDRESS });
  });

  it("alerts the owner only when a verified wallet is replaced, not for the first wallet or the same one proven again", async () => {
    const { merchant } = await signedInOwner();
    await getDb().merchant.update({ where: { id: merchant.id }, data: { payoutAddress: null, payoutChain: null, payoutVerifiedAt: null, setupCompletedAt: new Date() } });
    const alerts = () => getDb().alert.findMany({ where: { merchantId: merchant.id, kind: "payout_wallet_changed" } });
    const prove = async (wallet: ReturnType<typeof solanaWallet>) => {
      const started = await payoutChallengeAction(merchant.id, { kind: "solana", address: wallet.address, payoutChain: "sol" });
      if (!started.ok) throw new Error(started.error);
      return verifyPayoutAction(merchant.id, { nonce: started.nonce, signature: wallet.sign(started.message), payoutChain: "sol" });
    };

    const first = solanaWallet();
    expect(await prove(first)).toEqual({ ok: true });
    expect(await alerts()).toEqual([]);
    expect(await prove(first)).toEqual({ ok: true });
    expect(await alerts()).toEqual([]);

    const second = solanaWallet();
    expect(await prove(second)).toEqual({ ok: true });
    expect((await alerts()).map((alert) => alert.message)).toEqual([expect.stringContaining(second.address)]);
  });

  it("refuses a proof made for another business, another network or sign-in", async () => {
    const { merchant, userId } = await signedInOwner();
    const other = await createMerchant({ name: "Other business" });
    await getDb().teamMember.create({ data: { id: newId("tm"), merchantId: other.id, userId, role: "owner" } });
    const payout = solanaWallet();

    const forOther = await createChallenge({ kind: "solana", address: payout.address, purpose: "payout_wallet", merchantId: other.id, payoutChain: "sol" });
    expect(await verifyPayoutAction(merchant.id, { nonce: forOther.nonce, signature: payout.sign(forOther.message), payoutChain: "sol" })).toEqual({ ok: false, error: PAYOUT_EXPIRED });

    const forSolana = await createChallenge({ kind: "solana", address: payout.address, purpose: "payout_wallet", merchantId: merchant.id, payoutChain: "sol" });
    expect(await verifyPayoutAction(merchant.id, { nonce: forSolana.nonce, signature: payout.sign(forSolana.message), payoutChain: "near" })).toEqual({ ok: false, error: PAYOUT_EXPIRED });

    const signInOnly = await createChallenge({ kind: "solana", address: payout.address, purpose: "sign_in" });
    expect(await verifyPayoutAction(merchant.id, { nonce: signInOnly.nonce, signature: payout.sign(signInOnly.message), payoutChain: "sol" })).toEqual({ ok: false, error: PAYOUT_EXPIRED });

    expect(await getDb().merchant.findUniqueOrThrow({ where: { id: merchant.id } })).toMatchObject({ payoutChain: "base" });
  });

  it("refuses an expired proof", async () => {
    const { merchant } = await signedInOwner();
    const payout = solanaWallet();
    const started = await payoutChallengeAction(merchant.id, { kind: "solana", address: payout.address, payoutChain: "sol" });
    if (!started.ok) throw new Error(started.error);
    await expire(started.nonce);

    expect(await verifyPayoutAction(merchant.id, { nonce: started.nonce, signature: payout.sign(started.message), payoutChain: "sol" })).toEqual({ ok: false, error: PAYOUT_EXPIRED });
    expect(await getDb().merchant.findUniqueOrThrow({ where: { id: merchant.id } })).toMatchObject({ payoutChain: "base" });
  });
});
