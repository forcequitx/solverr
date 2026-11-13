import { afterAll, beforeEach } from "vitest";
import { getDb } from "@/lib/db";

/** Every test starts from empty tables; the schema and migration history stay. */
beforeEach(async () => {
  const db = getDb();
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length > 0) await db.$executeRawUnsafe(`TRUNCATE ${tables.map(({ tablename }) => `"public"."${tablename}"`).join(", ")} CASCADE`);
});

afterAll(async () => {
  await getDb().$disconnect();
});
