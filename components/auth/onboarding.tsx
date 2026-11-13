"use client";

import { AnimatePresence, MotionConfig } from "motion/react";
import * as m from "motion/react-m";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode, type SubmitEvent } from "react";
import { SignInStep } from "@/components/auth/sign-in";
import { Logo } from "@/components/brand/logo";
import { LogoPicker } from "@/components/dashboard/settings/logo-picker";
import { PayoutWalletForm, type PayoutChainOption, type SignInWallet } from "@/components/dashboard/settings/payout-wallet-form";
import { SettlementForm } from "@/components/dashboard/settings/settlement-form";
import { callAction, useAction } from "@/components/dashboard/use-action";
import { ActionButton } from "@/components/ui/action-button";
import { ActionError } from "@/components/ui/action-error";
import { BandLayout } from "@/components/ui/band-layout";
import { BandTrack, type TrackStepState } from "@/components/ui/band-track";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { STEP_DROP_MOTION } from "@/components/ui/motion";
import { NetworkSelect } from "@/components/ui/network-select";
import { type ChainInfo, getChain } from "@/lib/chains/registry";
import { createMerchantAction, switchMerchantAction, updateProfileAction, uploadLogoAction } from "@/lib/merchants/actions/account";
import { payoutFormKey } from "@/lib/merchants/payout-wallet";
import type { SettlementOption } from "@/lib/merchants/settlement-options";

type MerchantSummary = {
  /** The business these steps change; every action sends it, so a switch to another business in another tab is refused. */
  id: string;
  name: string;
  website: string | null;
  logoUrl: string | null;
  payout: { chain: string; address: string; verifiedAt: number } | null;
  settlementAsset: string;
  privatePayments: boolean;
} | null;

/** The coins a business can receive on one payout network, and the one tagged "Recommended" (null when the measured data cannot tell). */
export type NetworkCoins = { chain: string; options: SettlementOption[]; recommended: string | null };

const STEPS = [
  { title: "Sign in", description: "Use your wallet or email. Signing a message costs nothing and sends nothing." },
  { title: "Business details", description: "Customers see this name and logo on every payment page." },
  { title: "Where you get paid", description: "Choose the network and the coin you receive, then verify the payout wallet. Solverr never holds your funds." },
];
/** The sign-in step's description when email sign-in is turned off. */
const SIGN_IN_WALLET_ONLY = "Use your wallet. Signing a message costs nothing and sends nothing.";

const BUSINESS_FORM = "onboarding-business";
const SETTLEMENT_FORM = "onboarding-settlement";

/** Each step's state on the band track: the open step is current, earlier steps the business has passed are done. */
function trackSteps(view: number, reached: number) {
  return STEPS.map((step, index) => {
    const number = index + 1;
    const state: TrackStepState = number === view ? "cur" : number < reached ? "done" : "todo";
    return { key: step.title, label: step.title, state };
  });
}

/** The network the payout step opens on: the saved payout wallet's, else one the sign-in wallet works on (the recommended one first), else the recommended one. */
function startNetwork(chains: PayoutChainOption[], payoutChain: string | undefined, signInWallets: SignInWallet[], recommended: string | null) {
  if (payoutChain) return payoutChain;
  const usable = chains.filter((chain) => signInWallets.some((wallet) => wallet.kind === chain.family));
  return usable.find((chain) => chain.id === recommended)?.id ?? usable[0]?.id ?? recommended ?? chains[0]?.id ?? "";
}

/** Sign-in and setup under an accent band with the step track; the open step sits in one card with Back, step dots and Next. */
export function Onboarding({
  signedIn,
  emailEnabled,
  merchant,
  additional,
  selectBusinessId,
  payoutChains,
  signInWallets,
  networkCoins,
  recommendedChain,
  privateUnavailable,
}: {
  signedIn: boolean;
  emailEnabled: boolean;
  merchant: MerchantSummary;
  /** The user already belongs to a business and is creating another one. */
  additional: boolean;
  /** The user's own business shown here when the dashboard has another one selected; it is selected before any step runs. */
  selectBusinessId: string | null;
  payoutChains: PayoutChainOption[];
  signInWallets: SignInWallet[];
  networkCoins: NetworkCoins[];
  /** The payout network tagged "Recommended" from the worker's measured route data; null when the data cannot tell. */
  recommendedChain: string | null;
  /** Why this server cannot serve private payments, or null when it can. */
  privateUnavailable: string | null;
}) {
  const router = useRouter();
  const [name, setName] = useState(merchant?.name ?? "");
  const [website, setWebsite] = useState(merchant?.website ?? "");
  /** A logo picked on the business step; it is uploaded once the business is saved, and its preview stays until the page shows the stored one. */
  const [logo, setLogo] = useState<{ file: File; url: string; uploaded: boolean } | null>(null);
  /** The owner's own pick; until there is one, the network follows the page data, so the recommendation that arrives once the business exists is used. */
  const [pickedNetwork, setPickedNetwork] = useState<string | null>(null);
  const network = pickedNetwork ?? startNetwork(payoutChains, merchant?.payout?.chain, signInWallets, recommendedChain);
  /** A payout wallet is being saved for the network shown; switching network meanwhile would save it for the wrong one. */
  const [walletBusy, setWalletBusy] = useState(false);
  /** A finished step reopened with Back; null shows the furthest step the business has reached. */
  const [revisit, setRevisit] = useState<number | null>(null);
  const business = useAction();
  const settlement = useAction();
  const selecting = selectBusinessId !== null;
  /** Why selecting the user's own business failed; the steps stay locked and a retry is offered. */
  const [selectError, setSelectError] = useState<string | null>(null);
  const networks = useMemo(() => payoutChains.map((chain) => getChain(chain.id)).filter((chain): chain is ChainInfo => chain !== undefined), [payoutChains]);

  const selectBusiness = useCallback(
    (id: string) =>
      callAction(() => switchMerchantAction(id)).then((result) => {
        if (result.ok) router.refresh();
        else setSelectError(result.error);
      }),
    [router],
  );

  useEffect(() => {
    if (selectBusinessId) void selectBusiness(selectBusinessId);
  }, [selectBusinessId, selectBusiness]);

  /** The preview's object URL is released when another logo replaces it or the page closes. */
  const previewUrl = logo?.url;
  useEffect(() => (previewUrl ? () => URL.revokeObjectURL(previewUrl) : undefined), [previewUrl]);

  const reached = !signedIn ? 1 : !merchant ? 2 : 3;
  /** Sign-in cannot be reopened once done; signing out happens from the dashboard account menu. */
  const first = signedIn ? 2 : 1;
  const view = revisit ?? reached;
  const step = STEPS[view - 1];
  const stepDescription = view === 1 && !emailEnabled ? SIGN_IN_WALLET_ONLY : step.description;

  const go = (target: number) => setRevisit(target >= reached ? null : target);

  /** Saves the business, then uploads a picked logo to it; the actions revalidate this page, so a new business shows up from their response. */
  function saveBusiness(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    business.run(
      async () => {
        let merchantId = merchant?.id ?? null;
        if (merchant) {
          const saved = await updateProfileAction(merchant.id, { name, website });
          if (!saved.ok) return saved;
        } else {
          const created = await createMerchantAction({ name, website, additional });
          if (!created.ok) return created;
          merchantId = created.id;
          /** The new business is selected now; leaving `?new=1` makes a retry after a refused logo save it instead of creating another one. */
          if (additional) router.replace("/onboarding");
        }
        if (!logo || logo.uploaded || !merchantId) return { ok: true as const };
        const form = new FormData();
        form.set("logo", logo.file);
        const uploaded = await uploadLogoAction(merchantId, form);
        /** The business is saved either way; a refused logo keeps this step open so another file can be chosen. */
        if (!uploaded.ok) setRevisit(2);
        return uploaded;
      },
      () => {
        setLogo((picked) => picked && { ...picked, uploaded: true });
        if (merchant) go(3);
      },
    );
  }

  const coins = networkCoins.find((entry) => entry.chain === network);
  /** The payout wallet is verified on the network picked here, so the coin can be saved. */
  const payoutHere = merchant?.payout?.chain === network ? merchant.payout : null;

  let body: ReactNode;
  if (view === 1) body = <SignInStep emailEnabled={emailEnabled} />;
  else if (view === 2)
    body = (
      <form id={BUSINESS_FORM} className="flex flex-col gap-4" onSubmit={saveBusiness}>
        <Field label="Business name" htmlFor="name">
          <Input id="name" value={name} onChange={(event) => setName(event.target.value)} required />
        </Field>
        <Field label="Website (optional)" htmlFor="website">
          <Input id="website" type="url" placeholder="https://" value={website} onChange={(event) => setWebsite(event.target.value)} />
        </Field>
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium text-fg">Logo (optional)</p>
          <LogoPicker name={name} logoUrl={logo?.url ?? merchant?.logoUrl ?? null} onPick={(file) => setLogo({ file, url: URL.createObjectURL(file), uploaded: false })} />
        </div>
      </form>
    );
  else if (merchant)
    body = (
      <div className="flex flex-col gap-4">
        <Field label="Network to get paid on" htmlFor="payout-network">
          <NetworkSelect id="payout-network" value={network} onChange={setPickedNetwork} chains={networks} recommended={recommendedChain} disabled={walletBusy} />
        </Field>
        <SettlementForm
          /** Each network has its own coins, so a network change starts the coin choice fresh. */
          key={network}
          merchantId={merchant.id}
          id={SETTLEMENT_FORM}
          options={coins?.options ?? []}
          current={coins?.options.some((option) => option.assetId === merchant.settlementAsset) ? merchant.settlementAsset : (coins?.recommended ?? "")}
          recommended={coins?.recommended ?? null}
          checkPayout={payoutHere ? `${payoutHere.chain}:${payoutHere.address}` : null}
          privatePayments={merchant.privatePayments}
          privateUnavailable={privateUnavailable}
          action={settlement}
          onSaved={() => router.push("/dashboard")}
        />
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium text-fg">Payout wallet</p>
          <PayoutWalletForm
            key={payoutFormKey(merchant.payout)}
            merchantId={merchant.id}
            chains={payoutChains}
            current={merchant.payout}
            signInWallets={signInWallets}
            chain={network}
            onBusyChange={setWalletBusy}
          />
        </div>
      </div>
    );

  const nextLabel = (
    <>
      Next step
      <Icon name="arrowRight" className="size-4" />
    </>
  );
  let next: ReactNode;
  /** Signing in moves on by itself, so Next stays off on the sign-in step. */
  if (view === 1) next = <Button disabled>{nextLabel}</Button>;
  else if (view === 2)
    next = (
      <ActionButton type="submit" form={BUSINESS_FORM} disabled={!name.trim()} pending={business.pending} failed={business.failed}>
        {nextLabel}
      </ActionButton>
    );
  else
    next = (
      <ActionButton type="submit" form={SETTLEMENT_FORM} disabled={!payoutHere || walletBusy || !coins?.options.length} pending={settlement.pending} failed={settlement.failed}>
        Finish setup
        <Icon name="arrowRight" className="size-4" />
      </ActionButton>
    );

  return (
    <MotionConfig reducedMotion="user">
      <BandLayout
        band={
          <div className="flex w-full flex-col items-center gap-3.5">
            <Link href="/" aria-label="Solverr home" className="flex items-center rounded-control pointer-coarse:min-h-11 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink">
              {/** On the accent band the logo's top block turns white so it stays visible. */}
              <Logo className="text-accent-ink! [--logo-top:var(--accent-ink)]" />
            </Link>
            <h1 className="font-heading text-[26px] leading-tight font-semibold tracking-[-0.02em] @xl:text-[32px]">Start accepting crypto</h1>
            <p className="max-w-[460px] text-[14.5px] text-accent-ink">Customers pay with any coin they hold. You receive the coin you choose, in your own wallet.</p>
            <BandTrack steps={trackSteps(view, reached)} current={view - 1} label="Setup progress" compactLabels className="mt-2 max-w-[640px]" />
          </div>
        }
        footer={
          <p className="flex items-start justify-center gap-2 text-sm text-muted">
            <Icon name="shield" className="mt-0.5 size-4 shrink-0" />
            Payments go straight to your own wallet.
          </p>
        }
      >
        {selectError && selectBusinessId ? (
          <div className="mb-4 flex flex-col items-start gap-2">
            <ActionError message={selectError} />
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setSelectError(null);
                void selectBusiness(selectBusinessId);
              }}
            >
              Try again
            </Button>
          </div>
        ) : null}
        {/** Every control waits while the user's own business is being selected, so no step changes another business. */}
        <fieldset disabled={selecting} className="flex min-w-0 flex-col gap-[22px]">
          <div className="relative">
            <AnimatePresence initial={false} mode="popLayout">
              <m.div key={view} {...STEP_DROP_MOTION} className="flex flex-col gap-5">
                <div className="flex flex-col gap-1">
                  <p className="font-heading text-xs font-semibold uppercase tracking-[0.06em] text-muted">Step {view} of {STEPS.length}</p>
                  <h2 className="font-heading text-[22px] font-semibold tracking-[-0.015em]">{step.title}</h2>
                  <p className="text-sm text-muted">{stepDescription}</p>
                </div>
                {body}
                {/** The Next button that saves sits in the dock, so the reason shows here in red. */}
                <ActionError message={business.error} tone="danger" />
              </m.div>
            </AnimatePresence>
          </div>
          {/** The dock closes the card; on phones it stays at the bottom of the screen while a long step scrolls. */}
          <div className="sticky bottom-3 z-10 flex items-center justify-between gap-3.5 rounded-2xl bg-surface-2 p-1.5 @xl:static">
            <Button variant="secondary" className="aspect-square px-0" aria-label="Back" disabled={view === first} onClick={() => go(view - 1)}>
              <Icon name="arrowLeft" className="size-4" />
            </Button>
            <span className="flex items-center gap-1.5" aria-hidden="true">
              {STEPS.map((item, index) => {
                const number = index + 1;
                const tone = number === view ? "w-[22px] bg-accent" : number < reached ? "w-1.5 bg-accent/45" : "w-1.5 bg-line";
                return <span key={item.title} className={`h-1.5 rounded-full transition-[width,background-color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${tone}`} />;
              })}
            </span>
            {next}
          </div>
        </fieldset>
      </BandLayout>
    </MotionConfig>
  );
}
