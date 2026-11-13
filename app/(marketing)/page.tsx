import type { Metadata } from "next";
import { ChainMarquee } from "@/components/marketing/chain-marquee";
import { ComparisonLists } from "@/components/marketing/comparison";
import { CountUp } from "@/components/marketing/count-up";
import { FaqList } from "@/components/marketing/faq-list";
import { Glow } from "@/components/marketing/glow";
import { Hero } from "@/components/marketing/hero";
import { LandingMotion } from "@/components/marketing/landing-motion";
import { Reveal } from "@/components/marketing/reveal";
import { ScrollCard } from "@/components/marketing/scroll-card";
import { ScrollText } from "@/components/marketing/scroll-text";
import { Accent, SectionHeading } from "@/components/marketing/section-heading";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { SpotlightCard } from "@/components/marketing/spotlight-card";
import { StepsTrack } from "@/components/marketing/steps-track";
import { JsonLd } from "@/components/seo/json-ld";
import type { NumberFormat } from "@/components/ui/animated-number";
import { ButtonLink } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import { CHAINS, getChain } from "@/lib/chains/registry";
import { getEnv } from "@/lib/env";
import { pageMetadata } from "@/lib/metadata";
import { faqPage, jsonLdGraph, organization, softwareApplication, webSite } from "@/lib/structured-data";

const DESCRIPTION =
  "Customers and AI agents pay with the coin they hold. You receive the coin you choose in your own wallet. 0% gateway fee. Built on NEAR Intents.";

export const metadata: Metadata = pageMetadata("Solverr · Get paid by humans and AI agents, in any coin", DESCRIPTION, "/");

const HERO_CHAIN_IDS = ["btc", "eth", "sol", "near", "tron"];

/** Each number rolls from `from` to its real value when it scrolls into view. */
const STATS: readonly { from: number; to: number; format?: NumberFormat; prefix?: string; suffix?: string; label: string; chips: readonly string[] }[] = [
  { from: 100, to: 0, format: "percent", label: "Solverr gateway fee", chips: ["About 0.2% NEAR Intents fee per swap", "0.01% between stablecoins"] },
  { from: 0, to: CHAINS.length, label: "Chains customers pay from", chips: ["BTC, ETH, SOL and more", "USDT and USDC"] },
  { from: 30, to: 5, prefix: "< ", suffix: " min", label: "Usual payment time", chips: ["Most payments finish within a few minutes"] },
];

const FEATURES = [
  {
    title: "Checkout that prevents mistakes",
    text: "A network check before sending, exact amounts, memo warnings, refund-address checks, and automatic refunds when a customer sends the wrong amount.",
    glows: ["-left-44 -top-44"],
  },
  {
    title: "Payments for AI agents",
    text: "Your API answers 402 Payment Required. The agent pays from its NEAR or Base wallet within its spending limits and gets access, or spends prepaid credits per call.",
    glows: ["-right-44 -top-44"],
  },
  {
    title: "One line to integrate",
    text: "Payment links, a script tag, a React button, Node, PHP and Python SDKs, WooCommerce, or an MCP server for your AI code editor.",
    glows: ["-bottom-44 -left-44", "-right-44 -top-44"],
  },
] as const;

const COMPARISON = [
  ["The gateway holds your money", "Money goes straight to your own wallet"],
  ["A fixed list of coins", `Coins on ${CHAINS.length} chains`],
  ["No payments from AI agents", "AI agents pay with 402, credits and MCP"],
  ["A fee on every transaction", "0% gateway fee"],
  ["Proof is the gateway's word", "Public receipt with both transactions"],
] as const;

const STEPS: readonly { icon: IconName; title: string; text: string }[] = [
  { icon: "coins", title: "Customer picks a coin", text: "Any coin on any supported chain. With a connected wallet, the checkout suggests their cheapest coin." },
  { icon: "split", title: "NEAR Intents converts it", text: "A one-time payment address receives the payment, and the swap runs automatically." },
  { icon: "wallet", title: "You get paid", text: "Your coin lands in your own wallet. A signed webhook marks the order paid." },
];

const FAQ = [
  ["What does Solverr cost?", "Solverr charges no fee. NEAR Intents, the network that converts each payment, charges about 0.2% per swap, or 0.01% between stablecoins; a Solverr server without a NEAR Intents partner key adds 0.25%. Your customer pays it on top of your price, so you receive the full amount."],
  ["Which coins can customers use?", `Coins on ${CHAINS.length} chains, including BTC, ETH, SOL, USDT and USDC. NEAR Intents sets a temporary minimum on some routes, and the checkout shows each coin's minimum before the customer pays.`],
  ["What if a customer sends the wrong amount?", "Too little is refunded automatically to the customer's refund address, minus a small network fee. Extra is refunded too, and the order still completes."],
  ["Does Solverr hold your money?", "No. Payments go from the customer through NEAR Intents straight to your wallet, which you verify you own by signing a message."],
  ["How long does a payment take?", "Most payments finish within a few minutes; how long depends on the networks involved. The checkout and your webhooks update by themselves."],
] as const;

const SECTION = "px-4 py-16 sm:px-8 sm:py-28";
const PANEL = "relative overflow-hidden rounded-[24px] border border-line bg-surface";

export default function LandingPage() {
  const heroChains = HERO_CHAIN_IDS.flatMap((id) => {
    const chain = getChain(id);
    return chain ? [{ id: chain.id, name: chain.name, color: chain.color }] : [];
  });
  const appUrl = getEnv().APP_URL;
  return (
    <LandingMotion>
      <JsonLd data={jsonLdGraph([organization(appUrl), webSite(appUrl, DESCRIPTION), softwareApplication(appUrl, DESCRIPTION), faqPage(FAQ)])} />
      <SiteHeader />
      <main className="overflow-x-clip">
        <Hero chains={heroChains} chainCount={CHAINS.length} />

        <Reveal className="px-4 pb-8 pt-10 sm:px-8">
          <p className="mb-6 text-center text-sm text-muted">Customers pay from {CHAINS.length} chains</p>
          <div className="mx-auto max-w-[1200px]">
            <ChainMarquee />
          </div>
        </Reveal>

        <section className={SECTION}>
          <div className="mx-auto flex max-w-[860px] flex-col items-center gap-9 text-center">
            <ScrollText
              className="font-heading text-[26px] font-medium leading-snug tracking-[-0.02em] sm:text-[38px]"
              text="Solverr is a crypto checkout that never holds your money. Customers pay with the coin they hold, NEAR Intents converts it, and the coin you choose lands in your own wallet."
            />
            <Reveal>
              <ButtonLink href="/signup" variant="primary" size="md" className="group">
                Start accepting payments
                <Icon name="arrowRight" className="size-4 transition-transform duration-300 group-hover:translate-x-1" />
              </ButtonLink>
            </Reveal>
          </div>
        </section>

        <section className={SECTION}>
          <SectionHeading label="Numbers" title={<>Solverr in <Accent>numbers.</Accent></>} description={`No gateway fee, coins on ${CHAINS.length} chains, and most payments finish within a few minutes.`} />
          <div className="mx-auto mt-14 grid max-w-[1100px] gap-4 md:grid-cols-3">
            {STATS.map((stat) => (
              <ScrollCard key={stat.label} className={`${PANEL} flex flex-col items-center px-6 pb-6 pt-10 text-center sm:pb-7 sm:pt-12`}>
                <Glow className="left-1/2 top-0 size-[260px] -translate-x-1/2 -translate-y-3/4 animate-glow-breathe opacity-50" />
                <CountUp from={stat.from} to={stat.to} format={stat.format} prefix={stat.prefix} suffix={stat.suffix} className="relative font-heading text-6xl font-medium tracking-[-0.04em]" />
                <p className="relative mt-2 text-muted">{stat.label}</p>
                <div className="relative mt-6 flex flex-wrap justify-center gap-2 sm:mt-8">
                  {stat.chips.map((chip) => (
                    <span key={chip} className="rounded-[8px] bg-surface-2 px-2.5 py-1 text-xs font-medium">
                      {chip}
                    </span>
                  ))}
                </div>
              </ScrollCard>
            ))}
          </div>
        </section>

        <section id="features" className={SECTION}>
          <SectionHeading label="Features" title={<>What you get with <Accent>Solverr.</Accent></>} description="A checkout for customers, payments for AI agents, and tools for developers." />
          <div className="mx-auto mt-14 grid max-w-[900px] gap-4 md:grid-cols-2">
            {FEATURES.map((feature, index) => (
              <ScrollCard key={feature.title} className={index === FEATURES.length - 1 ? "md:col-span-2" : ""}>
                <SpotlightCard className={`${PANEL} h-full px-6 py-10 text-center sm:px-10 sm:py-12`}>
                  {feature.glows.map((position) => (
                    <Glow key={position} className={`size-[320px] animate-glow-breathe opacity-70 ${position}`} />
                  ))}
                  <h3 className="relative text-balance text-[28px] font-medium tracking-[-0.03em] sm:text-4xl">{feature.title}</h3>
                  <p className="relative mx-auto mt-4 max-w-md text-muted">{feature.text}</p>
                </SpotlightCard>
              </ScrollCard>
            ))}
          </div>
        </section>

        <section className={SECTION}>
          <SectionHeading label="Comparison" title={<>Why get paid <Accent>through Solverr?</Accent></>} />
          <ComparisonLists rows={COMPARISON} />
        </section>

        <section id="how" className={SECTION}>
          <SectionHeading label="How it works" title={<>Get paid in <Accent>three</Accent> steps.</>} description="No custody and no swaps to run yourself. The customer pays, the network converts, and you get paid." />
          <StepsTrack steps={STEPS} />
        </section>

        <section className={SECTION}>
          <SectionHeading label="FAQ" title={<>Questions businesses <Accent>ask.</Accent></>} />
          <FaqList items={FAQ} />
        </section>

        <section className="relative px-4 pb-24 pt-8 sm:px-8 sm:pb-36 sm:pt-12">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
            <Glow wide className="left-1/2 top-[40%] size-[min(680px,130vw)] -translate-x-1/2 -translate-y-1/2 animate-glow-breathe opacity-20" />
          </div>
          <Reveal className="relative mx-auto flex max-w-[820px] flex-col items-center rounded-[24px] border border-line bg-surface/90 px-6 py-14 text-center backdrop-blur-sm sm:px-12 sm:py-16">
            <h2 className="text-balance text-[38px] font-medium leading-[1.12] tracking-[-0.04em] sm:text-6xl sm:leading-[1.2]">
              Ready to get paid in <Accent sheen>any coin?</Accent>
            </h2>
            <p className="mt-4 max-w-lg text-lg text-muted">Sign in, verify your payout wallet, and share a payment link or paste one line of code.</p>
            <ButtonLink href="/signup" variant="primary" size="md" className="mt-8">
              Start accepting payments
            </ButtonLink>
          </Reveal>
        </section>
      </main>
      <SiteFooter />
    </LandingMotion>
  );
}
