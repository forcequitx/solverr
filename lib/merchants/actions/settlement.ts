"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type Merchant, type Prisma, WalletKind } from "@/generated/prisma/client";
import { ApiError } from "@/lib/api/errors";
import { rateLimit } from "@/lib/api/rate-limit";
import { isValidAddress } from "@/lib/chains/addresses";
import { getChain } from "@/lib/chains/registry";
import { assertRecentSignIn } from "@/lib/auth/recent-sign-in";
import { getDb } from "@/lib/db";
import { type ActionResult, ASSET_ID, fail, ownerOnly } from "@/lib/merchants/actions/shared";
import { createAlert } from "@/lib/merchants/alerts";
import { emailOwner } from "@/lib/merchants/owner-email";
import { verifiedPayout } from "@/lib/merchants/payout-wallet";
import { type SettlementOption, settlementOptions } from "@/lib/merchants/settlement-options";
import { privatePaymentsUnavailable } from "@/lib/oneclick/confidentiality";
import { earnHoldings } from "@/lib/payments/earn-holdings";
import { retireMerchantOpenQuotes } from "@/lib/payments/quote";
import { createEarnWithdrawal } from "@/lib/transfers/transfers";
import { consumeChallenge, createChallenge } from "@/lib/wallets/challenge";
import { verifyWalletProof } from "@/lib/wallets/verify";

const PAYOUT_CHANGE_ACTION = "change the payout wallet";
/** Payout wallet requests per business per minute: each can call a chain's RPC to check a smart wallet, and each change emails the owner. */
const PAYOUT_WALLET_REQUESTS_PER_MINUTE = 10;

/** A transfer being sent is checked against the wallet that sends it, so the wallet cannot change under it. */
async function assertNoTransferSending(db: Pick<Prisma.TransactionClient, "transfer">, merchantId: string): Promise<void> {
  const sending = await db.transfer.count({ where: { merchantId, OR: [{ status: "processing" }, { status: "pending", depositAddress: { not: null } }] } });
  if (sending > 0) {
    throw new ApiError(409, "invalid_state", "A transfer is being sent from your current payout wallet. Record or cancel it in Refunds & payouts first, then change the wallet.");
  }
}

/** The owner, within the request limit; changing a verified payout wallet needs a recent sign-in, choosing the first one does not. */
async function payoutWalletOwner(merchantId: string) {
  const context = await ownerOnly("Only the owner can change the payout wallet.", merchantId);
  if (context.merchant.payoutVerifiedAt) assertRecentSignIn(context.user, PAYOUT_CHANGE_ACTION);
  await assertNoTransferSending(getDb(), context.merchant.id);
  await rateLimit(`payout-wallet:${context.merchant.id}`, PAYOUT_WALLET_REQUESTS_PER_MINUTE, 60_000);
  return context;
}

const payoutChainSchema = z.string().max(40).refine((id) => getChain(id)?.payout, "Choose a supported payout network.");
/** A connected wallet, bounded like the sign-in wallet endpoints. */
const payoutWalletSchema = z.strictObject({ kind: z.enum(WalletKind), address: z.string().min(1).max(200), payoutChain: payoutChainSchema });

/** Starts proving a payout wallet: returns the message the wallet must sign. */
export async function payoutChallengeAction(
  merchantId: string,
  input: { kind: WalletKind; address: string; payoutChain: string },
): Promise<ActionResult<{ nonce: string; message: string; near: { recipient: string; nonce: string } | null }>> {
  try {
    const { merchant } = await payoutWalletOwner(merchantId);
    const { kind, address, payoutChain } = payoutWalletSchema.parse(input);
    const chain = getChain(payoutChain)!;
    if (chain.family !== kind || !isValidAddress(chain.family, address)) throw new ApiError(400, "invalid_request", `Connect a ${chain.name} wallet.`);
    const challenge = await createChallenge({
      kind,
      address,
      chainId: chain.evmChainId,
      purpose: "payout_wallet",
      merchantId: merchant.id,
      merchantName: merchant.name,
      payoutChain,
    });
    return { ok: true, nonce: challenge.nonce, message: challenge.message, near: challenge.near ?? null };
  } catch (error) {
    return fail(error);
  }
}

/** Finishes proving a payout wallet with its signature and saves it. */
export async function verifyPayoutAction(merchantId: string, input: { nonce: string; signature: string; publicKey?: string; payoutChain: string }): Promise<ActionResult> {
  try {
    const { merchant } = await payoutWalletOwner(merchantId);
    const { nonce, signature, publicKey, payoutChain } = z
      .strictObject({ nonce: z.string().min(8).max(100), signature: z.string().min(1).max(1000), publicKey: z.string().max(200).optional(), payoutChain: payoutChainSchema })
      .parse(input);
    /** Read before the single-use challenge is spent, so a 1Click outage does not make the owner sign again. */
    const options = await settlementOptions(payoutChain);
    const challenge = await consumeChallenge(nonce);
    if (!challenge || challenge.purpose !== "payout_wallet" || challenge.merchantId !== merchant.id || challenge.payoutChain !== payoutChain) {
      throw new ApiError(400, "invalid_request", "This signing request expired. Choose your wallet again to get a new message.");
    }
    if (!(await verifyWalletProof(challenge, { signature, publicKey }))) {
      throw new ApiError(400, "invalid_request", "The wallet signature could not be verified.");
    }
    await savePayoutWallet(merchant, payoutChain, challenge.address, options);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/** Uses a sign-in wallet as payout wallet, its sign-in signature being the proof; smart wallets are excluded, as their address can have another owner on another chain. */
export async function payoutFromSignInWalletAction(merchantId: string, input: { kind: WalletKind; address: string; payoutChain: string }): Promise<ActionResult> {
  try {
    const { user, merchant } = await payoutWalletOwner(merchantId);
    const { kind, address, payoutChain } = payoutWalletSchema.parse(input);
    const chain = getChain(payoutChain)!;
    if (chain.family !== kind) throw new ApiError(400, "invalid_request", `Connect a ${chain.name} wallet.`);
    const identity = await getDb().walletIdentity.findUnique({ where: { kind_address: { kind, address } } });
    if (!identity || identity.userId !== user.id || identity.smartWallet) {
      throw new ApiError(400, "invalid_request", "Connect this wallet and sign one message to verify you own it.");
    }
    await savePayoutWallet(merchant, payoutChain, identity.address, await settlementOptions(payoutChain));
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/** Saves a proven payout wallet, keeps the receiving coin when it is among `options` on the new network, and tells the owner when it replaced
    another verified wallet after setup; choosing the first wallet, proving the same one again, or switching during setup is not a change. */
async function savePayoutWallet(merchant: Merchant, payoutChain: string, address: string, options: SettlementOption[]): Promise<void> {
  const keepSettlement = options.some((option) => option.assetId === merchant.settlementAsset);
  const settlementAsset = keepSettlement ? merchant.settlementAsset : (options[0]?.assetId ?? merchant.settlementAsset);
  const previous = verifiedPayout(merchant);
  /** Before setup is finished the owner is still choosing (switching network in setup's payout step), so only later changes alert. */
  const replaced = previous !== null && (previous.chain !== payoutChain || previous.address !== address) && merchant.setupCompletedAt !== null;
  const network = getChain(payoutChain)?.name ?? payoutChain;
  /** The same address on another network moves the money, not the wallet, so that alert names the networks. */
  const networkOnly = previous !== null && previous.address === address;
  const message = networkOnly
    ? `Your payout network was changed from ${getChain(previous.chain)?.name ?? previous.chain} to ${network}. Payments now go to the same wallet, ${address}, on ${network}. If you did not do this, sign in and change it back now.`
    : `Your payout wallet was set to ${address} on ${network}. If you did not do this, sign in and change it now.`;
  /** Change and alert are saved together; open payment addresses still deliver to the old wallet, so they are retired in the same step. */
  await getDb().$transaction(async (tx) => {
    await tx.merchant.update({ where: { id: merchant.id }, data: { payoutChain, payoutAddress: address, payoutVerifiedAt: new Date(), settlementAsset } });
    /** Checked again with the business row now locked: a transfer prepared since the first check is bound to the old wallet. */
    await assertNoTransferSending(tx, merchant.id);
    if (replaced) await createAlert(merchant.id, networkOnly ? "payout_network_changed" : "payout_wallet_changed", message, tx);
    await retireMerchantOpenQuotes(tx, merchant.id);
  });
  if (replaced) await emailOwner(merchant, message, "/dashboard/settings");
  revalidatePath("/dashboard", "layout");
  revalidatePath("/onboarding");
}

/** Saves the coin the business receives and the private-payments choice. */
export async function setSettlementAction(merchantId: string, input: { assetId: string; privatePayments: boolean }): Promise<ActionResult> {
  try {
    const { merchant } = await ownerOnly("Only the owner can change the coin you receive.", merchantId);
    const { assetId, privatePayments } = z.strictObject({ assetId: ASSET_ID, privatePayments: z.boolean() }).parse(input);
    if (!merchant.payoutChain) throw new ApiError(400, "invalid_request", "Verify your payout wallet first.");
    const unavailable = privatePayments ? privatePaymentsUnavailable() : null;
    if (unavailable) throw new ApiError(400, "invalid_request", `${unavailable} Turn private payments off to save.`);
    const options = await settlementOptions(merchant.payoutChain);
    if (!options.some((option) => option.assetId === assetId)) throw new ApiError(400, "invalid_request", "Choose a coin on your payout network.");
    /** Open addresses were quoted with the earlier privacy level; when it changes they are retired, so new ones follow it. */
    await getDb().$transaction(async (tx) => {
      await tx.merchant.update({
        where: { id: merchant.id },
        data: { settlementAsset: assetId, privatePayments, setupCompletedAt: merchant.setupCompletedAt ?? new Date() },
      });
      if (privatePayments !== merchant.privatePayments) await retireMerchantOpenQuotes(tx, merchant.id);
    });
    revalidatePath("/dashboard", "layout");
    revalidatePath("/onboarding");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/** Withdraws all Earn vault shares of one vault back to USDC; the merchant approves it from their wallet. */
export async function withdrawEarnAction(merchantId: string, assetId: string): Promise<ActionResult<{ id: string }>> {
  try {
    const { merchant } = await ownerOnly("Only the owner can withdraw Earn holdings.", merchantId);
    const vaultAssetId = ASSET_ID.parse(assetId);
    const { holdings, unreadable } = await earnHoldings(merchant);
    const holding = holdings.find((h) => h.assetId === vaultAssetId);
    if (!holding && unreadable) throw new ApiError(503, "upstream_unavailable", "Your Earn balance could not be read right now. Try again in a moment.");
    if (!holding) throw new ApiError(400, "invalid_request", "No shares of this vault in your payout wallet.");
    const transfer = await createEarnWithdrawal(merchant, vaultAssetId, holding.amount);
    revalidatePath("/dashboard/transfers");
    return { ok: true, id: transfer.id };
  } catch (error) {
    return fail(error);
  }
}
