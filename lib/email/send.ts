import { Resend } from "resend";
import { getEnv } from "@/lib/env";

const EMAIL_TIMEOUT_MS = 15_000;
/** Resend errors about the message itself, which a resend never fixes; only with 400 or 422, since a bad key or unverified domain
    is also `validation_error` but with 401 or 403. */
const REJECTED_MESSAGE_ERRORS: ReadonlySet<string> = new Set(["validation_error", "invalid_idempotent_request", "invalid_attachment"]);
const REJECTED_MESSAGE_STATUSES: ReadonlySet<number> = new Set([400, 422]);

/** The email provider refused this particular message, for example an invalid recipient address. */
export class EmailRejectedError extends Error {}

let client: Resend | undefined;

/** Email is available only when a Resend key and a sender on a verified domain are configured. */
export function emailEnabled(): boolean {
  const { RESEND_API_KEY, EMAIL_FROM } = getEnv();
  return Boolean(RESEND_API_KEY && EMAIL_FROM);
}

/** Sends one email; with an `idempotencyKey`, Resend sends a retried message only once within 24 hours. */
export async function sendEmail(message: { to: string; subject: string; html: string; text: string }, options: { idempotencyKey?: string } = {}): Promise<void> {
  const { RESEND_API_KEY, EMAIL_FROM } = getEnv();
  if (!RESEND_API_KEY || !EMAIL_FROM) throw new Error("Email is not configured");
  client ??= new Resend(RESEND_API_KEY);
  const { error } = await client.emails.send({ from: EMAIL_FROM, ...message }, { idempotencyKey: options.idempotencyKey, signal: AbortSignal.timeout(EMAIL_TIMEOUT_MS) });
  if (error) {
    const message = `Email delivery failed: ${error.message}`;
    const rejected = REJECTED_MESSAGE_ERRORS.has(error.name) && error.statusCode !== null && REJECTED_MESSAGE_STATUSES.has(error.statusCode);
    throw rejected ? new EmailRejectedError(message) : new Error(message);
  }
}
