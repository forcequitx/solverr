import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Merchant, TeamRole } from "@/generated/prisma/client";
import { MERCHANT_COOKIE, OTHER_BUSINESS_MESSAGE } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/ids";
import { createMerchantAction, uploadLogoAction } from "@/lib/merchants/actions/account";
import { payoutFromSignInWalletAction, setSettlementAction } from "@/lib/merchants/actions/settlement";
import { LOGO_TOO_LARGE, MAX_LOGO_UPLOAD_BYTES } from "@/lib/merchants/logo-upload";
import { createMerchant, ETH, USDC_BASE, USDC_SOLANA } from "./factories";

/** The signed-in user, the session start and the `solverr_merchant` cookie, as the setup page's requests carry them; `set` updates the cookie. */
const request = vi.hoisted(() => ({ user: { id: "", name: "", email: "" }, signedInAt: new Date(), selected: "" }));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) => (name === MERCHANT_COOKIE && request.selected ? { name, value: request.selected } : undefined),
    set: (name: string, value: string) => {
      if (name === MERCHANT_COOKIE) request.selected = value;
    },
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

vi.mock("@/lib/auth/server", () => ({
  getAuth: () => ({ api: { getSession: async () => ({ user: request.user, session: { createdAt: request.signedInAt, expiresAt: new Date(Date.now() + 60 * 60_000) } }) } }),
  sessionExtensionDue: () => false,
}));

vi.mock("@/lib/oneclick/tokens", async (importOriginal) => {
  const { TEST_TOKENS } = await import("./factories");
  return {
    ...(await importOriginal<typeof import("@/lib/oneclick/tokens")>()),
    findToken: async (assetId: string) => TEST_TOKENS.find((token) => token.assetId === assetId),
    listTokens: async () => TEST_TOKENS,
  };
});

beforeEach(() => {
  request.selected = "";
  request.signedInAt = new Date();
});

/** A user signed in with a fresh EVM wallet, which is saved as their sign-in wallet. */
async function signedIn(): Promise<{ userId: string; address: `0x${string}` }> {
  const id = randomUUID();
  const address = privateKeyToAccount(generatePrivateKey()).address;
  await getDb().user.create({ data: { id, name: "Ada", email: `${id}@wallet.invalid`, walletIdentities: { create: { id: newId("wid"), kind: "evm", address } } } });
  request.user = { id, name: "Ada", email: `${id}@wallet.invalid` };
  return { userId: id, address };
}

/** A business the signed-in user belongs to with `role`, selected in the switcher; no payout wallet unless given. */
async function joined(userId: string, role: TeamRole = "owner", overrides: Partial<Merchant> = {}): Promise<Merchant> {
  const merchant = await createMerchant({ payoutChain: null, payoutAddress: null, payoutVerifiedAt: null, ...overrides });
  await getDb().teamMember.create({ data: { id: newId("tm"), merchantId: merchant.id, userId, role } });
  request.selected = merchant.id;
  return merchant;
}

const pngLogo = async () =>
  new File([new Uint8Array(await sharp({ create: { width: 64, height: 64, channels: 3, background: "#155dfc" } }).png().toBuffer())], "logo.png", { type: "image/png" });

function logoForm(file: File): FormData {
  const form = new FormData();
  form.set("logo", file);
  return form;
}

describe("business details step", () => {
  it("creates the business, selects it and returns its id; a repeated submit creates no second one", async () => {
    const { userId } = await signedIn();
    const created = await createMerchantAction({ name: "Local Cafe", website: "https://cafe.example" });
    expect(created).toMatchObject({ ok: true, id: expect.stringMatching(/^mer_/) });
    const id = created.ok ? created.id : null;
    expect(request.selected).toBe(id);
    await expect(getDb().merchant.findUniqueOrThrow({ where: { id: id! } })).resolves.toMatchObject({ name: "Local Cafe", website: "https://cafe.example", setupCompletedAt: null });

    await expect(createMerchantAction({ name: "Local Cafe" })).resolves.toEqual({ ok: true, id: null });
    await expect(getDb().teamMember.count({ where: { userId, role: "owner" } })).resolves.toBe(1);
  });

  it("creates a second business only when the owner asks for another one", async () => {
    const { userId } = await signedIn();
    await createMerchantAction({ name: "First" });
    const second = await createMerchantAction({ name: "Second", additional: true });
    expect(second).toMatchObject({ ok: true, id: expect.stringMatching(/^mer_/) });
    expect(request.selected).toBe(second.ok ? second.id : "");
    await expect(getDb().teamMember.count({ where: { userId, role: "owner" } })).resolves.toBe(2);
  });

  it("refuses an empty name and a website that is not a URL", async () => {
    await signedIn();
    await expect(createMerchantAction({ name: "  " })).resolves.toMatchObject({ ok: false });
    await expect(createMerchantAction({ name: "Cafe", website: "javascript:alert(1)" })).resolves.toMatchObject({ ok: false });
    await expect(getDb().merchant.count()).resolves.toBe(0);
  });

  it("stores the logo picked during setup on the new business, keeping only the latest one", async () => {
    await signedIn();
    const created = await createMerchantAction({ name: "Local Cafe" });
    const id = created.ok ? created.id! : "";
    await expect(uploadLogoAction(id, logoForm(await pngLogo()))).resolves.toEqual({ ok: true });
    const first = (await getDb().merchant.findUniqueOrThrow({ where: { id } })).logoId;
    expect(first).toMatch(/^logo_/);

    await expect(uploadLogoAction(id, logoForm(await pngLogo()))).resolves.toEqual({ ok: true });
    const second = (await getDb().merchant.findUniqueOrThrow({ where: { id } })).logoId;
    expect(second).not.toBe(first);
    await expect(getDb().merchantLogo.findMany({ where: { merchantId: id }, select: { id: true } })).resolves.toEqual([{ id: second }]);
  });

  it("refuses a file that is not an image and one over the size limit, keeping no logo", async () => {
    const { userId } = await signedIn();
    const merchant = await joined(userId);
    const notAnImage = new File([new TextEncoder().encode("<svg onload=alert(1)>")], "logo.png", { type: "image/png" });
    await expect(uploadLogoAction(merchant.id, logoForm(notAnImage))).resolves.toEqual({ ok: false, error: "Upload a PNG, JPEG or WebP image." });
    const huge = new File([new Uint8Array(MAX_LOGO_UPLOAD_BYTES + 1)], "logo.png", { type: "image/png" });
    await expect(uploadLogoAction(merchant.id, logoForm(huge))).resolves.toEqual({ ok: false, error: LOGO_TOO_LARGE });
    await expect(getDb().merchantLogo.count()).resolves.toBe(0);
  });

  it("refuses a logo for a business other than the one the page showed", async () => {
    const { userId } = await signedIn();
    const shown = await joined(userId);
    await joined(userId);
    await expect(uploadLogoAction(shown.id, logoForm(await pngLogo()))).resolves.toEqual({ ok: false, error: OTHER_BUSINESS_MESSAGE });
  });
});

describe("where you get paid step", () => {
  it("uses the sign-in wallet on the chosen network, keeping a coin that network has and switching one it lacks", async () => {
    const { userId, address } = await signedIn();
    const merchant = await joined(userId, "owner", { settlementAsset: USDC_BASE });

    await expect(payoutFromSignInWalletAction(merchant.id, { kind: "evm", address, payoutChain: "base" })).resolves.toEqual({ ok: true });
    await expect(getDb().merchant.findUniqueOrThrow({ where: { id: merchant.id } })).resolves.toMatchObject({ payoutChain: "base", payoutAddress: address, settlementAsset: USDC_BASE });

    await expect(payoutFromSignInWalletAction(merchant.id, { kind: "evm", address, payoutChain: "eth" })).resolves.toEqual({ ok: true });
    await expect(getDb().merchant.findUniqueOrThrow({ where: { id: merchant.id } })).resolves.toMatchObject({ payoutChain: "eth", payoutAddress: address, settlementAsset: ETH });
    /** Switching network before setup is finished is choosing, not changing, so the owner gets no alert. */
    await expect(getDb().alert.count({ where: { merchantId: merchant.id, kind: { in: ["payout_wallet_changed", "payout_network_changed"] } } })).resolves.toBe(0);
  });

  it("after setup, alerts a network change of the same wallet as a network change, and a new wallet as a wallet change", async () => {
    const { userId, address } = await signedIn();
    const merchant = await joined(userId, "owner", { payoutChain: "base", payoutAddress: address, payoutVerifiedAt: new Date(), setupCompletedAt: new Date() });
    await expect(payoutFromSignInWalletAction(merchant.id, { kind: "evm", address, payoutChain: "eth" })).resolves.toEqual({ ok: true });
    const alerts = await getDb().alert.findMany({ where: { merchantId: merchant.id } });
    expect(alerts.map(({ kind, message }) => ({ kind, message }))).toEqual([
      { kind: "payout_network_changed", message: expect.stringContaining("Your payout network was changed from Base to Ethereum.") },
    ]);
    expect(alerts[0].message).not.toContain("payout wallet was set");
  });

  it("refuses a sign-in wallet of another family, a smart wallet, and a wallet the user did not sign in with", async () => {
    const { userId, address } = await signedIn();
    const merchant = await joined(userId);
    await expect(payoutFromSignInWalletAction(merchant.id, { kind: "evm", address, payoutChain: "sol" })).resolves.toEqual({ ok: false, error: "Connect a Solana wallet." });

    await getDb().walletIdentity.update({ where: { kind_address: { kind: "evm", address } }, data: { smartWallet: true, chainId: 8453 } });
    const smart = await payoutFromSignInWalletAction(merchant.id, { kind: "evm", address, payoutChain: "base" });
    expect(smart).toEqual({ ok: false, error: "Connect this wallet and sign one message to verify you own it." });

    const stranger = privateKeyToAccount(generatePrivateKey()).address;
    await expect(payoutFromSignInWalletAction(merchant.id, { kind: "evm", address: stranger, payoutChain: "base" })).resolves.toMatchObject({ ok: false });
    await expect(getDb().merchant.findUniqueOrThrow({ where: { id: merchant.id } })).resolves.toMatchObject({ payoutAddress: null, payoutVerifiedAt: null });
  });

  it("saves only a coin on the payout network, and finishing marks setup complete once", async () => {
    const { userId } = await signedIn();
    const merchant = await joined(userId, "owner", { payoutChain: "base", payoutAddress: "0x2222222222222222222222222222222222222222", payoutVerifiedAt: new Date() });

    await expect(setSettlementAction(merchant.id, { assetId: USDC_SOLANA, privatePayments: false })).resolves.toEqual({ ok: false, error: "Choose a coin on your payout network." });
    await expect(getDb().merchant.findUniqueOrThrow({ where: { id: merchant.id } })).resolves.toMatchObject({ setupCompletedAt: null });

    await expect(setSettlementAction(merchant.id, { assetId: USDC_BASE, privatePayments: false })).resolves.toEqual({ ok: true });
    const finished = (await getDb().merchant.findUniqueOrThrow({ where: { id: merchant.id } })).setupCompletedAt;
    expect(finished).toBeInstanceOf(Date);
    await expect(setSettlementAction(merchant.id, { assetId: USDC_BASE, privatePayments: false })).resolves.toEqual({ ok: true });
    await expect(getDb().merchant.findUniqueOrThrow({ where: { id: merchant.id } })).resolves.toMatchObject({ setupCompletedAt: finished });
  });

  it("refuses to finish before a payout wallet is verified, and refuses private payments this server cannot serve", async () => {
    const { userId } = await signedIn();
    const merchant = await joined(userId);
    await expect(setSettlementAction(merchant.id, { assetId: USDC_BASE, privatePayments: false })).resolves.toEqual({ ok: false, error: "Verify your payout wallet first." });

    await getDb().merchant.update({ where: { id: merchant.id }, data: { payoutChain: "base", payoutAddress: "0x2222222222222222222222222222222222222222", payoutVerifiedAt: new Date() } });
    const privateResult = await setSettlementAction(merchant.id, { assetId: USDC_BASE, privatePayments: true });
    expect(privateResult).toMatchObject({ ok: false, error: expect.stringContaining("Turn private payments off to save.") });
  });

  it("leaves the payout wallet and coin to the owner", async () => {
    const { userId, address } = await signedIn();
    const merchant = await joined(userId, "developer", { payoutChain: "base", payoutAddress: "0x2222222222222222222222222222222222222222", payoutVerifiedAt: new Date() });
    await expect(payoutFromSignInWalletAction(merchant.id, { kind: "evm", address, payoutChain: "base" })).resolves.toEqual({ ok: false, error: "Only the owner can change the payout wallet." });
    await expect(setSettlementAction(merchant.id, { assetId: USDC_BASE, privatePayments: false })).resolves.toEqual({ ok: false, error: "Only the owner can change the coin you receive." });
  });
});
