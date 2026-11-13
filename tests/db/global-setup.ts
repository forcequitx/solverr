import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";
import { Client } from "pg";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PRISMA_CLI = join(ROOT, "node_modules", "prisma", "build", "index.js");

/** Host, port and database name, so two spellings of one database compare equal. */
function databaseOf(url: string): string {
  const parsed = new URL(url);
  return `${parsed.hostname}:${parsed.port || "5432"}/${parsed.pathname.slice(1)}`;
}

/** The developer's database from the shell and from `.env`; the test database must be neither, since its schema is dropped. */
function developerDatabases(): string[] {
  const envFile = join(ROOT, ".env");
  const fromFile = existsSync(envFile) ? parse(readFileSync(envFile)).DATABASE_URL : undefined;
  return [process.env.DATABASE_URL, fromFile].filter((url): url is string => !!url && URL.canParse(url)).map(databaseOf);
}

/** Recreates schema `public` in TEST_DATABASE_URL and applies every migration, so each run starts from the real schema. */
export default async function setup(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !URL.canParse(url)) {
    throw new Error('TEST_DATABASE_URL is not set. Set it to a throwaway Postgres database whose name contains "test" (its schema is dropped), then run npm run test:db.');
  }
  const database = databaseOf(url);
  if (!/test/i.test(database.split("/")[1])) throw new Error(`Refusing to reset ${database}: the test database name must contain "test".`);
  if (developerDatabases().includes(database)) throw new Error(`Refusing to reset ${database}: it is the developer's DATABASE_URL.`);

  const client = new Client({ connectionString: url, connectionTimeoutMillis: 10_000 });
  await client.connect();
  try {
    await client.query("DROP SCHEMA IF EXISTS public CASCADE");
    await client.query("CREATE SCHEMA public");
  } finally {
    await client.end();
  }
  execFileSync(process.execPath, [PRISMA_CLI, "migrate", "deploy", "--config", "prisma7.config.ts"], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
    timeout: 120_000,
  });
}
