import Image from "next/image";
import { initials } from "@/lib/format";

/** Sizes per place a business shows: `tile` for the logo on a white rounded tile, `circle` for initials without a logo.
    Sizes follow the container, so the embedded checkout gets the phone sizes. */
const VARIANTS = {
  band: {
    tile: "size-11 rounded-xl p-1.5 @xl:size-[52px] @xl:rounded-[14px] @xl:p-[7px]",
    circle: "size-10 bg-accent-ink font-heading text-[15px] font-bold text-accent @xl:size-12 @xl:text-base",
    pixels: 52,
  },
  hero: {
    tile: "size-12 rounded-[13px] p-1.5 @xl:size-[52px] @xl:rounded-[14px] @xl:p-[7px]",
    circle: "size-12 bg-accent-ink font-heading text-base font-bold text-accent @xl:size-[52px] @xl:text-[17px]",
    pixels: 52,
  },
  account: { tile: "size-9 rounded-[10px] border border-line p-1", circle: "size-9 bg-accent/15 text-sm font-semibold text-accent-tint-text", pixels: 36 },
  option: { tile: "size-7 rounded-lg border border-line p-0.5", circle: "size-7 bg-accent/15 text-[11px] font-semibold text-accent-tint-text", pixels: 28 },
} as const;

/** A business's logo, or its initials when it has none; decorative, since the name always shows beside it. */
export function MerchantMark({ name, logoUrl, variant }: { name: string; logoUrl: string | null; variant: keyof typeof VARIANTS }) {
  const style = VARIANTS[variant];
  if (!logoUrl) {
    return (
      <span aria-hidden="true" className={`grid shrink-0 place-items-center rounded-full ${style.circle}`}>
        {initials(name)}
      </span>
    );
  }
  return (
    <span aria-hidden="true" className={`grid shrink-0 place-items-center overflow-hidden bg-white ${style.tile}`}>
      {/** Stored logos are already small WebP files, so Next.js serves them as they are. */}
      <Image src={logoUrl} alt="" width={style.pixels} height={style.pixels} unoptimized className="size-full object-contain" />
    </span>
  );
}
