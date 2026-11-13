import type { Metadata } from "next";
import Script from "next/script";
import { Accent, SectionHeading } from "@/components/marketing/section-heading";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { SpotlightCard } from "@/components/marketing/spotlight-card";
import { buttonClass } from "@/components/ui/button";
import { DEMO_PRODUCTS } from "@/lib/merchants/demo-store";
import { pageMetadata } from "@/lib/metadata";

export const metadata: Metadata = pageMetadata(
  "Demo store · Solverr",
  "Try the Solverr crypto checkout in a pretend coffee shop. Payments run in test mode with a Simulate panel, so no real money moves.",
  "/demo",
);

/** Brand-color tiles standing in for product photos, one per product in order. */
const PRODUCT_TILES = ["from-accent to-(--chart-3)", "from-(--chart-3) to-logo-bottom", "from-logo-top to-logo-bottom"] as const;

/** Prerendered: the worker creates the demo store and its payment links (`ensureDemoStore`), so the page itself never reads the database. */
export default function DemoPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-[1000px] px-4 pb-16 pt-28 sm:px-8 sm:pt-32">
        <SectionHeading as="h1" label="Demo store" labelTone="warn" title={<>Northwind <Accent>Coffee</Accent></>} description="A pretend coffee shop using the Solverr pay button. Pick a product to open the checkout." />
        <div className="mt-10 grid gap-3 sm:mt-12 md:grid-cols-3 md:gap-4">
          {DEMO_PRODUCTS.map((product, index) => (
            <SpotlightCard key={product.linkId} className="relative flex flex-col overflow-hidden rounded-[24px] border border-line bg-surface p-4 md:p-5">
              {/** Phones show each product as a row (small tile beside the text) so all three fit on one screen; wide screens stack a large tile on top. */}
              <div className="relative grid flex-1 grid-cols-[88px_minmax(0,1fr)] items-center gap-x-4 gap-y-4 md:flex md:flex-col md:items-stretch md:gap-3">
                <div className={`grid aspect-square place-items-center rounded-[16px] bg-linear-135 md:aspect-[4/3] ${PRODUCT_TILES[index % PRODUCT_TILES.length]}`} aria-hidden="true">
                  <span className="font-heading text-4xl font-semibold tracking-[-0.04em] text-accent-ink md:text-6xl">{product.title.charAt(0)}</span>
                </div>
                <div className="flex min-w-0 flex-col gap-1 md:contents">
                  <h2 className="text-lg font-semibold">{product.title}</h2>
                  <p className="text-sm text-muted">{product.note}</p>
                  <p className="font-heading text-2xl font-semibold tracking-tight tabular-nums">{product.amount ? `$${product.amount}` : "Your choice"}</p>
                </div>
                <button type="button" data-solverr-link={product.linkId} className={buttonClass("primary", "md", "col-span-2 mt-auto w-full")}>
                  Pay with crypto
                </button>
              </div>
            </SpotlightCard>
          ))}
        </div>
      </main>
      <SiteFooter />
      <Script src="/embed.js" strategy="afterInteractive" />
    </>
  );
}
