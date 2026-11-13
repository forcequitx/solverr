import { timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";
import { errorMessage, logger } from "@/lib/logger";
import { telegramEnabled } from "@/lib/telegram/api";
import { handleTelegramUpdate, type TelegramUpdate } from "@/lib/telegram/bot";

const log = logger.child({ module: "telegram" });

function secretMatches(given: string | null, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Telegram webhook. Telegram sends the secret registered with setWebhook in a header; anything else is rejected. */
export async function POST(request: Request) {
  if (!telegramEnabled()) return new Response(null, { status: 404 });
  if (!secretMatches(request.headers.get("x-telegram-bot-api-secret-token"), getEnv().TELEGRAM_WEBHOOK_SECRET!)) return new Response(null, { status: 401 });
  try {
    await handleTelegramUpdate((await request.json()) as TelegramUpdate);
  } catch (error) {
    log.error({ error: errorMessage(error) }, "Update failed");
  }
  /** Telegram retries non-2xx answers; a failed reply is logged instead of being retried forever. */
  return new Response(null, { status: 200 });
}
