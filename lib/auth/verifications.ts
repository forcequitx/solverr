import { deleteInBatches, getDb } from "@/lib/db";

const EXPIRED_GRACE_MS = 60 * 60_000;

/** Worker job: deletes verification rows (sign-in, wallet and Telegram codes) and sessions that expired over an hour ago. */
export async function pruneExpiredVerifications(): Promise<number> {
  const db = getDb();
  const before = new Date(Date.now() - EXPIRED_GRACE_MS);
  const verifications = await deleteInBatches(
    async (take) => (await db.verification.findMany({ where: { expiresAt: { lt: before } }, select: { id: true }, take })).map((row) => row.id),
    (ids) => db.verification.deleteMany({ where: { id: { in: ids } } }),
  );
  const sessions = await deleteInBatches(
    async (take) => (await db.session.findMany({ where: { expiresAt: { lt: before } }, select: { id: true }, take })).map((row) => row.id),
    (ids) => db.session.deleteMany({ where: { id: { in: ids } } }),
  );
  return verifications + sessions;
}
