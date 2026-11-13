import type { Merchant, Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/ids";
import { emailOwner } from "@/lib/merchants/owner-email";

/** Alerts about who controls the money or the owner's login; only the owner can mark them read, so a teammate cannot hide them. */
export const OWNER_ONLY_ALERT_KINDS = ["payout_wallet_changed", "payout_network_changed", "split_changed", "sign_in_wallet_linked", "access_changed", "team_changed", "website_changed"];

/** Adds an alert to the merchant's dashboard inbox; pass a transaction client to save it together with the change it reports. */
export function createAlert(merchantId: string, kind: string, message: string, db: Prisma.TransactionClient = getDb()) {
  return db.alert.create({ data: { id: newId("alr"), merchantId, kind, message } });
}

/** Alerts each business the login owns and emails once about a new sign-in wallet, so one linked from a stolen session is spotted. */
export async function alertSignInWalletLinked(userId: string, address: string): Promise<void> {
  const owned = await getDb().teamMember.findMany({ where: { userId, role: "owner" }, include: { merchant: { select: { id: true, name: true } } } });
  const message = `The wallet ${address} can now sign in to your account. If you did not add it, remove it in Settings → Sign-in methods and sign out other devices.`;
  for (const { merchant } of owned) await createAlert(merchant.id, "sign_in_wallet_linked", message);
  if (owned[0]) await emailOwner(owned[0].merchant, message, "/dashboard/settings#sign-in");
}

/** A dashboard alert plus an email to the owner, for changes the owner must be able to spot and undo. */
export async function alertOwner(merchant: Pick<Merchant, "id" | "name">, kind: string, message: string, path: string): Promise<void> {
  await createAlert(merchant.id, kind, message);
  await emailOwner(merchant, message, path);
}

/** The merchant's newest `take` alerts, for the dashboard inbox. */
export function inboxAlerts(merchantId: string, take: number) {
  return getDb().alert.findMany({ where: { merchantId }, orderBy: { createdAt: "desc" }, take });
}
