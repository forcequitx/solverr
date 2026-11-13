import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/telegram/route";

/** The webhook secret registered with Telegram's setWebhook in this run; the real setting is empty in unit tests. */
const SECRET = "telegram-webhook-secret-0123456789abcdef";

const bot = vi.hoisted(() => ({ handleTelegramUpdate: vi.fn(async () => undefined) }));

vi.mock("@/lib/env", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/env")>();
  return { ...original, getEnv: () => ({ ...original.getEnv(), TELEGRAM_BOT_TOKEN: "123456:test-token", TELEGRAM_WEBHOOK_SECRET: SECRET }) };
});

vi.mock("@/lib/telegram/bot", () => ({ handleTelegramUpdate: bot.handleTelegramUpdate }));

const UPDATE = { message: { chat: { id: 42, type: "private" }, text: "/help" } };

/** A webhook call as Telegram sends it; `secret` null sends no secret header. */
function webhook(secret: string | null): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret !== null) headers["x-telegram-bot-api-secret-token"] = secret;
  return POST(new Request("http://localhost:3000/api/telegram", { method: "POST", headers, body: JSON.stringify(UPDATE) }));
}

beforeEach(() => {
  bot.handleTelegramUpdate.mockClear();
});

describe("POST /api/telegram", () => {
  it("accepts the registered secret and hands the update to the bot", async () => {
    const response = await webhook(SECRET);
    expect(response.status).toBe(200);
    expect(bot.handleTelegramUpdate).toHaveBeenCalledExactlyOnceWith(UPDATE);
  });

  it.each([
    ["no secret header", null],
    ["an empty secret header", ""],
    ["a wrong secret of the same length", `${SECRET.slice(0, -1)}x`],
    ["a shorter secret", SECRET.slice(0, -1)],
    ["a longer secret", `${SECRET}x`],
  ])("refuses %s with 401 and never calls the bot", async (_, secret) => {
    const response = await webhook(secret);
    expect(response.status).toBe(401);
    expect(bot.handleTelegramUpdate).not.toHaveBeenCalled();
  });
});
