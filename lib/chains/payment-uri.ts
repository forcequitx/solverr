import type { ChainInfo } from "@/lib/chains/registry";
import { formatBaseUnits } from "@/lib/money";

type UriInput = { chain: ChainInfo; depositAddress: string; tokenContract: string | null; amountBase: string; decimals: number };

const BIP21_SCHEMES: Partial<Record<ChainInfo["family"], string>> = {
  bitcoin: "bitcoin",
  litecoin: "litecoin",
  dogecoin: "dogecoin",
  dash: "dash",
  zcash: "zcash",
};

/** Wallet payment link with the amount filled in: EIP-681 (with chain id, so wallets refuse the wrong network), Solana Pay, BIP-21 or
    `ton://transfer`; `undefined` when no widely supported scheme exists or a memo of unnamed type is needed (Stellar). */
export function paymentUri({ chain, depositAddress, tokenContract, amountBase, decimals }: UriInput): string | undefined {
  const amount = formatBaseUnits(BigInt(amountBase), decimals);
  switch (chain.family) {
    case "evm":
      return tokenContract
        ? `ethereum:${tokenContract}@${chain.evmChainId}/transfer?address=${depositAddress}&uint256=${amountBase}`
        : `ethereum:${depositAddress}@${chain.evmChainId}?value=${amountBase}`;
    case "solana":
      return `solana:${depositAddress}?amount=${amount}${tokenContract ? `&spl-token=${tokenContract}` : ""}`;
    case "ton":
      return tokenContract
        ? `ton://transfer/${depositAddress}?jetton=${tokenContract}&amount=${amountBase}`
        : `ton://transfer/${depositAddress}?amount=${amountBase}`;
    case "bitcoincash":
      return tokenContract ? undefined : `${depositAddress.startsWith("bitcoincash:") ? depositAddress : `bitcoincash:${depositAddress}`}?amount=${amount}`;
    default: {
      const scheme = BIP21_SCHEMES[chain.family];
      return scheme && !tokenContract ? `${scheme}:${depositAddress}?amount=${amount}` : undefined;
    }
  }
}
