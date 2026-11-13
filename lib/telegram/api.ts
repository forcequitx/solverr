import { getEnv } from "@/lib/env";

const TIMEOUT_MS = 10_000;

/** The bot works only with both values: without the secret, `/api/telegram` refuses every update. */
export function telegramEnabled(): boolean {
  const { TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET } = getEnv();
  return Boolean(TELEGRAM_BOT_TOKEN && TELEGRAM_WEBHOOK_SECRET);
}

/** A refusal from the Telegram API with its `error_code`, such as 403 when the user blocked the bot. */
class TelegramError extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message);
    this.name = "TelegramError";
  }
}

/** Whether trying again later can succeed: network failures, rate limits and Telegram server errors. */
export function isTransientTelegramError(error: unknown): boolean {
  return !(error instanceof TelegramError) || error.code === 429 || error.code >= 500;
}

/** Until when Telegram asked this process to stop sending (its 429 `retry_after`); calls before then fail at once. */
let waitUntil = 0;

async function call<T>(method: string, body: object): Promise<T> {
  const token = getEnv().TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("Telegram is not configured");
  if (Date.now() < waitUntil) throw new TelegramError(`Telegram ${method} skipped: Telegram asked to wait`, 429);
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json = (await response.json()) as { ok: boolean; result?: T; description?: string; error_code?: number; parameters?: { retry_after?: number } };
  if (!json.ok) {
    const retryAfter = json.parameters?.retry_after;
    if (json.error_code === 429 && retryAfter) waitUntil = Date.now() + retryAfter * 1000;
    throw new TelegramError(`Telegram ${method} failed: ${json.description ?? response.status}`, json.error_code ?? response.status);
  }
  return json.result as T;
}

export function sendTelegramMessage(chatId: string, text: string): Promise<unknown> {
  return call("sendMessage", { chat_id: chatId, text, link_preview_options: { is_disabled: true } });
}

let username: string | undefined;

/** The bot's @username, for showing merchants where to send the connect code. */
export async function botUsername(): Promise<string | undefined> {
  if (!telegramEnabled()) return undefined;
  username ??= (await call<{ username: string }>("getMe", {}).catch(() => undefined))?.username;
  return username;
}
