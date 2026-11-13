import type { CSSProperties, ReactNode } from "react";
import { BandLayout } from "@/components/ui/band-layout";
import { MerchantMark } from "@/components/ui/merchant-mark";

/** Rise-in delay for the band's content after the merchant card. */
const rise = (index: number): CSSProperties => ({ animationDelay: `${100 + index * 80}ms` });

/** Payment page: the band shows the merchant (the page's h1), the amount and `status`; the card holds the payment steps and can widen on large screens. */
export function CheckoutLayout({
  merchant,
  logoUrl,
  amount,
  badge,
  status,
  footer,
  children,
}: {
  merchant: string;
  logoUrl: string | null;
  amount: { label: string; value: string; currency: string };
  /** Shown beside the merchant's name, for example the Demo tag in test mode. */
  badge?: ReactNode;
  status: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}) {
  return (
    <BandLayout
      wide
      footer={footer}
      band={
        <>
          {/** Two-tone card: merchant on a glass half that darkens the band so the white name keeps 4.5:1 (WCAG AA), amount on a surface half. */}
          <div className="grid w-full max-w-[560px] animate-card-grow grid-cols-[minmax(0,1fr)_auto] overflow-hidden rounded-[20px] text-left shadow-[0_20px_40px_-22px_rgb(0_0_0/0.45)]">
            <div className="flex min-w-0 items-center gap-2.5 bg-black/12 p-3.5 @xl:gap-3.5 @xl:px-5 @xl:py-[18px]">
              <MerchantMark name={merchant} logoUrl={logoUrl} variant="band" />
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <h1 className="min-w-0 font-heading text-[14.5px] leading-tight font-semibold tracking-[-0.01em] [overflow-wrap:anywhere] @xl:text-[17px]">{merchant}</h1>
                {badge}
              </div>
            </div>
            <div className="flex animate-panel-in flex-col items-end justify-center gap-1.5 bg-surface px-3.5 py-3 text-fg @xl:px-[22px] @xl:py-4">
              <span className="text-xs text-muted @xl:text-[12.5px]">{amount.label}</span>
              <p className="font-heading text-2xl leading-none font-semibold tracking-[-0.03em] whitespace-nowrap tabular-nums @xl:text-[34px]">
                {amount.value}
                <span className="ml-1 text-[0.5em] font-medium @xl:text-[0.42em] tracking-normal opacity-75">{amount.currency}</span>
              </p>
            </div>
          </div>
          <div className="mt-[22px] flex w-full animate-rise-in justify-center @xl:mt-7" style={rise(3)}>
            {status}
          </div>
        </>
      }
    >
      {children}
    </BandLayout>
  );
}
