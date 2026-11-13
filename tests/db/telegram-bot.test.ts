import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Merchant, TeamRole } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/ids";
import { createConnectCode, handleTelegramUpdate, type TelegramUpdate } from "@/lib/telegram/bot";
import { createMerchant, TEST_TOKENS } from "./factories";

/** Bot answers are collected here instead of going to the Telegram API. */
const telegram = vi.hoisted(() => ({ sendTelegramMessage: vi.fn<(chatId: string, text: string) => Promise<unknown>>(async () => ({})) }));

vi.mock("@/lib/telegram/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/telegram/api")>()),
  sendTelegramMessage: telegram.sendTelegramMessage,
}));

/** `/invoice` prices the invoice from the token list, which stands in for 1Click here. */
vi.mock("@/lib/oneclick/tokens", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/oneclick/tokens")>()),
  findToken: async (assetId: string) => TEST_TOKENS.find((token) => token.assetId === assetId),
}));

const CHAT_ID = 777001;
const NOT_CONNECTABLE = "Only an owner or developer of the business can connect a chat. Ask one of them for a new code.";
const VIEWER_REFUSED = "Your role can view this business but not change it. Ask the owner for a different role.";
const PRIVATE_ONLY = "This bot works only in a private chat. Send it a direct message.";
const DEPARTED = "This chat was disconnected because the person who linked it no longer belongs to the business.";
const NO_PAYOUT_WALLET =
  "Customers cannot pay this business until it has a verified payout wallet. Verify one in the Solverr dashboard under Settings → Payout wallet (only the owner can), then send this command again.";

const WRITE_COMMANDS = ["/invoice 25 USD Two coffees", "/paylink 4.50 USD Flat white", "/tiplink Tip jar"];

/** Sends `text` to the bot from chat `CHAT_ID` and returns the bot's answers to that chat. */
async function send(text: string, type: "private" | "group" | "supergroup" | "channel" = "private"): Promise<string[]> {
  telegram.sendTelegramMessage.mockClear();
  const update: TelegramUpdate = { message: { chat: { id: CHAT_ID, type }, text } };
  await handleTelegramUpdate(update);
  return telegram.sendTelegramMessage.mock.calls.map(([chatId, answer]) => {
    expect(chatId).toBe(String(CHAT_ID));
    return answer;
  });
}

/** A user with `role` in `merchant`. */
async function teammate(merchant: Pick<Merchant, "id">, role: TeamRole): Promise<string> {
  const db = getDb();
  const id = randomUUID();
  await db.user.create({ data: { id, name: "Ada", email: `${id}@example.com` } });
  await db.teamMember.create({ data: { id: newId("tm"), merchantId: merchant.id, userId: id, role } });
  return id;
}

/** Links chat `CHAT_ID` to `merchant` as the given user, as a successful /connect does. */
function linkChat(merchant: Pick<Merchant, "id">, userId: string) {
  return getDb().telegramChat.create({ data: { id: newId("tg"), merchantId: merchant.id, chatId: String(CHAT_ID), userId } });
}

const linkedChat = () => getDb().telegramChat.findUnique({ where: { chatId: String(CHAT_ID) } });
const createdRows = async (merchantId: string) => ({
  invoices: await getDb().invoice.count({ where: { merchantId } }),
  links: await getDb().paymentLink.count({ where: { merchantId } }),
});

beforeEach(() => {
  telegram.sendTelegramMessage.mockClear();
});

describe("Telegram /connect", () => {
  it.each(["owner", "developer"] as const)("links the chat with a code from an %s and uses the code up", async (role) => {
    const merchant = await createMerchant();
    const userId = await teammate(merchant, role);
    const code = await createConnectCode(merchant.id, userId);

    expect(await send(`/connect ${code}`)).toEqual([`Connected to ${merchant.name}. Send /help to see the bot commands.`]);
    expect(await linkedChat()).toMatchObject({ merchantId: merchant.id, userId });
    expect(await getDb().verification.count()).toBe(0);
  });

  it("links nothing with a code whose creator is now a viewer, and leaves the code unused", async () => {
    const merchant = await createMerchant();
    const userId = await teammate(merchant, "developer");
    const code = await createConnectCode(merchant.id, userId);
    await getDb().teamMember.updateMany({ where: { merchantId: merchant.id, userId }, data: { role: "viewer" } });

    expect(await send(`/connect ${code}`)).toEqual([NOT_CONNECTABLE]);
    expect(await linkedChat()).toBeNull();
    expect(await getDb().verification.count()).toBe(1);
  });

  it("links nothing with a code whose creator has left the business", async () => {
    const merchant = await createMerchant();
    const userId = await teammate(merchant, "owner");
    const code = await createConnectCode(merchant.id, userId);
    await getDb().teamMember.deleteMany({ where: { merchantId: merchant.id, userId } });

    expect(await send(`/start ${code}`)).toEqual([NOT_CONNECTABLE]);
    expect(await linkedChat()).toBeNull();
  });
});

describe("Telegram chat roles", () => {
  it("lets a developer's chat create invoices, payment links and tip links", async () => {
    const merchant = await createMerchant();
    await linkChat(merchant, await teammate(merchant, "developer"));

    const [invoice] = await send(WRITE_COMMANDS[0]);
    expect(invoice).toMatch(/^Invoice for 25 USD\. Send this payment page to your customer:\nhttp:\/\/localhost:3000\/pay\/inv_/);
    expect((await send(WRITE_COMMANDS[1]))[0]).toMatch(/^Payment link "Flat white" for 4\.50 USD:\nhttp:\/\/localhost:3000\/l\/lnk_/);
    expect((await send(WRITE_COMMANDS[2]))[0]).toMatch(/^Tip link "Tip jar" \(the customer chooses the amount\):\nhttp:\/\/localhost:3000\/l\/lnk_/);
    expect(await createdRows(merchant.id)).toEqual({ invoices: 1, links: 2 });
  });

  it.each(WRITE_COMMANDS)("refuses a viewer's chat %s and creates nothing", async (command) => {
    const merchant = await createMerchant();
    await linkChat(merchant, await teammate(merchant, "viewer"));

    expect(await send(command)).toEqual([VIEWER_REFUSED]);
    expect(await createdRows(merchant.id)).toEqual({ invoices: 0, links: 0 });
  });

  it("still answers read commands in a viewer's chat", async () => {
    const merchant = await createMerchant();
    await linkChat(merchant, await teammate(merchant, "viewer"));

    expect(await send("/payments")).toEqual(["No invoices yet. Create one with /invoice."]);
  });

  it("disconnects the chat of a teammate who left the business and creates nothing", async () => {
    const merchant = await createMerchant();
    const userId = await teammate(merchant, "owner");
    await linkChat(merchant, userId);
    await getDb().teamMember.deleteMany({ where: { merchantId: merchant.id, userId } });

    expect(await send(WRITE_COMMANDS[1])).toEqual([DEPARTED]);
    expect(await linkedChat()).toBeNull();
    expect(await createdRows(merchant.id)).toEqual({ invoices: 0, links: 0 });
  });
});

describe("Telegram group chats", () => {
  it("refuses /connect in a group and leaves the code unused", async () => {
    const merchant = await createMerchant();
    const code = await createConnectCode(merchant.id, await teammate(merchant, "owner"));

    expect(await send(`/connect ${code}`, "group")).toEqual([PRIVATE_ONLY]);
    expect(await linkedChat()).toBeNull();
    expect(await getDb().verification.count()).toBe(1);
  });

  it.each(["group", "supergroup"] as const)("refuses commands in a %s even when its chat id is linked", async (type) => {
    const merchant = await createMerchant();
    await linkChat(merchant, await teammate(merchant, "owner"));

    expect(await send(WRITE_COMMANDS[1], type)).toEqual([PRIVATE_ONLY]);
    expect(await send("/payments", type)).toEqual([PRIVATE_ONLY]);
    expect(await createdRows(merchant.id)).toEqual({ invoices: 0, links: 0 });
  });

  it("stays silent on plain text in a group", async () => {
    expect(await send("hello everyone", "group")).toEqual([]);
  });
});

describe("Telegram payout wallet check", () => {
  it.each(WRITE_COMMANDS)("refuses %s while the business has no verified payout wallet", async (command) => {
    const merchant = await createMerchant({ payoutVerifiedAt: null });
    await linkChat(merchant, await teammate(merchant, "owner"));

    expect(await send(command)).toEqual([NO_PAYOUT_WALLET]);
    expect(await createdRows(merchant.id)).toEqual({ invoices: 0, links: 0 });
  });

  it("still answers read commands while the business has no verified payout wallet", async () => {
    const merchant = await createMerchant({ payoutVerifiedAt: null });
    await linkChat(merchant, await teammate(merchant, "owner"));

    expect(await send("/payments")).toEqual(["No invoices yet. Create one with /invoice."]);
  });
});
