import type { Metadata } from "next";
import { Onboarding } from "@/components/auth/onboarding";
import { getSessionUser, ownedMembership, selectedMembership } from "@/lib/auth/session";
import { emailEnabled } from "@/lib/email/send";
import { logoUrl } from "@/lib/merchants/logo";
import { payoutChainOptions, verifiedPayout } from "@/lib/merchants/payout-wallet";
import { payoutReadySignInWallets } from "@/lib/merchants/settings-data";
import { settlementOptions } from "@/lib/merchants/settlement-options";
import { recommendedCoin, recommendedNetwork } from "@/lib/merchants/settlement-recommendation";
import { pageMetadata } from "@/lib/metadata";
import { privatePaymentsUnavailable } from "@/lib/oneclick/confidentiality";
import { displayTokens } from "@/lib/oneclick/tokens";

/** Shared links keep their preview card, but search results show the landing page instead of the sign-in step. */
export const metadata: Metadata = {
  ...pageMetadata("Get started · Solverr", "Sign in, add your business, and choose the network, coin and wallet you get paid in to start accepting crypto payments."),
  robots: { index: false },
};

/** Sign-in and business setup in one flow; a visitor who is not signed in starts at the sign-in step. */
export default async function OnboardingPage({ searchParams }: PageProps<"/onboarding">) {
  const user = await getSessionUser();
  const additional = Boolean(user) && (await searchParams).new === "1";
  /** Setup continues only a business the user owns; one they were added to as a teammate is not theirs to set up. */
  const owned = !user || additional ? null : await ownedMembership(user.id);
  const merchant = owned?.merchant ?? null;
  /** The setup steps change the selected business, so when the switcher has another one selected, the page selects this one first. */
  const selected = owned && user ? await selectedMembership(user.id) : null;
  const selectBusinessId = owned && selected?.merchantId !== owned.merchantId ? owned.merchantId : null;
  const payoutChains = payoutChainOptions();
  /** The payout step lists the coins of whichever network the owner picks, so every payout network's coins come along once a business exists. */
  const networkCoins = merchant
    ? await Promise.all(
        payoutChains.map(async (chain) => {
          const options = await settlementOptions(chain.id, displayTokens);
          return { chain: chain.id, options, recommended: await recommendedCoin(options) };
        }),
      )
    : [];
  const [signInWallets, recommendedChain] = await Promise.all([
    user ? payoutReadySignInWallets(user.id) : [],
    merchant ? recommendedNetwork(payoutChains.map((chain) => chain.id), displayTokens) : null,
  ]);

  return (
    <Onboarding
      /** Signing in returns to this same page; the key gives the signed-in setup fresh form state. */
      key={user ? "signed-in" : "signed-out"}
      signedIn={Boolean(user)}
      emailEnabled={emailEnabled()}
      merchant={
        merchant
          ? {
              id: merchant.id,
              name: merchant.name,
              website: merchant.website,
              logoUrl: logoUrl(merchant.logoId),
              payout: verifiedPayout(merchant),
              settlementAsset: merchant.settlementAsset,
              privatePayments: merchant.privatePayments,
            }
          : null
      }
      additional={additional}
      selectBusinessId={selectBusinessId}
      payoutChains={payoutChains}
      signInWallets={signInWallets}
      networkCoins={networkCoins}
      recommendedChain={recommendedChain}
      privateUnavailable={privatePaymentsUnavailable()}
    />
  );
}
