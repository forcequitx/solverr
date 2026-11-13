import { ApiError } from "@/lib/api/errors";

/** Step-up window: changing where money goes or how the user signs in needs a sign-in this recent, so a stolen session alone cannot. */
const RECENT_SIGN_IN_MS = 30 * 60_000;

/** Refuses `action` unless the session began within RECENT_SIGN_IN_MS. */
export function assertRecentSignIn(session: { signedInAt: Date }, action: string): void {
  if (Date.now() - session.signedInAt.getTime() <= RECENT_SIGN_IN_MS) return;
  throw new ApiError(403, "authentication_failed", `For your security, sign out and sign in again, then ${action} within ${RECENT_SIGN_IN_MS / 60_000} minutes.`);
}
