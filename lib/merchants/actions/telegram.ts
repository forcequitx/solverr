"use server";

import { revalidatePath } from "next/cache";
import { ApiError } from "@/lib/api/errors";
import { getDb } from "@/lib/db";
import { type ActionResult, editable, fail, ID } from "@/lib/merchants/actions/shared";
import { botUsername, telegramEnabled } from "@/lib/telegram/api";
import { createConnectCode } from "@/lib/telegram/bot";

/** A one-time code the teammate sends to the bot to link a chat. */
export async function createTelegramCodeAction(merchantId: string): Promise<ActionResult<{ code: string; bot: string | null }>> {
  try {
    const { merchant, user } = await editable(merchantId);
    if (!telegramEnabled()) throw new ApiError(400, "invalid_request", "The Telegram bot is not set up on this Solverr server.");
    return { ok: true, code: await createConnectCode(merchant.id, user.id), bot: (await botUsername()) ?? null };
  } catch (error) {
    return fail(error);
  }
}

export async function disconnectTelegramAction(merchantId: string, chatRowId: string): Promise<ActionResult> {
  try {
    const { merchant } = await editable(merchantId);
    await getDb().telegramChat.deleteMany({ where: { id: ID.parse(chatRowId), merchantId: merchant.id } });
    revalidatePath("/dashboard/settings");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}
