"use server";

import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { rateLimit } from "@/lib/api/rate-limit";
import { assertRecentSignIn } from "@/lib/auth/recent-sign-in";
import { getAuth } from "@/lib/auth/server";
import { MERCHANT_COOKIE, requireShownMerchant, requireUser } from "@/lib/auth/session";
import { isPlaceholderEmail, placeholderEmail } from "@/lib/auth/wallet-email";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { newId } from "@/lib/ids";
import { type ActionResult, editable, fail, ID } from "@/lib/merchants/actions/shared";
import { alertOwner, OWNER_ONLY_ALERT_KINDS } from "@/lib/merchants/alerts";
import { processLogo } from "@/lib/merchants/logo";
import { USDC_ON_BASE } from "@/lib/oneclick/constants";
import { lockUser } from "@/lib/row-locks";

const MAX_OWNED_BUSINESSES = 10;
const LOGO_UPLOADS_PER_MINUTE = 10;
/** One line of text: the name goes into the message an owner signs to verify a payout wallet. */
const BUSINESS_NAME = z
  .string()
  .trim()
  .min(2, "Enter your business name.")
  .max(80)
  .regex(/^[^\p{Cc}]*$/u, "The business name must be one line of text.");
/** The business website; checkouts send customers back to it, so only http and https are accepted. */
const WEBSITE = z.url({ protocol: /^https?$/, error: "Enter your website as a full address, such as https://shop.example." });

/** Options of the cookie that remembers the selected business. */
function merchantCookieOptions() {
  return { path: "/", sameSite: "lax", httpOnly: true, secure: getEnv().APP_URL.startsWith("https") } as const;
}

/** Creates and selects a business owned by the signed-in user and returns its id; without `additional`, an existing owner gets no second one
    from a repeated submit, and the id is null. */
export async function createMerchantAction(input: { name: string; website?: string; additional?: boolean }): Promise<ActionResult<{ id: string | null }>> {
  try {
    const user = await requireUser();
    const { name, website, additional } = z
      .object({ name: BUSINESS_NAME, website: WEBSITE.optional().or(z.literal("")), additional: z.boolean().optional() })
      .parse(input);
    const merchant = await getDb().$transaction(async (tx) => {
      /** Concurrent submits by one login wait here, so the membership check below sees a business created by the other. */
      await lockUser(tx, user.id);
      const owned = await tx.teamMember.count({ where: { userId: user.id, role: "owner" } });
      if (!additional && owned > 0) return null;
      if (owned >= MAX_OWNED_BUSINESSES) {
        throw new ApiError(400, "invalid_request", `One login can own at most ${MAX_OWNED_BUSINESSES} businesses.`);
      }
      return tx.merchant.create({
        data: {
          id: newId("mer"),
          name,
          website: website || null,
          /** The coin a new business receives until the owner picks another one. */
          settlementAsset: USDC_ON_BASE,
          teamMembers: { create: { id: newId("tm"), userId: user.id, role: "owner" } },
        },
      });
    });
    if (!merchant) {
      revalidatePath("/onboarding");
      return { ok: true, id: null };
    }
    (await cookies()).set(MERCHANT_COOKIE, merchant.id, merchantCookieOptions());
    return { ok: true, id: merchant.id };
  } catch (error) {
    return fail(error);
  }
}

/** Opens another business the signed-in user belongs to. */
export async function switchMerchantAction(merchantIdInput: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const merchantId = ID.parse(merchantIdInput);
    if (!(await getDb().teamMember.findFirst({ where: { userId: user.id, merchantId } }))) throw new ApiError(403, "invalid_request", "You are not a member of this business.");
    (await cookies()).set(MERCHANT_COOKIE, merchantId, merchantCookieOptions());
    revalidatePath("/dashboard", "layout");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/** Saves name and website. Payment links send customers back to the website, so once customers can pay, a change needs a recent sign-in and alerts the owner. */
export async function updateProfileAction(merchantId: string, input: { name: string; website?: string }): Promise<ActionResult> {
  try {
    const { merchant, user } = await editable(merchantId);
    const { name, website } = z.object({ name: BUSINESS_NAME, website: WEBSITE.optional().or(z.literal("")) }).parse(input);
    const nextWebsite = website || null;
    const websiteChanged = nextWebsite !== merchant.website && merchant.payoutVerifiedAt !== null;
    if (websiteChanged) assertRecentSignIn(user, "change the website");
    await getDb().merchant.update({ where: { id: merchant.id }, data: { name, website: nextWebsite } });
    if (websiteChanged) {
      await alertOwner(
        merchant,
        "website_changed",
        `The business website, where customers return after paying, was changed to ${nextWebsite ?? "none"}. If you did not do this, change it back in Settings.`,
        "/dashboard/settings",
      );
    }
    revalidatePath("/dashboard", "layout");
    revalidatePath("/onboarding");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/** Replaces the business logo with an uploaded image (form field `logo`); earlier logos are deleted. */
export async function uploadLogoAction(merchantId: string, form: FormData): Promise<ActionResult> {
  try {
    const { merchant } = await editable(merchantId);
    await rateLimit(`logo-upload:${merchant.id}`, LOGO_UPLOADS_PER_MINUTE, 60_000);
    const file = form.get("logo");
    if (!(file instanceof File) || file.size === 0) throw new ApiError(400, "invalid_request", "Choose an image to upload.");
    const image = await processLogo(file);
    const db = getDb();
    const id = newId("logo");
    await db.$transaction([
      db.merchantLogo.create({ data: { id, merchantId: merchant.id, image } }),
      db.merchant.update({ where: { id: merchant.id }, data: { logoId: id } }),
      db.merchantLogo.deleteMany({ where: { merchantId: merchant.id, id: { not: id } } }),
    ]);
    revalidatePath("/dashboard", "layout");
    revalidatePath("/onboarding");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/** Removes the business logo; pages show the initials again. */
export async function removeLogoAction(merchantId: string): Promise<ActionResult> {
  try {
    const { merchant } = await editable(merchantId);
    const db = getDb();
    await db.$transaction([db.merchant.update({ where: { id: merchant.id }, data: { logoId: null } }), db.merchantLogo.deleteMany({ where: { merchantId: merchant.id } })]);
    revalidatePath("/dashboard", "layout");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/** Removes a wallet from this login's sign-in methods; another wallet or a real email must remain, so the login stays reachable. */
export async function removeSignInWalletAction(walletId: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    assertRecentSignIn(user, "remove a sign-in wallet");
    const id = ID.parse(walletId);
    await getDb().$transaction(async (tx) => {
      /** Two removals at once wait here, so they cannot together remove the last sign-in method. */
      await lockUser(tx, user.id);
      const { email } = await tx.user.findUniqueOrThrow({ where: { id: user.id }, select: { email: true } });
      const wallets = await tx.walletIdentity.findMany({ where: { userId: user.id }, select: { id: true, kind: true, address: true } });
      const removed = wallets.find((wallet) => wallet.id === id);
      if (!removed) throw new ApiError(404, "not_found", "This wallet is not linked to your login.");
      const remaining = wallets.find((wallet) => wallet.id !== id);
      if (!remaining && isPlaceholderEmail(email)) throw new ApiError(400, "invalid_request", "This is your only way to sign in. Link another wallet first.");
      await tx.walletIdentity.delete({ where: { id } });
      /** A login keeping the removed wallet's placeholder email would make that wallet's next sign-in fail on the unique email for good. */
      if (remaining && email === placeholderEmail(removed.kind, removed.address)) {
        await tx.user.update({ where: { id: user.id }, data: { email: placeholderEmail(remaining.kind, remaining.address) } });
      }
    });
    revalidatePath("/dashboard/settings");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/** Ends every session of this login except the current one, such as a browser left signed in elsewhere. */
export async function signOutOtherDevicesAction(): Promise<ActionResult> {
  try {
    await requireUser();
    await getAuth().api.revokeOtherSessions({ headers: await headers() });
    revalidatePath("/dashboard/settings");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/** Marks the alerts in the notification inbox as read; a teammate's read leaves the owner's security alerts unread. */
export async function markAlertsReadAction(merchantId: string): Promise<ActionResult> {
  try {
    const { merchant, role } = await requireShownMerchant(merchantId);
    const scope = role === "owner" ? {} : { kind: { notIn: OWNER_ONLY_ALERT_KINDS } };
    await getDb().alert.updateMany({ where: { merchantId: merchant.id, readAt: null, ...scope }, data: { readAt: new Date() } });
    revalidatePath("/dashboard", "layout");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}
