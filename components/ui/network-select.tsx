"use client";

import { ChainBadge } from "@/components/ui/chain-badge";
import { Icon } from "@/components/ui/icon";
import { RECOMMENDED, SearchSelect } from "@/components/ui/search-select";
import type { ChainInfo } from "@/lib/chains/registry";

function AllNetworksBadge() {
  return (
    /** Tinted from the text color, so it reads on the light field and in the inverted menu alike. */
    <span aria-hidden="true" className="grid size-[22px] shrink-0 place-items-center rounded-full bg-current/15">
      <Icon name="chain" className="size-3.5" />
    </span>
  );
}

/** Network picker in the inverted dropdown style with each network's logo; `valueFor` picks a network's value (1Click code by default),
    `allLabel` adds an "all networks" option first, and `recommended` (a 1Click code) tags that network "Recommended". */
export function NetworkSelect({
  id,
  value,
  onChange,
  chains,
  valueFor = (chain) => chain.id,
  allLabel,
  recommended,
  label,
  size = "md",
  disabled = false,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  chains: readonly ChainInfo[];
  valueFor?: (chain: ChainInfo) => string;
  allLabel?: string;
  recommended?: string | null;
  /** Accessible name when no visible label points at the field. */
  label?: string;
  size?: "md" | "sm";
}) {
  const options = [
    ...(allLabel ? [{ value: "", label: allLabel, icon: <AllNetworksBadge /> }] : []),
    ...chains.map((chain) => ({
      value: valueFor(chain),
      label: chain.name,
      icon: <ChainBadge chain={chain} />,
      tag: chain.id === recommended ? RECOMMENDED : undefined,
    })),
  ];
  return <SearchSelect id={id} value={value} options={options} onChange={onChange} label={label} size={size} disabled={disabled} />;
}
