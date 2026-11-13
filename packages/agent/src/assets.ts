/** A coin the agent can hold and pay with, identified by its 1Click asset ID. */
export interface WalletAsset {
  asset_id: string;
  symbol: string;
  /** 1Click blockchain code: `near` or `base`. */
  blockchain: string;
  decimals: number;
  /** NEP-141 contract on NEAR, ERC-20 contract on Base, or `null` for native ETH. */
  contract_address: string | null;
}

/** Coins checked for balances and payments unless `assets` is set. */
export const DEFAULT_ASSETS: readonly WalletAsset[] = [
  { asset_id: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", symbol: "USDC", blockchain: "near", decimals: 6, contract_address: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1" },
  { asset_id: "nep141:usdt.tether-token.near", symbol: "USDT", blockchain: "near", decimals: 6, contract_address: "usdt.tether-token.near" },
  { asset_id: "nep141:wrap.near", symbol: "wNEAR", blockchain: "near", decimals: 24, contract_address: "wrap.near" },
  { asset_id: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", symbol: "USDC", blockchain: "base", decimals: 6, contract_address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" },
  { asset_id: "nep141:base.omft.near", symbol: "ETH", blockchain: "base", decimals: 18, contract_address: null },
];

const USD_STABLECOINS = new Set(["USDC", "USDT", "DAI"]);

export function isUsdStablecoin(symbol: string): boolean {
  return USD_STABLECOINS.has(symbol.toUpperCase());
}
