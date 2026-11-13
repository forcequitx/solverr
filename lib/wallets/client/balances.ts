import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { createPublicClient, erc20Abi, getAddress, http } from "viem";
import { arbitrum, avalanche, base, bsc, mainnet, optimism, polygon } from "viem/chains";
import { jsonRpc } from "@/lib/chains/rpc/json-rpc";
import type { CheckoutCoin } from "@/lib/payments/coins";
import type { WalletKind } from "@/lib/wallets/client/types";

/** A coin the connected wallet holds, with its value at the 1Click price. */
export type Holding = { coin: CheckoutCoin; usd: number };

/** Solana RPC for balance reads and wallet payments; kept here, not in `solana.ts`, which loads only on a Solana connect. */
export const SOLANA_RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
/** Balance reads cover the busiest EVM chains to keep public RPC traffic small. */
const BALANCE_CHAINS = [mainnet, base, arbitrum, optimism, polygon, bsc, avalanche];
const NEAR_RPC = process.env.NEXT_PUBLIC_NEAR_RPC_URL || "https://free.rpc.fastnear.com";
const NEAR_COINS = new Set(["USDC", "USDT", "wNEAR", "ETH", "wBTC"]);
/** The wNEAR contract; a wallet payment in wNEAR wraps native NEAR for whatever wNEAR the account lacks. */
export const WRAPPED_NEAR = "wrap.near";
/** NEAR locks 10^19 yocto per byte of account storage. */
const NEAR_STORAGE_PRICE_PER_BYTE = 10n ** 19n;
/** Native NEAR left for fees and the storage registrations of a wNEAR payment (0.05 NEAR). */
const NEAR_FEE_RESERVE_YOCTO = 5n * 10n ** 22n;
const TIMEOUT_MS = 8000;

const usdValue = (coin: CheckoutCoin, amount: bigint) => (Number(amount) / 10 ** coin.decimals) * coin.priceUsd;

async function evmHoldings(owner: string, coins: CheckoutCoin[]): Promise<Holding[]> {
  const account = getAddress(owner);
  const perChain = await Promise.all(
    BALANCE_CHAINS.map(async (chain) => {
      const chainCoins = coins.filter((coin) => coin.evmChainId === chain.id);
      if (chainCoins.length === 0) return [];
      const client = createPublicClient({ chain, transport: http(undefined, { timeout: TIMEOUT_MS }) });
      const tokens = chainCoins.filter((coin) => coin.contract);
      const [native, tokenResults] = await Promise.all([
        client.getBalance({ address: account }).catch(() => 0n),
        client
          .multicall({ contracts: tokens.map((coin) => ({ address: getAddress(coin.contract!), abi: erc20Abi, functionName: "balanceOf" as const, args: [account] })), allowFailure: true })
          .catch(() => []),
      ]);
      const holdings: Holding[] = [];
      const nativeCoin = chainCoins.find((coin) => !coin.contract);
      if (nativeCoin && native > 0n) holdings.push({ coin: nativeCoin, usd: usdValue(nativeCoin, native) });
      tokens.forEach((coin, index) => {
        const entry = tokenResults[index];
        const amount = entry && entry.status === "success" ? (entry.result as bigint) : 0n;
        if (amount > 0n) holdings.push({ coin, usd: usdValue(coin, amount) });
      });
      return holdings;
    }),
  );
  return perChain.flat();
}

async function rpc<T>(url: string, method: string, params: unknown): Promise<T> {
  const body = await jsonRpc<T>(url, method, params, TIMEOUT_MS);
  if (body.error || body.result === undefined) throw new Error(`${method} failed`);
  return body.result;
}

async function solanaHoldings(owner: string, coins: CheckoutCoin[]): Promise<Holding[]> {
  const solanaCoins = coins.filter((coin) => coin.blockchain === "sol");
  const [lamports, accounts] = await Promise.all([
    rpc<{ value: number }>(SOLANA_RPC_URL, "getBalance", [owner]).catch(() => ({ value: 0 })),
    rpc<{ value: { account: { data: { parsed: { info: { mint: string; tokenAmount: { amount: string } } } } } }[] }>(SOLANA_RPC_URL, "getTokenAccountsByOwner", [
      owner,
      { programId: TOKEN_PROGRAM_ADDRESS },
      { encoding: "jsonParsed" },
    ]).catch(() => ({ value: [] })),
  ]);
  const holdings: Holding[] = [];
  const sol = solanaCoins.find((coin) => !coin.contract);
  if (sol && lamports.value > 0) holdings.push({ coin: sol, usd: usdValue(sol, BigInt(lamports.value)) });
  for (const entry of accounts.value) {
    const { mint, tokenAmount } = entry.account.data.parsed.info;
    const coin = solanaCoins.find((c) => c.contract === mint);
    const amount = BigInt(tokenAmount.amount);
    if (coin && amount > 0n) holdings.push({ coin, usd: usdValue(coin, amount) });
  }
  return holdings;
}

/** A NEAR fungible token balance of `owner`, in base units. */
export async function nearTokenBalance(owner: string, contract: string): Promise<bigint> {
  const result = await rpc<{ result: number[] }>(NEAR_RPC, "query", {
    request_type: "call_function",
    finality: "final",
    account_id: contract,
    method_name: "ft_balance_of",
    args_base64: btoa(JSON.stringify({ account_id: owner })),
  });
  return BigInt(JSON.parse(new TextDecoder().decode(Uint8Array.from(result.result))) as string);
}

/** Native NEAR the account can spend: its balance minus what its storage locks and a reserve for fees. */
async function spendableNear(owner: string): Promise<bigint> {
  const account = await rpc<{ amount: string; storage_usage: number }>(NEAR_RPC, "query", { request_type: "view_account", finality: "final", account_id: owner });
  const spendable = BigInt(account.amount) - BigInt(account.storage_usage) * NEAR_STORAGE_PRICE_PER_BYTE - NEAR_FEE_RESERVE_YOCTO;
  return spendable > 0n ? spendable : 0n;
}

async function nearHoldings(owner: string, coins: CheckoutCoin[]): Promise<Holding[]> {
  const nearCoins = coins.filter((coin) => coin.blockchain === "near" && coin.contract && NEAR_COINS.has(coin.symbol));
  const results = await Promise.all(
    nearCoins.map(async (coin) => {
      const [held, native] = await Promise.all([
        nearTokenBalance(owner, coin.contract!).catch(() => 0n),
        coin.contract === WRAPPED_NEAR ? spendableNear(owner).catch(() => 0n) : 0n,
      ]);
      /** wNEAR payments wrap native NEAR as needed, so spendable NEAR counts toward wNEAR. */
      const amount = held + native;
      return amount > 0n ? { coin, usd: usdValue(coin, amount) } : null;
    }),
  );
  return results.filter((holding): holding is Holding => holding !== null);
}

/** Supported coins held by the wallet on its chains, most valuable first. */
export async function readHoldings(kind: WalletKind, owner: string, coins: CheckoutCoin[]): Promise<Holding[]> {
  const holdings = kind === "evm" ? await evmHoldings(owner, coins) : kind === "solana" ? await solanaHoldings(owner, coins) : await nearHoldings(owner, coins);
  return holdings.sort((a, b) => b.usd - a.usd);
}
