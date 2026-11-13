import type { Merchant } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { payoutChainOptions } from "@/lib/merchants/payout-wallet";
import { settlementOptions } from "@/lib/merchants/settlement-options";
import { recommendedCoin, recommendedNetwork } from "@/lib/merchants/settlement-recommendation";
import { displayTokens } from "@/lib/oneclick/tokens";
import { earnHoldings } from "@/lib/payments/earn-holdings";

/** What the settings page shows: the team, the user's sign-in wallets and other sessions, coin options with the recommended network
    and coin, splits, Telegram chats and Earn holdings. */
export async function settingsPageData(merchant: Merchant, userId: string) {
  const db = getDb();
  const [members, wallets, sessions, options, recommendedChain, splits, telegramChats, earn] = await Promise.all([
    db.teamMember.findMany({ where: { merchantId: merchant.id }, include: { user: { include: { walletIdentities: true } } }, orderBy: { createdAt: "asc" } }),
    db.walletIdentity.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    db.session.count({ where: { userId, expiresAt: { gt: new Date() } } }),
    merchant.payoutChain ? settlementOptions(merchant.payoutChain, displayTokens) : Promise.resolve([]),
    recommendedNetwork(payoutChainOptions().map((chain) => chain.id), displayTokens),
    db.splitRule.findMany({ where: { merchantId: merchant.id }, orderBy: { createdAt: "asc" } }),
    db.telegramChat.findMany({ where: { merchantId: merchant.id }, orderBy: { createdAt: "asc" } }),
    earnHoldings(merchant),
  ]);
  return { members, wallets, sessions, options, recommendedChain, recommendedCoin: await recommendedCoin(options), splits, telegramChats, earn };
}

/** The user's sign-in wallets that can also be a payout wallet (smart wallets are bound to one chain), oldest first. */
export function payoutReadySignInWallets(userId: string) {
  return getDb().walletIdentity.findMany({ where: { userId, smartWallet: false }, select: { kind: true, address: true }, orderBy: { createdAt: "asc" } });
}
