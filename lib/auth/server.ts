import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins";
import { ApiError } from "@/lib/api/errors";
import { clientNetwork, rateLimit } from "@/lib/api/rate-limit";
import { walletAuth } from "@/lib/auth/wallet-plugin";
import { getDb } from "@/lib/db";
import { emailEnabled, sendEmail } from "@/lib/email/send";
import { magicLinkEmail } from "@/lib/email/templates";
import { getEnv } from "@/lib/env";
import { DAY_MS, HOUR_MS, MINUTE_MS } from "@/lib/time";

const MAGIC_LINK_TTL_SECONDS = 300;
const SESSION_IDLE_SECONDS = 60 * 60 * 24 * 30;
/** Better Auth extends a session at most once in this long. */
const SESSION_UPDATE_AGE_SECONDS = 60 * 60 * 24;
/** A session ends this long after sign-in however often it is used, so a stolen session cookie cannot be kept alive forever. */
const SESSION_MAX_AGE_MS = 90 * DAY_MS;

/** Whether reading this session should extend it: the daily extension is due and the cap still leaves room (else it rewrites the same expiry). */
export function sessionExtensionDue(session: { createdAt: Date; expiresAt: Date }): boolean {
  const expiresAt = new Date(session.expiresAt).getTime();
  const due = expiresAt - (SESSION_IDLE_SECONDS - SESSION_UPDATE_AGE_SECONDS) * 1000 <= Date.now();
  return due && new Date(session.createdAt).getTime() + SESSION_MAX_AGE_MS > expiresAt;
}
/** Sign-in links: the tight limit is per address and requesting network, so others cannot use up the owner's; the loose per-address
    one only stops many networks flooding one inbox, and is high enough that a few networks cannot lock its owner out. */
const MAGIC_LINKS_PER_EMAIL_AND_NETWORK = { requests: 5, windowMs: 15 * MINUTE_MS };
const MAGIC_LINKS_PER_EMAIL = { requests: 60, windowMs: HOUR_MS };

async function limitMagicLinks(email: string, request: Request | undefined): Promise<void> {
  const address = email.trim().toLowerCase();
  try {
    await rateLimit(`magic-link:${address}:${request ? clientNetwork(request) : "server"}`, MAGIC_LINKS_PER_EMAIL_AND_NETWORK.requests, MAGIC_LINKS_PER_EMAIL_AND_NETWORK.windowMs);
    await rateLimit(`magic-link:${address}`, MAGIC_LINKS_PER_EMAIL.requests, MAGIC_LINKS_PER_EMAIL.windowMs);
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 429)) throw error;
    const wait = error.retryAfter ? Math.ceil(error.retryAfter / 60) : 15;
    throw APIError.fromStatus("TOO_MANY_REQUESTS", {
      message: `Too many sign-in links were sent to this email. Use the latest one, or try again in ${wait} ${wait === 1 ? "minute" : "minutes"}.`,
    });
  }
}

function createAuth() {
  const env = getEnv();
  return betterAuth({
    appName: "Solverr",
    baseURL: env.APP_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: prismaAdapter(getDb(), { provider: "postgresql" }),
    session: { expiresIn: SESSION_IDLE_SECONDS, updateAge: SESSION_UPDATE_AGE_SECONDS },
    /** Counted in Postgres (the RateLimit model), so every web instance shares the sign-in limits. */
    rateLimit: { storage: "database" },
    databaseHooks: {
      session: {
        update: {
          /** Caps each extension at SESSION_MAX_AGE_MS after sign-in; with no session in the context the extension is refused (signs out). */
          before: async (update, ctx) => {
            if (!update.expiresAt) return;
            const createdAt = ctx?.context.session?.session.createdAt;
            if (!createdAt) return false;
            const latest = new Date(new Date(createdAt).getTime() + SESSION_MAX_AGE_MS);
            return { data: { ...update, expiresAt: new Date(Math.min(new Date(update.expiresAt).getTime(), latest.getTime())) } };
          },
        },
      },
    },
    plugins: [
      walletAuth(),
      ...(emailEnabled()
        ? [
            magicLink({
              expiresIn: MAGIC_LINK_TTL_SECONDS,
              /** Only a hash is stored, so a database or backup leak cannot be used to sign in. */
              storeToken: "hashed",
              sendMagicLink: async ({ email, url }, ctx) => {
                await limitMagicLinks(email, ctx?.request);
                await sendEmail({ to: email, ...(await magicLinkEmail(url)) });
              },
            }),
          ]
        : []),
      nextCookies(),
    ],
  });
}

let instance: ReturnType<typeof createAuth> | undefined;

/** Better Auth instance, created on first use so builds do not need runtime secrets. */
export function getAuth() {
  instance ??= createAuth();
  return instance;
}
