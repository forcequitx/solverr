import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { Merchant, Mode, TeamMember, TeamRole } from "@/generated/prisma/client";
import { ApiError } from "@/lib/api/errors";
import { getAuth, sessionExtensionDue } from "@/lib/auth/server";
import { getDb } from "@/lib/db";

/** Business picked in the dashboard switcher; honored only while the user is a member of it. */
export const MERCHANT_COOKIE = "solverr_merchant";

/** `signedInAt` is when this session began, which a sliding session's expiry does not show. */
type SessionUser = { id: string; name: string; email: string; signedInAt: Date };

/** The signed-in user; read once per request, since the layout and the page both ask. An email sign-up has no name, so its email stands in. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  /** Reading the request first lets `next build` skip per-request pages before the auth settings are needed. */
  const requestHeaders = await headers();
  const auth = getAuth();
  let session = await auth.api.getSession({ headers: requestHeaders, query: { disableRefresh: true } });
  /** Read again with refresh only when it extends the session and a Server Action can set cookies; a page render cannot, and
      extending only the database row would leave the cookie to expire first. */
  const canSetCookies = requestHeaders.has("next-action");
  if (session && canSetCookies && sessionExtensionDue(session.session)) session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) return null;
  const { user } = session;
  return { id: user.id, name: user.name || user.email, email: user.email, signedInAt: new Date(session.session.createdAt) };
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/signin");
  return user;
}

/** The dashboard works on live data only; test mode exists for the public demo store, which has no dashboard. */
type MerchantContext = { user: SessionUser; merchant: Merchant; role: TeamRole; mode: Extract<Mode, "live"> };

type Membership = TeamMember & { merchant: Merchant };

/** Every business the user belongs to, in the order they joined; loaded once per request. */
export const getMemberships = cache(
  (userId: string): Promise<Membership[]> => getDb().teamMember.findMany({ where: { userId }, include: { merchant: true }, orderBy: { createdAt: "asc" } }),
);

/** The business picked in the switcher, else the first the user owns, else the first joined; owning first means a team someone
    else added them to never opens ahead of their own. */
export async function selectedMembership(userId: string): Promise<Membership | null> {
  const memberships = await getMemberships(userId);
  const picked = (await cookies()).get(MERCHANT_COOKIE)?.value;
  return (
    memberships.find((membership) => membership.merchantId === picked) ??
    memberships.find((membership) => membership.role === "owner") ??
    memberships[0] ??
    null
  );
}

/** The business the user owns that business setup works on: the picked one when they own it, else the first they own. */
export async function ownedMembership(userId: string): Promise<Membership | null> {
  const selected = await selectedMembership(userId);
  if (selected?.role === "owner") return selected;
  return (await getMemberships(userId)).find((membership) => membership.role === "owner") ?? null;
}

/** Where a signed-in user lands: the dashboard once their business finished setup (teammates always), otherwise setup. */
export async function homePath(userId: string): Promise<"/dashboard" | "/onboarding"> {
  const membership = await selectedMembership(userId);
  return membership && (membership.merchant.setupCompletedAt || membership.role !== "owner") ? "/dashboard" : "/onboarding";
}

/** Signed-in user and their selected merchant; redirects when either is missing. */
export async function requireMerchant(): Promise<MerchantContext> {
  const user = await requireUser();
  const membership = await selectedMembership(user.id);
  if (!membership) redirect("/onboarding");
  return { user, merchant: membership.merchant, role: membership.role, mode: "live" };
}

/** Refusal for a request from a dashboard tab that still shows the business selected before a switch in another tab. */
export const OTHER_BUSINESS_MESSAGE = "This tab shows another business. Reload the page to continue.";

/** The selected merchant, refused with 409 unless it is `shownId`, the business the requesting page was rendered for. */
export async function requireShownMerchant(shownId: string): Promise<MerchantContext> {
  const context = await requireMerchant();
  if (context.merchant.id !== shownId) throw new ApiError(409, "invalid_state", OTHER_BUSINESS_MESSAGE);
  return context;
}

/** Viewers can read everything but change nothing. */
export function assertCanEdit(context: MerchantContext): void {
  if (context.role === "viewer") throw new ApiError(403, "invalid_request", "Your role can view this business but not change it. Ask the owner for a different role.");
}
