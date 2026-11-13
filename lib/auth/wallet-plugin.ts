import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint, getSessionFromCtx } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { assertRecentSignIn } from "@/lib/auth/recent-sign-in";
import { placeholderEmail } from "@/lib/auth/wallet-email";
import { isValidAddress } from "@/lib/chains/addresses";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/ids";
import { alertSignInWalletLinked } from "@/lib/merchants/alerts";
import { consumeChallenge, createChallenge } from "@/lib/wallets/challenge";
import { shortAddress } from "@/lib/wallets/short-address";
import { verifyWalletProof } from "@/lib/wallets/verify";

const challengeBody = z.strictObject({
  kind: z.enum(["evm", "solana", "near"]),
  address: z.string().trim().min(1).max(200),
  chain_id: z.number().int().positive().optional(),
});

const verifyBody = z.strictObject({
  nonce: z.string().min(8).max(100),
  signature: z.string().min(1).max(1000),
  public_key: z.string().max(200).optional(),
});

/** Wallet sign-in (EVM, Solana, NEAR): `/wallet/challenge` returns a message to sign, `/wallet/verify` checks it and starts a session;
    a signed-in user links the wallet instead. */
export const walletAuth = () =>
  ({
    id: "wallet-auth",
    rateLimit: [{ pathMatcher: (path) => path.startsWith("/wallet/"), window: 60, max: 10 }],
    endpoints: {
      walletChallenge: createAuthEndpoint("/wallet/challenge", { method: "POST", body: challengeBody }, async (ctx) => {
        const { kind, address, chain_id } = ctx.body;
        if (!isValidAddress(kind, address)) {
          throw APIError.fromStatus("BAD_REQUEST", { message: "This wallet address is not valid." });
        }
        const challenge = await createChallenge({ kind, address, chainId: chain_id, purpose: "sign_in" });
        return ctx.json({ nonce: challenge.nonce, message: challenge.message, near: challenge.near ?? null });
      }),

      walletVerify: createAuthEndpoint("/wallet/verify", { method: "POST", body: verifyBody, requireRequest: true }, async (ctx) => {
        const challenge = await consumeChallenge(ctx.body.nonce);
        if (!challenge || challenge.purpose !== "sign_in") {
          throw APIError.fromStatus("UNAUTHORIZED", { message: "This sign-in request expired. Try again." });
        }
        const method = await verifyWalletProof(challenge, { signature: ctx.body.signature, publicKey: ctx.body.public_key });
        if (!method) throw APIError.fromStatus("UNAUTHORIZED", { message: "The wallet signature could not be verified." });
        const smartWallet = method === "contract";
        const proven = { smartWallet, chainId: smartWallet ? (challenge.chainId ?? null) : null };

        const db = getDb();
        const findIdentity = async () => {
          const found = await db.walletIdentity.findUnique({ where: { kind_address: { kind: challenge.kind, address: challenge.address } } });
          /** A smart wallet's contract proves the address only on its own chain; the same address elsewhere can belong to someone else. */
          if (found && smartWallet && !(found.smartWallet && found.chainId === proven.chainId)) {
            throw APIError.fromStatus("UNAUTHORIZED", { message: "Sign in on the network you first used with this wallet." });
          }
          return found;
        };
        const identity = await findIdentity();
        const current = await getSessionFromCtx(ctx);

        if (current) {
          if (identity && identity.userId !== current.user.id) {
            throw APIError.fromStatus("CONFLICT", { message: "This wallet is already linked to another account." });
          }
          if (!identity) {
            /** A linked wallet signs in for good, so a stolen or forgotten session alone must not add one. */
            try {
              assertRecentSignIn({ signedInAt: new Date(current.session.createdAt) }, "link the wallet");
            } catch (error) {
              throw APIError.fromStatus("FORBIDDEN", { message: (error as Error).message });
            }
            await db.walletIdentity.create({ data: { id: newId("wid"), userId: current.user.id, kind: challenge.kind, address: challenge.address, ...proven } });
            await alertSignInWalletLinked(current.user.id, challenge.address);
          }
          return ctx.json({ success: true, linked: true });
        }

        let user = identity ? await ctx.context.internalAdapter.findUserById(identity.userId) : null;
        if (!user) {
          try {
            user = await ctx.context.internalAdapter.createUser(
              { name: shortAddress(challenge.address), email: placeholderEmail(challenge.kind, challenge.address), image: null },
              { method: "wallet" },
            );
            await db.walletIdentity.create({ data: { id: newId("wid"), userId: user.id, kind: challenge.kind, address: challenge.address, ...proven } });
          } catch (error) {
            if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
            /** A concurrent first sign-in created the account, or an earlier one stopped before saving its wallet. An account with this
                wallet's placeholder email and no wallet at all can only be that one, so the wallet joins it; one with other wallets is refused. */
            const orphan = (await findIdentity())
              ? null
              : await db.user.findFirst({ where: { email: placeholderEmail(challenge.kind, challenge.address), walletIdentities: { none: {} } }, select: { id: true } });
            if (orphan) {
              await db.walletIdentity.create({ data: { id: newId("wid"), userId: orphan.id, kind: challenge.kind, address: challenge.address, ...proven } }).catch((attach: unknown) => {
                if (!(attach instanceof Prisma.PrismaClientKnownRequestError && attach.code === "P2002")) throw attach;
              });
            }
            const existing = await findIdentity();
            user = existing ? await ctx.context.internalAdapter.findUserById(existing.userId) : null;
            if (!user) throw APIError.fromStatus("CONFLICT", { message: "This wallet is already signing in. Try again in a moment." });
          }
        }

        const session = await ctx.context.internalAdapter.createSession(user.id);
        await setSessionCookie(ctx, { session, user });
        return ctx.json({ success: true, linked: false });
      }),
    },
  }) satisfies BetterAuthPlugin;
