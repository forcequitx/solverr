import { erc20Abi, getAddress } from "viem";
import type { Merchant } from "@/generated/prisma/client";
import { EVM_CHAIN_BY_ID } from "@/lib/chains/evm-chains";
import { chainForToken } from "@/lib/chains/registry";
import { evmClient } from "@/lib/chains/rpc/evm-rpc";
import { solanaRpc } from "@/lib/chains/rpc/solana-rpc";
import { errorMessage, logger } from "@/lib/logger";
import { formatBaseUnits } from "@/lib/money";
import { listTokens } from "@/lib/oneclick/tokens";
import type { OneClickToken } from "@/lib/oneclick/types";
import { EARN_ASSETS } from "@/lib/payments/earn";

const log = logger.child({ module: "earn" });

export type EarnHolding = { assetId: string; vault: string; provider: string; symbol: string; amount: string; usd: number };

type TokenAccounts = { value: { account: { data: { parsed: { info: { tokenAmount: { amount: string } } } } } }[] };

async function solanaBalance(owner: string, mint: string): Promise<bigint> {
  const accounts = await solanaRpc<TokenAccounts>("getTokenAccountsByOwner", [owner, { mint }, { encoding: "jsonParsed" }]);
  return accounts.value.reduce((sum, entry) => sum + BigInt(entry.account.data.parsed.info.tokenAmount.amount), 0n);
}

/** One vault's share balance in the payout wallet; 0 when the chain has no reader here. */
function shareBalance(token: OneClickToken, owner: string): Promise<bigint> {
  if (token.blockchain === "sol") return solanaBalance(owner, token.contractAddress!);
  const evmChainId = chainForToken(token)?.evmChainId;
  const chain = evmChainId ? EVM_CHAIN_BY_ID.get(evmChainId) : undefined;
  if (chain && token.contractAddress) {
    return evmClient(chain).readContract({ address: getAddress(token.contractAddress), abi: erc20Abi, functionName: "balanceOf", args: [getAddress(owner)] });
  }
  return Promise.resolve(0n);
}

/** Earn vault shares in the payout wallet at the 1Click price. Unreadable balances are left out so Settings opens while an RPC or 1Click
    is down, and `unreadable` says some were, so a missing share is not shown as none. */
export async function earnHoldings(merchant: Merchant): Promise<{ holdings: EarnHolding[]; unreadable: boolean }> {
  const owner = merchant.payoutAddress;
  if (!owner || !merchant.payoutChain) return { holdings: [], unreadable: false };
  let unreadable = false;
  const listed = await listTokens().catch((error: unknown) => {
    log.error({ error: errorMessage(error) }, "Token list unavailable for Earn holdings");
    unreadable = true;
    return [];
  });
  const tokens = listed.filter((token) => token.assetId in EARN_ASSETS && chainForToken(token)?.id === merchant.payoutChain && token.contractAddress);
  const balances = await Promise.all(
    tokens.map((token) =>
      shareBalance(token, owner).catch((error: unknown) => {
        log.error({ symbol: token.symbol, error: errorMessage(error) }, "Balance read failed");
        unreadable = true;
        return 0n;
      }),
    ),
  );
  const holdings = tokens.flatMap((token, index) => {
    const amount = balances[index];
    if (amount === 0n) return [];
    const formatted = formatBaseUnits(amount, token.decimals);
    return [{ assetId: token.assetId, ...EARN_ASSETS[token.assetId], symbol: token.symbol, amount: formatted, usd: Number(formatted) * token.price }];
  });
  return { holdings, unreadable };
}
