"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { type ActionResult, fail, ID, ownerOnly } from "@/lib/merchants/actions/shared";
import { alertOwner } from "@/lib/merchants/alerts";
import { addSplitRule, splitRuleSchema } from "@/lib/splits/splits";

/** Adds a revenue split and alerts the owner, since it sends part of every payment elsewhere. */
export async function addSplitAction(merchantId: string, input: { label: string; recipient: string; percent: string }): Promise<ActionResult> {
  try {
    const { merchant } = await ownerOnly("Only the owner can change revenue splits.", merchantId);
    const rule = splitRuleSchema.parse(input);
    await addSplitRule(merchant, rule);
    const message = `A revenue split was added: ${rule.percent}% of each payment to ${rule.recipient} (${rule.label}). If you did not do this, remove it in Settings now.`;
    await alertOwner(merchant, "split_changed", message, "/dashboard/settings");
    revalidatePath("/dashboard/settings");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function removeSplitAction(merchantId: string, ruleId: string): Promise<ActionResult> {
  try {
    const { merchant } = await ownerOnly("Only the owner can change revenue splits.", merchantId);
    await getDb().splitRule.deleteMany({ where: { id: ID.parse(ruleId), merchantId: merchant.id } });
    revalidatePath("/dashboard/settings");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}
