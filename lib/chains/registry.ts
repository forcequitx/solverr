/** Address format family; decides how addresses are validated and which wallets can pay. */
export type ChainFamily =
  | "evm"
  | "solana"
  | "near"
  | "tron"
  | "bitcoin"
  | "litecoin"
  | "dogecoin"
  | "bitcoincash"
  | "dash"
  | "zcash"
  | "xrp"
  | "stellar"
  | "ton"
  | "sui"
  | "aptos"
  | "cardano"
  | "starknet";

export type ChainInfo = {
  /** 1Click `blockchain` code. */
  id: string;
  name: string;
  family: ChainFamily;
  evmChainId?: number;
  /** Exchange deposit addresses on this chain usually need a memo or tag, so they are unsafe as refund addresses. */
  exchangeNeedsMemo?: boolean;
  /** 1Click needs `depositMode: "MEMO"` for deposits on this chain. */
  depositMemo?: boolean;
  /** Merchants can receive payouts here (wallet ownership can be proven by signature). */
  payout?: boolean;
  /** Only 1Click assets whose id starts with this belong to this chain, for a 1Click code that covers more than one network. */
  assetPrefix?: string;
  /** Brand color for the chain's badge in network menus. */
  color: string;
  explorerTx: string;
};

const evm = (id: string, name: string, evmChainId: number, explorer: string, color: string, payout = false): ChainInfo => ({
  id,
  name,
  family: "evm",
  evmChainId,
  payout,
  color,
  explorerTx: `${explorer}/tx/{value}`,
});

const blockchair = (id: string, name: string, family: ChainFamily, slug: string, color: string): ChainInfo => ({
  id,
  name,
  family,
  color,
  explorerTx: `https://blockchair.com/${slug}/transaction/{value}`,
});

/** Chains Solverr accepts payments on. Codes match 1Click `GET /v0/tokens` `blockchain` values. */
export const CHAINS: readonly ChainInfo[] = [
  { id: "near", name: "NEAR", family: "near", payout: true, color: "#00C08B", explorerTx: "https://nearblocks.io/txns/{value}" },
  evm("eth", "Ethereum", 1, "https://etherscan.io", "#627EEA", true),
  evm("base", "Base", 8453, "https://basescan.org", "#0052FF", true),
  evm("arb", "Arbitrum", 42161, "https://arbiscan.io", "#28A0F0", true),
  evm("op", "Optimism", 10, "https://optimistic.etherscan.io", "#FF0420", true),
  evm("pol", "Polygon", 137, "https://polygonscan.com", "#8247E5", true),
  evm("bsc", "BNB Chain", 56, "https://bscscan.com", "#F0B90B", true),
  evm("avax", "Avalanche", 43114, "https://snowtrace.io", "#E84142", true),
  evm("gnosis", "Gnosis", 100, "https://gnosisscan.io", "#04795B"),
  evm("bera", "Berachain", 80094, "https://berascan.com", "#814625"),
  evm("monad", "Monad", 143, "https://monadscan.com", "#836EF9"),
  evm("xlayer", "X Layer", 196, "https://www.oklink.com/xlayer", "#000000"),
  evm("scroll", "Scroll", 534352, "https://scrollscan.com", "#EBC28E"),
  evm("plasma", "Plasma", 9745, "https://plasmascan.to", "#162F29"),
  evm("abs", "Abstract", 2741, "https://abscan.org", "#03C46F"),
  /** 1Click's "hypercore" code also lists HyperCore spot tokens, which an EVM wallet cannot send; only its ERC-20 tokens are HyperEVM. */
  { ...evm("hypercore", "HyperEVM", 999, "https://hyperevmscan.io", "#97FCE4", true), assetPrefix: "1cs_v1:hypercore:erc20:" },
  { id: "sol", name: "Solana", family: "solana", payout: true, color: "#9945FF", explorerTx: "https://solscan.io/tx/{value}" },
  { id: "tron", name: "TRON", family: "tron", color: "#EB0029", explorerTx: "https://tronscan.org/#/transaction/{value}" },
  { id: "btc", name: "Bitcoin", family: "bitcoin", color: "#F7931A", explorerTx: "https://mempool.space/tx/{value}" },
  blockchair("ltc", "Litecoin", "litecoin", "litecoin", "#345D9D"),
  blockchair("doge", "Dogecoin", "dogecoin", "dogecoin", "#C2A633"),
  blockchair("bch", "Bitcoin Cash", "bitcoincash", "bitcoin-cash", "#8DC351"),
  blockchair("dash", "Dash", "dash", "dash", "#008CE7"),
  blockchair("zec", "Zcash", "zcash", "zcash", "#F4B728"),
  { id: "xrp", name: "XRP Ledger", family: "xrp", exchangeNeedsMemo: true, color: "#23292F", explorerTx: "https://xrpscan.com/tx/{value}" },
  { id: "stellar", name: "Stellar", family: "stellar", exchangeNeedsMemo: true, depositMemo: true, color: "#14B6E7", explorerTx: "https://stellar.expert/explorer/public/tx/{value}" },
  { id: "ton", name: "TON", family: "ton", exchangeNeedsMemo: true, color: "#0098EA", explorerTx: "https://tonviewer.com/transaction/{value}" },
  { id: "sui", name: "Sui", family: "sui", color: "#4DA2FF", explorerTx: "https://suiscan.xyz/mainnet/tx/{value}" },
  { id: "aptos", name: "Aptos", family: "aptos", color: "#1A1A1A", explorerTx: "https://explorer.aptoslabs.com/txn/{value}?network=mainnet" },
  { id: "cardano", name: "Cardano", family: "cardano", color: "#0033AD", explorerTx: "https://cardanoscan.io/transaction/{value}" },
  { id: "starknet", name: "Starknet", family: "starknet", color: "#EC796B", explorerTx: "https://voyager.online/tx/{value}" },
];

const BY_ID = new Map(CHAINS.map((chain) => [chain.id, chain]));

export function getChain(id: string): ChainInfo | undefined {
  return BY_ID.get(id);
}

/** The chain with this display name, for lists that keep names rather than 1Click codes. */
export function chainByName(name: string): ChainInfo | undefined {
  return CHAINS.find((chain) => chain.name === name);
}

/** The supported chain a 1Click token belongs to, or undefined when Solverr does not use that token. */
export function chainForToken(token: { blockchain: string; assetId: string }): ChainInfo | undefined {
  const chain = BY_ID.get(token.blockchain);
  if (!chain || (chain.assetPrefix && !token.assetId.startsWith(chain.assetPrefix))) return undefined;
  return chain;
}

export function explorerTxUrl(chain: ChainInfo, hash: string): string {
  return chain.explorerTx.replace("{value}", encodeURIComponent(hash));
}
