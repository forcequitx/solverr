/** What a wallet must send to pay a quote; the server builds it for payout transfers and browser wallets send it. */
export type PaymentInstruction = {
  evmChainId?: number;
  /** Token contract / mint / NEP-141 account; `null` for the chain's native coin. */
  tokenContract: string | null;
  amountBase: string;
  decimals: number;
  depositAddress: string;
};
