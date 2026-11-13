import type { CheckoutCoin } from "@/lib/payments/coins";
import type { Holding } from "@/lib/wallets/client/balances";
import type { ConnectedWallet, WalletKind } from "@/lib/wallets/client/types";

/** Well-known sample addresses that pass each chain's address check; test payments never send to or from them. */
const TEST_ADDRESSES: Record<WalletKind, string> = {
  evm: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  solana: "11111111111111111111111111111111",
  near: "solverr-test.near",
  bitcoin: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
  tron: "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb",
  ton: "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c",
};

const SAMPLE_SAME_COINS = 3;
const SAMPLE_OTHER_COINS = 2;
/** Sample balances hold this many times the amount due, so every sample coin can pay. */
const SAMPLE_BALANCE_FACTOR = 3;

/** Test-mode wallet with a sample address and no wallet app; `pay` always refuses, so test mode can never start a real transfer. */
export function testWallet(kind: WalletKind, name: string): ConnectedWallet {
  return {
    kind,
    name,
    address: TEST_ADDRESSES[kind],
    signMessage: () => Promise.reject(new Error("A test wallet cannot sign messages.")),
    pay: () => Promise.reject(new Error("A test wallet cannot send payments.")),
    watch: () => () => {},
    disconnect: () => Promise.resolve(),
  };
}

/** Sample balances for a test wallet: the first few coins on its chains, the merchant's settlement symbol first. */
export function testHoldings(kind: WalletKind, coins: CheckoutCoin[], amountUsd: number): Holding[] {
  const usd = amountUsd * SAMPLE_BALANCE_FACTOR;
  const settlementSymbol = coins.find((coin) => coin.sameAsSettlement)?.symbol;
  const own = coins.filter((coin) => coin.family === kind);
  const same = (coin: CheckoutCoin) => coin.symbol === settlementSymbol;
  const picked = [...own.filter(same).slice(0, SAMPLE_SAME_COINS), ...own.filter((coin) => !same(coin)).slice(0, SAMPLE_OTHER_COINS)];
  return picked.map((coin) => ({ coin, usd }));
}
