import { setTimeout as sleep } from "node:timers/promises";
import { toApiError } from "@/lib/api/errors";
import { getDb } from "@/lib/db";
import type { Currency } from "@/lib/fx";
import { newId, randomToken } from "@/lib/ids";
import { createInvoice } from "@/lib/invoices/create";
import { createInvoiceSchema, currencySchema, fiatAmountSchema } from "@/lib/invoices/schema";
import { serializeInvoice } from "@/lib/invoices/serialize";
import { errorMessage, logger } from "@/lib/logger";
import { createPaymentLink, serializePaymentLink } from "@/lib/payment-links/links";
import { isTransientTelegramError, sendTelegramMessage } from "@/lib/telegram/api";
import { CONNECT_CODE_TTL_MS } from "@/lib/telegram/connect-code";
import { DAY_MS } from "@/lib/time";

const log = logger.child({ module: "telegram" });

/** Waits before each retry of a "payment received" message to a chat that failed for a reason that may pass. */
const PAID_MESSAGE_RETRY_MS = [2_000, 5_000];
const CODE_PREFIX = "telegram:";

export type TelegramUpdate = {
  message?: { chat: { id: number; type: "private" | "group" | "supergroup" | "channel" }; text?: string };
};

const HELP = [
  "Solverr bot commands:",
  "/connect CODE – link this chat to your business (get the code in Settings → Telegram).",
  "/invoice 25 USD Two coffees – create an invoice and get its payment page.",
  "/paylink 4.50 USD Flat white – create a reusable payment link.",
  "/tiplink Tip jar – a link where the customer chooses the amount (USD).",
  "/payments – your five newest invoices and their status.",
  "/disconnect – stop using this chat.",
  "This chat also gets a message whenever a payment completes.",
].join("\n");

/** Commands that create invoices or links; a viewer's chat may only read. */
const WRITE_COMMANDS: ReadonlySet<string> = new Set(["/invoice", "/paylink", "/tiplink"]);

/** The bot works on live data only; merchants have no test mode. */
const MODE = "live";

/** One-time code a teammate sends to the bot to link a chat; valid for 10 minutes. */
export async function createConnectCode(merchantId: string, userId: string): Promise<string> {
  const code = randomToken(8);
  await getDb().verification.create({
    data: { id: newId("vrf"), identifier: CODE_PREFIX + code, value: JSON.stringify({ merchantId, userId }), expiresAt: new Date(Date.now() + CONNECT_CODE_TTL_MS) },
  });
  return code;
}

async function connect(chatId: string, code: string): Promise<string> {
  const db = getDb();
  const invalid = "This code is not valid or has expired. Create a new one in Settings → Telegram.";
  const record = await db.verification.findFirst({ where: { identifier: CODE_PREFIX + code } });
  if (!record || record.expiresAt < new Date()) return invalid;
  const { merchantId, userId } = JSON.parse(record.value) as { merchantId: string; userId: string };
  /** Only owners and developers create codes; one whose creator has since left or become a viewer links nothing. */
  const member = await db.teamMember.findFirst({ where: { merchantId, userId }, select: { role: true } });
  if (!member || member.role === "viewer") return "Only an owner or developer of the business can connect a chat. Ask one of them for a new code.";
  const linked = await db.telegramChat.findUnique({ where: { chatId }, select: { merchantId: true } });
  if (linked && linked.merchantId !== merchantId) return "This chat is connected to another business. Send /disconnect first.";
  /** Consuming the code is the check: of two messages sending the same code, only one deletes it. */
  const consumed = await db.verification.deleteMany({ where: { id: record.id, expiresAt: { gt: new Date() } } });
  if (consumed.count !== 1) return invalid;
  await db.telegramChat.upsert({
    where: { chatId },
    create: { id: newId("tg"), merchantId, chatId, userId },
    update: { merchantId, userId },
  });
  const merchant = await db.merchant.findUniqueOrThrow({ where: { id: merchantId }, select: { name: true } });
  return `Connected to ${merchant.name}. Send /help to see the bot commands.`;
}

function parseAmount(args: string[]): { amount: string; currency: Currency; rest: string } | undefined {
  const [amount, currency, ...rest] = args;
  const parsedAmount = fiatAmountSchema().safeParse(amount);
  const parsedCurrency = currencySchema.safeParse((currency ?? "").toUpperCase());
  if (!parsedAmount.success || !parsedCurrency.success) return undefined;
  return { amount: parsedAmount.data, currency: parsedCurrency.data, rest: rest.join(" ").trim() };
}

async function reply(chatId: string, text: string): Promise<string> {
  const db = getDb();
  const [command, ...args] = text.trim().split(/\s+/);
  const name = command.toLowerCase().replace(/@.*$/, "");

  if (name === "/connect" || (name === "/start" && args[0])) return args[0] ? connect(chatId, args[0]) : "Send /connect CODE with the code from Settings → Telegram.";
  if (name === "/start" || name === "/help") return HELP;

  const chat = await db.telegramChat.findUnique({ where: { chatId }, include: { merchant: true } });
  if (!chat) return "This chat is not connected yet. In the Solverr dashboard, open Settings → Telegram, create a code, and send /connect CODE here.";
  const { merchant } = chat;
  /** The chat acts with the role of the teammate who linked it. */
  const member = await db.teamMember.findFirst({ where: { merchantId: merchant.id, userId: chat.userId }, select: { role: true } });
  if (!member) {
    await db.telegramChat.deleteMany({ where: { chatId } });
    return "This chat was disconnected because the person who linked it no longer belongs to the business.";
  }
  if (member.role === "viewer" && WRITE_COMMANDS.has(name)) return "Your role can view this business but not change it. Ask the owner for a different role.";
  if (WRITE_COMMANDS.has(name) && !merchant.payoutVerifiedAt) {
    return "Customers cannot pay this business until it has a verified payout wallet. Verify one in the Solverr dashboard under Settings → Payout wallet (only the owner can), then send this command again.";
  }

  switch (name) {
    case "/invoice": {
      const parsed = parseAmount(args);
      if (!parsed) return "Use: /invoice 25 USD Two coffees (currency USD, EUR or INR).";
      const description = createInvoiceSchema.shape.description.safeParse(parsed.rest || undefined);
      if (!description.success) return "The description can be at most 500 characters.";
      const invoice = await createInvoice(merchant, MODE, { amount: parsed.amount, currency: parsed.currency, description: description.data });
      return `Invoice for ${parsed.amount} ${parsed.currency}. Send this payment page to your customer:\n${serializeInvoice(invoice).checkout_url}`;
    }
    case "/paylink": {
      const parsed = parseAmount(args);
      if (!parsed || !parsed.rest) return "Use: /paylink 4.50 USD Flat white (currency USD, EUR or INR, then a title).";
      const link = await createPaymentLink(merchant, MODE, { title: parsed.rest.slice(0, 120), amount: parsed.amount, currency: parsed.currency });
      return `Payment link "${link.title}" for ${parsed.amount} ${parsed.currency}:\n${serializePaymentLink(link).url}`;
    }
    case "/tiplink": {
      const title = args.join(" ").trim().slice(0, 120);
      if (!title) return "Use: /tiplink Tip jar";
      const link = await createPaymentLink(merchant, MODE, { title, currency: "USD" });
      return `Tip link "${title}" (the customer chooses the amount):\n${serializePaymentLink(link).url}`;
    }
    case "/payments": {
      const invoices = await db.invoice.findMany({ where: { merchantId: merchant.id, mode: MODE }, orderBy: { createdAt: "desc" }, take: 5 });
      if (invoices.length === 0) return "No invoices yet. Create one with /invoice.";
      return invoices.map((invoice) => `${invoice.amount.toFixed(2)} ${invoice.currency} · ${invoice.status.replace(/_/g, " ")} · ${invoice.description ?? invoice.orderId ?? invoice.id}`).join("\n");
    }
    case "/disconnect":
      await db.telegramChat.deleteMany({ where: { chatId } });
      return "Disconnected. This chat no longer receives payment messages.";
    default:
      return HELP;
  }
}

/** Answers one Telegram update; commands work only in private chats. A failed command gets the reason, or a generic message with the error reported. */
export async function handleTelegramUpdate(update: TelegramUpdate): Promise<void> {
  const message = update.message;
  if (!message?.text) return;
  const chatId = String(message.chat.id);
  if (message.chat.type !== "private") {
    if (message.text.startsWith("/")) await sendTelegramMessage(chatId, "This bot works only in a private chat. Send it a direct message.");
    return;
  }
  let text: string;
  try {
    text = await reply(chatId, message.text);
  } catch (error) {
    text = toApiError(error).message;
  }
  await sendTelegramMessage(chatId, text);
}

/** Worker job: tells linked chats about payments that completed, once per invoice. */
export async function notifyTelegramPaid(signal: AbortSignal): Promise<number> {
  const db = getDb();
  const invoices = await db.invoice.findMany({
    where: { mode: MODE, status: "paid", telegramNotifiedAt: null, paidAt: { gt: new Date(Date.now() - DAY_MS) }, merchant: { telegramChats: { some: {} } } },
    include: { merchant: { include: { telegramChats: true } } },
    orderBy: { paidAt: "desc" },
    take: 20,
  });
  for (const invoice of invoices) {
    if (signal.aborted) break;
    const claimed = await db.invoice.updateMany({ where: { id: invoice.id, telegramNotifiedAt: null }, data: { telegramNotifiedAt: new Date() } });
    if (claimed.count === 0) continue;
    const text = `Payment received: ${invoice.amount.toFixed(2)} ${invoice.currency}${invoice.description ? ` · ${invoice.description}` : ""}`;
    /** Only chats linked before the payment get it; an invoice with none stays claimed, so a newly linked chat gets no backlog. */
    let pending = invoice.merchant.telegramChats.filter((chat) => invoice.paidAt !== null && chat.createdAt <= invoice.paidAt).map((chat) => chat.chatId);
    let sent = 0;
    /** A chat that failed for a reason that may pass is tried again after a short wait; the chats that got it are not sent it twice. */
    for (let attempt = 0; attempt <= PAID_MESSAGE_RETRY_MS.length && pending.length > 0 && !signal.aborted; attempt++) {
      if (attempt > 0) await sleep(PAID_MESSAGE_RETRY_MS[attempt - 1]);
      const retry: string[] = [];
      for (const chatId of pending) {
        await sendTelegramMessage(chatId, text).then(
          () => sent++,
          (error: Error) => {
            if (isTransientTelegramError(error)) retry.push(chatId);
            log.error({ chat: chatId, error: errorMessage(error) }, "Payment message failed");
          },
        );
      }
      pending = retry;
    }
    /** When no chat got the message for a reason that may pass, the invoice is released so the next run tries again. */
    if (sent === 0 && pending.length > 0) await db.invoice.update({ where: { id: invoice.id }, data: { telegramNotifiedAt: null } });
  }
  return invoices.length;
}
