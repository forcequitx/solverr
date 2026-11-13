import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { ApiError } from "@/lib/api/errors";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { deleteInBatches, getDb } from "@/lib/db";
import { newId } from "@/lib/ids";
import { errorMessage, logger } from "@/lib/logger";
import { DAY_MS } from "@/lib/time";

const log = logger.child({ module: "idempotency" });

type Result = { status: number; body: Prisma.InputJsonValue };
/** A stored response, encrypted because it can carry a bearer secret (a top-up returns its credit token, otherwise kept only hashed). */
type StoredResponse = { ciphertext: string };

const MAX_KEY_LENGTH = 255;
/** Status code stored while the first request with a key is still running. */
const IN_PROGRESS = 0;
/** Stored responses are replayed for 24 hours; after that the key can be used again. */
const IDEMPOTENCY_TTL_MS = DAY_MS;

/** Replays the stored response for a POST retried with the same merchant-scoped `Idempotency-Key`; a different body gets 409.
    The key is claimed (status 0) before the handler runs, so a concurrent retry gets 409; errors and 5xx release the claim. */
export async function withIdempotency(request: Request, merchantId: string, rawBody: string, run: () => Promise<Result>): Promise<Response> {
  const key = request.headers.get("idempotency-key");
  if (key === null) {
    const result = await run();
    return Response.json(result.body, { status: result.status });
  }
  if (!key || key.length > MAX_KEY_LENGTH) {
    throw new ApiError(400, "invalid_request", `Idempotency-Key must be 1–${MAX_KEY_LENGTH} characters.`, "Idempotency-Key");
  }

  const db = getDb();
  const requestHash = createHash("sha256").update(`${request.method} ${new URL(request.url).pathname}\n${rawBody}`).digest("hex");

  const replay = async () => {
    const existing = await db.idempotencyRecord.findUnique({ where: { merchantId_key: { merchantId, key } } });
    if (!existing) return undefined;
    if (Date.now() - existing.createdAt.getTime() > IDEMPOTENCY_TTL_MS) {
      await db.idempotencyRecord.deleteMany({ where: { id: existing.id } });
      return undefined;
    }
    if (existing.requestHash !== requestHash) {
      throw new ApiError(409, "idempotency_conflict", "This Idempotency-Key was already used with a different request.", "Idempotency-Key");
    }
    if (existing.statusCode === IN_PROGRESS) throw inProgress();
    const body: unknown = JSON.parse(decryptSecret((existing.responseBody as StoredResponse).ciphertext));
    return Response.json(body, { status: existing.statusCode, headers: { "Idempotent-Replayed": "true" } });
  };

  const previous = await replay();
  if (previous) return previous;

  const id = newId("idem");
  try {
    await db.idempotencyRecord.create({ data: { id, merchantId, key, requestHash, statusCode: IN_PROGRESS, responseBody: {} } });
  } catch (error) {
    /** A concurrent request with the same key claimed it first; its stored result or 409 is returned. */
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const concurrent = await replay();
      if (concurrent) return concurrent;
      throw inProgress();
    }
    throw error;
  }

  /** A failed release is logged and never replaces the handler's own error or answer; the key then stays in progress for 24 hours. */
  const release = () =>
    db.idempotencyRecord
      .deleteMany({ where: { id } })
      .then(() => undefined)
      .catch((error: Error) => log.error({ record: id, error: errorMessage(error) }, "Claim not released; the key stays in progress for 24 hours"));
  let result: Result;
  try {
    result = await run();
  } catch (error) {
    await release();
    throw error;
  }
  if (result.status >= 500) {
    await release();
  } else {
    /** The handler already ran, so a failed save is retried once and then logged; the key stays in progress, not run again, for 24 hours. */
    const stored: StoredResponse = { ciphertext: encryptSecret(JSON.stringify(result.body)) };
    const save = () => db.idempotencyRecord.update({ where: { id }, data: { statusCode: result.status, responseBody: stored } });
    await save()
      .catch(save)
      .catch((error: Error) => log.error({ record: id, error: errorMessage(error) }, "Response not stored; the key stays in progress for 24 hours"));
  }
  return Response.json(result.body, { status: result.status });
}

function inProgress(): ApiError {
  return new ApiError(409, "idempotency_conflict", "A request with this Idempotency-Key is still being processed. Retry shortly.", "Idempotency-Key", 1);
}

/** Worker job: deletes stored responses older than the replay window. */
export async function pruneIdempotencyRecords(): Promise<number> {
  const db = getDb();
  const before = new Date(Date.now() - IDEMPOTENCY_TTL_MS);
  return deleteInBatches(
    async (take) => (await db.idempotencyRecord.findMany({ where: { createdAt: { lt: before } }, select: { id: true }, take })).map((row) => row.id),
    (ids) => db.idempotencyRecord.deleteMany({ where: { id: { in: ids } } }),
  );
}
