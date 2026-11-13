import pino from "pino";

/** Field names whose values never reach the log, at the top level or one level down. */
const SECRET_FIELDS = ["secret", "apiKey", "authorization", "password", "token", "privateKey", "mnemonic"];
/** Longest error text one record carries, so a long upstream message cannot flood the log. */
const MAX_ERROR_LENGTH = 300;

/** Server log: one JSON line per record on stdout; each module logs through `logger.child({ module })`; no pid or hostname. */
export const logger = pino({
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: { paths: SECRET_FIELDS.flatMap((field) => [field, `*.${field}`]), censor: "[redacted]" },
});

/** An error's message on one bounded line; a multi-line one (Prisma's) keeps its first and last line, which holds the reason. */
export function errorMessage(error: unknown): string {
  const lines = String(error instanceof Error ? error.message : error)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return (lines.length > 1 ? `${lines[0]} … ${lines[lines.length - 1]}` : (lines[0] ?? "unknown error")).slice(0, MAX_ERROR_LENGTH);
}
