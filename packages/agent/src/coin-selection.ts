import { parseUnits } from "viem";
import { isUsdStablecoin, type WalletAsset } from "./assets.js";
import type { ChainWallet } from "./chains/chain-wallet.js";
import { ESTIMATE_BUFFER } from "./config.js";
import { errorSummary } from "./errors.js";
import type { GatewayToken } from "./gateway.js";

/** A coin the agent holds enough of to try paying with. Lower `tier` is preferred. */
export interface PaymentOption {
  asset: WalletAsset;
  wallet: ChainWallet;
  priceUsd: number;
  balance: bigint;
  /** Expected amount in base units, with headroom for fees and slippage. */
  estimatedAmount: bigint;
  /** 0: the settlement coin itself, 1: the same coin on another chain, 2: another USD stablecoin, 3: any other coin. */
  tier: number;
}

export interface SelectionInput {
  wallets: readonly ChainWallet[];
  assets: readonly WalletAsset[];
  tokens: readonly GatewayToken[];
  settlement: { asset_id: string; symbol: string };
  amountUsd: number;
}

function tierOf(asset: WalletAsset, settlement: SelectionInput["settlement"]): number {
  if (asset.asset_id === settlement.asset_id) return 0;
  if (asset.symbol.toUpperCase() === settlement.symbol.toUpperCase()) return 1;
  return isUsdStablecoin(asset.symbol) ? 2 : 3;
}

/** Converts a USD amount to base units of a coin at `priceUsd`, rounded up. */
function usdToBaseUnits(amountUsd: number, priceUsd: number, decimals: number): bigint {
  return parseUnits((amountUsd / priceUsd).toFixed(decimals), decimals) + 1n;
}

/** Ranks held coins for paying `amountUsd`: same-coin routes first (no swap minimum, lowest fee), then stablecoins, then others. */
export async function rankPaymentOptions(input: SelectionInput): Promise<{ options: PaymentOption[]; skipped: string[] }> {
  const walletByChain = new Map(input.wallets.map((wallet) => [wallet.blockchain, wallet]));
  const prices = new Map(input.tokens.map((token) => [token.asset_id, token]));
  const candidates = [...input.assets];
  const settlementToken = prices.get(input.settlement.asset_id);
  if (settlementToken && walletByChain.has(settlementToken.blockchain) && !candidates.some((asset) => asset.asset_id === settlementToken.asset_id)) {
    const { asset_id, symbol, blockchain, decimals, contract_address } = settlementToken;
    candidates.push({ asset_id, symbol, blockchain, decimals, contract_address });
  }

  const skipped: string[] = [];
  const checks = candidates.map(async (asset): Promise<PaymentOption | undefined> => {
    const wallet = walletByChain.get(asset.blockchain);
    const listed = prices.get(asset.asset_id);
    const priceUsd = listed?.price_usd;
    if (!wallet) return undefined;
    if (!listed || !priceUsd || priceUsd <= 0) {
      skipped.push(`${asset.symbol} on ${asset.blockchain}: no price from the gateway`);
      return undefined;
    }
    /** Amounts and spending limits are worked out with the configured decimals, so a coin set up with the wrong ones is never used. */
    if (listed.decimals !== asset.decimals) {
      skipped.push(`${asset.symbol} on ${asset.blockchain}: set to ${asset.decimals} decimals, but the gateway lists ${listed.decimals}`);
      return undefined;
    }
    const estimatedAmount = usdToBaseUnits(input.amountUsd * (1 + ESTIMATE_BUFFER), priceUsd, asset.decimals);
    let balance: bigint;
    try {
      balance = await wallet.balance(asset);
    } catch (error) {
      skipped.push(`${asset.symbol} on ${asset.blockchain}: balance unavailable (${errorSummary(error, 120)})`);
      return undefined;
    }
    if (balance < estimatedAmount) {
      skipped.push(`${asset.symbol} on ${asset.blockchain}: balance too low`);
      return undefined;
    }
    return { asset, wallet, priceUsd, balance, estimatedAmount, tier: tierOf(asset, input.settlement) };
  });

  const options = (await Promise.all(checks)).filter((option): option is PaymentOption => option !== undefined);
  options.sort((a, b) => a.tier - b.tier);
  return { options, skipped };
}
