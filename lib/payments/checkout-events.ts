import { waitUntil } from "@vercel/functions";
import { Client } from "pg";
import type { Prisma } from "@/generated/prisma/client";
import { databaseTls } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { errorMessage, logger } from "@/lib/logger";

const log = logger.child({ module: "checkout-events" });

/** Postgres channel whose messages carry the id of an invoice whose checkout state changed. */
const CHANNEL = "checkout";
const CONNECT_TIMEOUT_MS = 5_000;

type Subscriber = { onChange: () => void; onLost: () => void };

/** One listening connection per process, shared by every open stream; kept on globalThis so development reloads reuse it. */
type Hub = { client: Client | null; connecting: Promise<Client> | null; subscribers: Map<string, Set<Subscriber>> };
const hub: Hub = ((globalThis as { checkoutHub?: Hub }).checkoutHub ??= { client: null, connecting: null, subscribers: new Map() });

/** Tells open checkouts of `invoiceId` that their state changed; Postgres delivers it only if the transaction commits. */
export async function notifyCheckout(tx: Prisma.TransactionClient, invoiceId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_notify(${CHANNEL}, ${invoiceId})`;
}

/** `notifyCheckout` for many invoices in one statement. */
export async function notifyCheckouts(tx: Prisma.TransactionClient, invoiceIds: string[]): Promise<void> {
  await tx.$executeRaw`SELECT pg_notify(${CHANNEL}, id) FROM unnest(${invoiceIds}::text[]) AS id`;
}

/** Forgets a lost connection and closes every stream, so their pages poll until they reconnect and miss nothing. */
function drop(client: Client): void {
  if (hub.client !== client) return;
  hub.client = null;
  client.removeAllListeners();
  client.on("error", () => {});
  void client.end().catch(() => {});
  log.error("The database listener disconnected; open checkouts poll until they reconnect");
  for (const subscribers of hub.subscribers.values()) subscribers.forEach((subscriber) => subscriber.onLost());
}

async function open(): Promise<Client> {
  const client = new Client({ connectionString: getEnv().DATABASE_URL, ssl: databaseTls(), keepAlive: true, connectionTimeoutMillis: CONNECT_TIMEOUT_MS });
  client.on("error", () => drop(client));
  client.on("end", () => drop(client));
  client.on("notification", ({ channel, payload }) => {
    if (channel === CHANNEL && payload) hub.subscribers.get(payload)?.forEach((subscriber) => subscriber.onChange());
  });
  try {
    await client.connect();
    await client.query(`LISTEN ${CHANNEL}`);
  } catch (error) {
    client.removeAllListeners();
    client.on("error", () => {});
    void client.end().catch(() => {});
    throw error;
  }
  hub.client = client;
  return client;
}

/** The listening connection, opened on first use and again after it was lost; concurrent callers share one attempt. */
function listen(): Promise<Client> {
  if (hub.client) return Promise.resolve(hub.client);
  hub.connecting ??= open().finally(() => {
    hub.connecting = null;
  });
  return hub.connecting;
}

/** Closes the listening connection once no stream uses it, so an idle function instance holds no database session behind PgBouncer. */
function closeIfUnused(): void {
  const client = hub.client;
  if (!client || hub.subscribers.size > 0) return;
  hub.client = null;
  client.removeAllListeners();
  client.on("error", () => {});
  waitUntil(client.end().catch(() => {}));
}

function removeSubscriber(invoiceId: string, subscriber: Subscriber): void {
  const current = hub.subscribers.get(invoiceId);
  current?.delete(subscriber);
  if (current?.size === 0) hub.subscribers.delete(invoiceId);
  closeIfUnused();
}

/** Calls `onChange` on each checkout change of the invoice and `onLost` if the listener drops; returns an unsubscribe, or null if it cannot listen.
    The subscriber is counted before the connection opens, so a stream closing meanwhile cannot close the connection under it. */
export async function subscribeCheckout(invoiceId: string, subscriber: Subscriber): Promise<(() => void) | null> {
  let subscribers = hub.subscribers.get(invoiceId);
  if (!subscribers) hub.subscribers.set(invoiceId, (subscribers = new Set()));
  subscribers.add(subscriber);
  try {
    await listen();
  } catch (error) {
    log.error({ error: errorMessage(error) }, "Could not listen for checkout changes");
    removeSubscriber(invoiceId, subscriber);
    return null;
  }
  return () => removeSubscriber(invoiceId, subscriber);
}
