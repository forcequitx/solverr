"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { TeamRole } from "@/generated/prisma/client";
import { ApiError } from "@/lib/api/errors";
import { rateLimit } from "@/lib/api/rate-limit";
import { canonicalAddress, isValidAddress } from "@/lib/chains/addresses";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/ids";
import { assertRecentSignIn } from "@/lib/auth/recent-sign-in";
import { type ActionResult, fail, ID, ownerOnly } from "@/lib/merchants/actions/shared";
import { alertOwner } from "@/lib/merchants/alerts";

const TEAM_ADDS_PER_HOUR = 20;

/** Adds a teammate who has already signed in once, found by email or wallet address. */
export async function addTeamMemberAction(merchantId: string, input: { identifier: string; role: TeamRole }): Promise<ActionResult> {
  try {
    const { merchant, user: owner } = await ownerOnly("Only the owner can manage the team.", merchantId);
    const identifier = z.string().trim().min(1, "Enter your teammate's email or wallet address.").max(200).parse(input.identifier);
    const targetRole = z.enum(["developer", "viewer"]).parse(input.role);
    /** A teammate keeps access after the owner signs out other devices, so a stolen session alone must not add one. */
    assertRecentSignIn(owner, "add the teammate");
    /** Each lookup tells whether an account uses the email or wallet, so lookups are limited per login; empty or invalid input is not counted. */
    await rateLimit(`team-add:${owner.id}`, TEAM_ADDS_PER_HOUR, 60 * 60_000);
    const db = getDb();
    const user =
      (await db.user.findUnique({ where: { email: identifier.toLowerCase() } })) ??
      (await db.walletIdentity.findFirst({ where: { address: isValidAddress("evm", identifier) ? canonicalAddress("evm", identifier) : identifier }, include: { user: true } }))?.user ??
      null;
    if (!user) throw new ApiError(400, "invalid_request", "No account uses this email or wallet. Ask them to sign in to Solverr once, then try again.");
    const existing = await db.teamMember.findUnique({ where: { merchantId_userId: { merchantId: merchant.id, userId: user.id } } });
    if (existing?.role === "owner") throw new ApiError(400, "invalid_request", "This account is the owner; the owner's role cannot be changed.");
    await db.teamMember.upsert({
      where: { merchantId_userId: { merchantId: merchant.id, userId: user.id } },
      create: { id: newId("tm"), merchantId: merchant.id, userId: user.id, role: targetRole },
      update: { role: targetRole },
    });
    await alertOwner(merchant, "team_changed", `${identifier} was given the ${targetRole} role in your team. If you did not do this, remove them in Settings.`, "/dashboard/settings");
    revalidatePath("/dashboard/settings");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function removeTeamMemberAction(merchantId: string, memberId: string): Promise<ActionResult> {
  try {
    const { merchant } = await ownerOnly("Only the owner can manage the team.", merchantId);
    const db = getDb();
    const member = await db.teamMember.findFirst({ where: { id: ID.parse(memberId), merchantId: merchant.id, role: { not: "owner" } } });
    if (member) {
      /** Telegram chats the teammate linked stop working with their membership. */
      await db.$transaction([
        db.teamMember.delete({ where: { id: member.id } }),
        db.telegramChat.deleteMany({ where: { merchantId: merchant.id, userId: member.userId } }),
      ]);
    }
    revalidatePath("/dashboard/settings");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}
