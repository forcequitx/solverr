"use client";

/** Motion's lightweight `m` elements (see MotionProvider), named `motion` here because `m` holds this file's text. */
import * as motion from "motion/react-m";
import { type ReactNode, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChainBadge } from "@/components/ui/chain-badge";
import { CoinIcon } from "@/components/ui/coin-icon";
import { FOCUS_RING } from "@/components/ui/focus-ring";
import { Icon } from "@/components/ui/icon";
import { prefersReducedMotion } from "@/components/ui/motion";
import { CHAINS } from "@/lib/chains/registry";
import { coinAmount } from "@/lib/format";
import { format } from "@/lib/i18n/interpolate";
import { en } from "@/lib/i18n/messages/en";
import { formatMinimumUsd } from "@/lib/money";
import type { CheckoutCoin } from "@/lib/payments/coins";

const EASE = [0.2, 0.9, 0.25, 1] as const;
const MOVE = { duration: 0.4, ease: EASE };
const STAGGER_S = 0.016;
const MAX_STAGGERED = 14;

const approxAmount = (usd: number, coin: CheckoutCoin) => `≈ ${coinAmount(usd, coin)} ${coin.symbol}`;

const scrollBehavior = (): ScrollBehavior => (prefersReducedMotion() ? "auto" : "smooth");

/** The label with the first match of `query` emphasized. */
function highlight(label: string, query: string): ReactNode {
  const at = query ? label.toLowerCase().indexOf(query) : -1;
  if (at < 0) return label;
  return (
    <>
      {label.slice(0, at)}
      <mark className="bg-transparent font-bold text-accent-text">{label.slice(at, at + query.length)}</mark>
      {label.slice(at + query.length)}
    </>
  );
}

/** Tiles shrink and spring back in a wave that starts at the tapped tile. */
function ripple(origin: HTMLElement, tiles: Iterable<HTMLElement>) {
  if (prefersReducedMotion()) return;
  for (const tile of tiles) {
    const distance = Math.hypot((tile.offsetLeft - origin.offsetLeft) / origin.offsetWidth, (tile.offsetTop - origin.offsetTop) / origin.offsetHeight);
    tile.firstElementChild?.animate([{ transform: "scale(1)" }, { transform: "scale(0.9)" }, { transform: "scale(1)" }], {
      duration: 420,
      delay: distance * 55,
      easing: "cubic-bezier(0.3, 1.4, 0.5, 1)",
    });
  }
}

/** Network tiles with the tapped network's coins in a panel under its row; search matches network names or their coins. `onPreview`
    follows the coin chosen before Continue; coin amounts are left out when `amountUsd` is unknown. */
export function CoinPicker({
  coins,
  amountUsd,
  onSelect,
  onPreview,
}: {
  coins: CheckoutCoin[];
  amountUsd: number | null;
  onSelect: (coin: CheckoutCoin) => void;
  onPreview: (coin: CheckoutCoin | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [network, setNetwork] = useState<string | null>(null);
  const [chosen, setChosen] = useState<CheckoutCoin | null>(null);
  const m = en.coinPicker;
  const panelId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const caretRef = useRef<HTMLSpanElement>(null);
  const tileRefs = useRef(new Map<string, HTMLButtonElement>());
  const needle = query.trim().toLowerCase();

  /** Networks in the registry's order, each with its coins in checkout order (the settlement coin first). */
  const networks = useMemo(() => {
    const byChain = new Map<string, CheckoutCoin[]>();
    for (const coin of coins) byChain.set(coin.blockchain, [...(byChain.get(coin.blockchain) ?? []), coin]);
    return CHAINS.filter((chain) => byChain.has(chain.id)).map((chain) => ({ chain, coins: byChain.get(chain.id)! }));
  }, [coins]);

  /** Networks matching a search, each with the coins that match it (all of them when the network's name matches). */
  const filter = (search: string) =>
    networks
      .map((entry) => {
        const chainHit = !search || entry.chain.name.toLowerCase().includes(search);
        return { ...entry, chainHit, hits: chainHit ? entry.coins : entry.coins.filter((coin) => coin.symbol.toLowerCase().includes(search)) };
      })
      .filter((entry) => entry.hits.length > 0);
  /** The chosen coin while its network is open and the search still lists it. */
  const choiceIn = (list: ReturnType<typeof filter>, openId: string | null, coin: CheckoutCoin | null) =>
    coin && list.find((entry) => entry.chain.id === openId)?.hits.includes(coin) ? coin : null;

  const shown = filter(needle);
  const open = shown.find((entry) => entry.chain.id === network) ?? null;
  const visibleChoice = choiceIn(shown, network, chosen);

  useEffect(() => () => onPreview(null), [onPreview]);

  const search = (value: string) => {
    setQuery(value);
    onPreview(choiceIn(filter(value.trim().toLowerCase()), network, chosen));
  };

  /** The caret on top of the panel points at the open tile; it follows the tile when the grid changes width. */
  const placeCaret = useCallback(() => {
    const tile = network ? tileRefs.current.get(network) : undefined;
    const panel = caretRef.current?.parentElement;
    if (caretRef.current && panel && tile) caretRef.current.style.left = `${tile.offsetLeft - panel.offsetLeft + tile.offsetWidth / 2 - 7}px`;
  }, [network]);
  useLayoutEffect(placeCaret);
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const observer = new ResizeObserver(placeCaret);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [placeCaret]);

  /** Opening a network scrolls its row to the top of the grid area, so the tile and its coins are both in view. */
  useEffect(() => {
    const tile = network ? tileRefs.current.get(network) : undefined;
    if (!gridRef.current || !tile) return;
    gridRef.current.scrollTo({ top: tile.offsetTop - 4, behavior: scrollBehavior() });
  }, [network]);

  /** The Continue row of a just-chosen coin scrolls into view when it is below the visible part of the coin list. */
  const revealContinue = useCallback((node: HTMLDivElement | null) => node?.scrollIntoView({ block: "nearest", behavior: scrollBehavior() }), []);

  const toggle = (id: string) => {
    setNetwork((current) => (current === id ? null : id));
    setChosen(null);
    onPreview(null);
  };

  const choose = (coin: CheckoutCoin) => {
    setChosen(coin);
    onPreview(coin);
  };

  const count = (n: number, one: string, many: string) => (n === 1 ? one : format(many, { count: n }));

  const minimumText = (usd: number) => format(m.minimum, { minimum: formatMinimumUsd(usd) });

  return (
    <div className="@container flex flex-col gap-2.5">
      <label className="flex h-10 items-center gap-2 pointer-coarse:h-11 rounded-xl border border-line px-3 text-muted transition-colors focus-within:border-accent">
        <Icon name="search" className="size-4 shrink-0" />
        <input
          ref={inputRef}
          type="text"
          placeholder={m.searchPlaceholder}
          value={query}
          onChange={(event) => search(event.target.value)}
          aria-label={m.searchLabel}
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-field text-fg outline-none placeholder:text-muted"
        />
        {query ? (
          <button
            type="button"
            aria-label={m.clearSearch}
            onClick={() => {
              search("");
              inputRef.current?.focus();
            }}
            className="grid size-6 shrink-0 place-items-center rounded-full text-muted pointer-coarse:-mr-2 pointer-coarse:size-10 hover:bg-surface-2 hover:text-fg"
          >
            <Icon name="close" className="size-3.5" />
          </button>
        ) : null}
      </label>

      {shown.length === 0 ? (
        <p className="px-3 py-8 text-center text-meta text-muted">{query.trim() ? format(m.noMatch, { query: query.trim() }) : m.noCoins}</p>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="flex items-baseline justify-between gap-3">
            <span className="font-heading text-[13.5px] font-semibold">{m.network}</span>
            <span className="text-[12.5px] text-muted">{count(shown.length, m.networkCountOne, m.networkCount)}</span>
          </p>
          {/** Dense flow fills the open tile's row with later tiles, so the panel opens below that row; about 3.5 rows show at a time,
              and the padding keeps focus rings and the open tile's ring inside the scroll area. */}
          <motion.div
            ref={gridRef}
            layoutScroll
            className="relative -m-1 grid max-h-[380px] grid-flow-row-dense grid-cols-4 gap-1.5 overflow-y-auto overscroll-contain p-1 [scrollbar-gutter:stable] @[26rem]:grid-cols-5 @[26rem]:gap-2 @[40rem]:grid-cols-6 @[52rem]:grid-cols-8"
          >
            {/** One flat keyed list, so tiles and the panel keep their elements (and animate) when the panel moves or the search filters. */}
            {shown.flatMap(({ chain, chainHit, hits }, index) => {
              const isOpen = chain.id === open?.chain.id;
              const tile = (
                <motion.button
                  key={chain.id}
                  ref={(node: HTMLButtonElement | null) => {
                    if (node) tileRefs.current.set(chain.id, node);
                    else tileRefs.current.delete(chain.id);
                  }}
                  type="button"
                  layout="position"
                  transition={MOVE}
                  aria-expanded={isOpen}
                  aria-controls={isOpen ? panelId : undefined}
                  onClick={(event) => {
                    ripple(event.currentTarget, tileRefs.current.values());
                    toggle(chain.id);
                  }}
                  className={`group min-w-0 rounded-[14px] ${FOCUS_RING}`}
                >
                  <span
                    className={`flex h-full animate-tile-in flex-col items-center gap-[5px] rounded-[14px] border px-1 pt-2.5 pb-2 transition-[border-color,background-color,box-shadow] duration-200 ${
                      isOpen ? "border-accent bg-accent/8 shadow-[0_0_0_1px_var(--accent)]" : "border-line bg-surface group-hover:border-accent/45"
                    }`}
                    style={{ animationDelay: `${Math.min(index, MAX_STAGGERED) * STAGGER_S}s` }}
                  >
                    <ChainBadge chain={chain} className="size-[30px] text-[13px]" />
                    <span className="line-clamp-2 max-w-full text-[12.5px] leading-tight font-semibold [overflow-wrap:anywhere]">{highlight(chain.name, needle)}</span>
                    {chainHit ? (
                      <span className="mt-auto text-xs text-muted">{count(hits.length, m.coinCountOne, m.coinCount)}</span>
                    ) : (
                      <span className="flex max-w-full flex-wrap justify-center gap-1">
                        {hits.map((coin) => (
                          <span key={coin.assetId} className="max-w-full truncate rounded-full bg-accent/15 px-1.5 text-[10.5px] leading-normal font-semibold text-accent-tint-text">
                            {highlight(coin.symbol, needle)}
                          </span>
                        ))}
                      </span>
                    )}
                  </span>
                </motion.button>
              );
              if (!isOpen) return [tile];
              return [
                tile,
                <motion.div
                  key="panel"
                  id={panelId}
                  role="region"
                  aria-label={format(m.coinsOn, { chain: chain.name })}
                  layout="position"
                  initial={{ opacity: 0, y: 28 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={MOVE}
                  className="relative col-span-full mt-1 rounded-2xl border border-line bg-surface-2 p-2"
                >
                  <span ref={caretRef} aria-hidden="true" className="absolute -top-[7px] size-3 rotate-45 border-t border-l border-line bg-surface-2 transition-[left] duration-300" />
                  <div className="flex items-center gap-2.5 px-1 pt-1 pb-2">
                    <ChainBadge chain={chain} className="size-6 text-[11px]" />
                    <p className="flex-1 font-heading text-sm font-semibold">{format(m.coinsOn, { chain: chain.name })}</p>
                    <button
                      type="button"
                      aria-label={format(m.closeNetwork, { chain: chain.name })}
                      onClick={() => toggle(chain.id)}
                      className="grid size-7 place-items-center rounded-lg text-muted pointer-coarse:-my-2 pointer-coarse:size-11 hover:bg-surface hover:text-fg"
                    >
                      <Icon name="close" className="size-4" />
                    </button>
                  </div>
                  <ul className="flex max-h-[220px] flex-col gap-1.5 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
                    {hits.map((coin, row) => {
                      const isChosen = coin === visibleChoice;
                      return (
                        <motion.li
                          key={coin.assetId}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ ...MOVE, delay: Math.min(row, MAX_STAGGERED) * STAGGER_S }}
                        >
                          <button
                            type="button"
                            aria-pressed={isChosen}
                            disabled={!!coin.refusal}
                            onClick={() => choose(coin)}
                            className={`flex w-full items-center gap-2.5 rounded-xl border bg-surface px-2.5 py-[9px] text-left transition-colors disabled:cursor-not-allowed disabled:opacity-55 ${
                              isChosen ? "border-accent" : "border-transparent enabled:hover:border-line"
                            }`}
                          >
                            <CoinIcon symbol={coin.symbol} className="size-[30px] text-[11px]" />
                            <span className="flex min-w-0 flex-1 flex-col">
                              <span className="truncate font-semibold">{highlight(coin.symbol, needle)}</span>
                              {coin.refusal ? (
                                <span className="truncate text-xs text-warn">
                                  {coin.refusal.minimumUsd === null ? m.lowLiquidity : minimumText(coin.refusal.minimumUsd)}
                                </span>
                              ) : (
                                <span className="min-h-4 truncate text-xs text-muted">
                                  {coin.sameAsSettlement ? m.recommended : coin.floorUsd === null ? null : minimumText(coin.floorUsd)}
                                </span>
                              )}
                            </span>
                            {amountUsd === null ? null : (
                              <span className="shrink-0 font-heading text-[13.5px] font-semibold whitespace-nowrap tabular-nums">{approxAmount(amountUsd, coin)}</span>
                            )}
                          </button>
                          {isChosen ? (
                            <motion.div
                              ref={revealContinue}
                              initial={{ opacity: 0, y: -8 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={MOVE}
                              className="flex items-center gap-2.5 px-1 pt-2.5 pb-0.5"
                            >
                              <span className="flex-1 text-[13px] text-muted">
                                {amountUsd === null ? null : format(m.nextSend, { amount: approxAmount(amountUsd, coin), chain: chain.name })}
                              </span>
                              <Button size="sm" onClick={() => onSelect(coin)}>
                                {m.continue}
                              </Button>
                            </motion.div>
                          ) : null}
                        </motion.li>
                      );
                    })}
                  </ul>
                </motion.div>,
              ];
            })}
          </motion.div>
        </div>
      )}
    </div>
  );
}
