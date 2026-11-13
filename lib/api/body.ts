import { ApiError } from "@/lib/api/errors";

/** Largest request body the API reads, for REST and MCP alike. */
export const MAX_BODY_BYTES = 64 * 1024;

const tooLarge = () => new ApiError(400, "invalid_request", "The request body is larger than 64 KB.");

/** The request body as text; reading stops and throws as soon as it passes `MAX_BODY_BYTES`, so a huge body is never held in memory. */
export async function readBodyText(request: Request): Promise<string> {
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) throw tooLarge();
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Reads a JSON request body, keeping the raw text for idempotency hashing. */
export async function readJson(request: Request): Promise<{ raw: string; data: unknown }> {
  const raw = await readBodyText(request);
  if (!raw.trim()) return { raw, data: {} };
  /** Postgres cannot store a NUL character, so a body with one is refused before anything runs. */
  if (raw.includes("\u0000") || raw.includes("\\u0000")) throw new ApiError(400, "invalid_request", "The request body cannot contain NUL characters.");
  try {
    return { raw, data: JSON.parse(raw) };
  } catch {
    throw new ApiError(400, "invalid_request", "The request body must be valid JSON.");
  }
}
