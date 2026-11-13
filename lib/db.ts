import { PrismaPg } from "@prisma/adapter-pg";
import { attachDatabasePool } from "@vercel/functions";
import { Pool, type ConnectionConfig } from "pg";
import { PrismaClient } from "@/generated/prisma/client";
import { getEnv } from "@/lib/env";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient; prismaClass?: typeof PrismaClient; pool?: Pool };

/** TLS accepting only a DATABASE_CA_CERT-signed certificate for the DATABASE_URL host, showing the website's client certificate
    when one is set; without DATABASE_CA_CERT (the VPS network) the connection is plain. */
export function databaseTls(): ConnectionConfig["ssl"] {
  const { DATABASE_CA_CERT: ca, DATABASE_CLIENT_CERT: cert, DATABASE_CLIENT_KEY: key } = getEnv();
  return ca ? { ca, rejectUnauthorized: true, ...(cert && key ? { cert, key } : {}) } : undefined;
}

/** Bounds on waiting for a connection, on one statement, and on a transaction left idle, so a stuck query cannot hold the pool. */
const CONNECTION_TIMEOUT_MS = 5_000;
const STATEMENT_TIMEOUT_MS = 30_000;
const IDLE_IN_TRANSACTION_TIMEOUT_MS = 60_000;
/** A replaced client is closed only after statements already running on it must have ended. */
const RETIRED_CLIENT_CLOSE_MS = CONNECTION_TIMEOUT_MS + STATEMENT_TIMEOUT_MS;
/** Codes meaning the server could not be reached or take a connection (not a failed query): network errors, Prisma connection
    codes (P1008 socket timeout, P2037 no free connection), Postgres stopping or starting (57P01–57P03), all connections in use (53300). */
const UNREACHABLE_CODES: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "P1001",
  "P1002",
  "P1008",
  "P1017",
  "P2037",
  "53300",
  "57P01",
  "57P02",
  "57P03",
]);

/** Messages of connection losses that carry no code, such as a query cut off when the server stops. */
const UNREACHABLE_MESSAGE = /connection terminated|can't reach database server|server closed the connection/i;

/** Whether an error, or the error it wraps, says the database server is unreachable. */
export function isDatabaseUnreachable(error: unknown): boolean {
  for (let current = error, depth = 0; current && depth < 4; current = (current as { cause?: unknown }).cause, depth++) {
    const { code, message } = current as { code?: unknown; message?: unknown };
    if (typeof code === "string" && UNREACHABLE_CODES.has(code)) return true;
    if (typeof message === "string" && UNREACHABLE_MESSAGE.test(message)) return true;
  }
  return false;
}

/** Rows one cleanup statement deletes at most, so a large backlog never runs one statement past STATEMENT_TIMEOUT_MS. */
const DELETE_BATCH = 5_000;

/** Deletes rows in batches of ids from `nextIds` until none are left, and returns how many were deleted. */
export async function deleteInBatches(nextIds: (take: number) => Promise<string[]>, remove: (ids: string[]) => Promise<{ count: number }>): Promise<number> {
  let total = 0;
  for (;;) {
    const ids = await nextIds(DELETE_BATCH);
    if (ids.length === 0) return total;
    total += (await remove(ids)).count;
    if (ids.length < DELETE_BATCH) return total;
  }
}

/** Whether the database answers a trivial query right now. */
export async function databaseReachable(): Promise<boolean> {
  try {
    await getDb().$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

/** Shared Prisma client, kept across hot reloads; replaced when `prisma generate` changes the client class (the old one lacks new
    models); the old one is disconnected RETIRED_CLIENT_CLOSE_MS later, once statements running on it must have ended. */
export function getDb(): PrismaClient {
  if (!globalForPrisma.prisma || globalForPrisma.prismaClass !== PrismaClient) {
    const retired = globalForPrisma.prisma;
    if (retired) setTimeout(() => retired.$disconnect().catch(() => {}), RETIRED_CLIENT_CLOSE_MS).unref();
    globalForPrisma.prismaClass = PrismaClient;
    /** One pool per process, kept across client replacements; on Vercel its idle connections close before the function sleeps. */
    if (!globalForPrisma.pool) {
      const env = getEnv();
      globalForPrisma.pool = new Pool({
        connectionString: env.DATABASE_URL,
        ssl: databaseTls(),
        max: env.DATABASE_POOL_MAX,
        connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
        statement_timeout: STATEMENT_TIMEOUT_MS,
        idle_in_transaction_session_timeout: IDLE_IN_TRANSACTION_TIMEOUT_MS,
      });
      attachDatabasePool(globalForPrisma.pool);
    }
    globalForPrisma.prisma = new PrismaClient({ adapter: new PrismaPg(globalForPrisma.pool) });
  }
  return globalForPrisma.prisma;
}
