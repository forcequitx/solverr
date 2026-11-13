import type { WalletAsset } from "../assets.js";

export interface TransferResult {
  hash: string;
}

/** A key-holding wallet on one chain that can read balances and send exact token amounts. */
export interface ChainWallet {
  /** 1Click blockchain code. */
  readonly blockchain: string;
  readonly address: string;
  balance(asset: WalletAsset): Promise<bigint>;
  isValidRecipient(address: string): boolean;
  /** Sends exactly `amount` base units of `asset` to `to`. Errors before broadcasting mean no funds left;
      after broadcasting it throws only `PaymentError` with `fundsSent: true`. */
  transfer(asset: WalletAsset, to: string, amount: bigint): Promise<TransferResult>;
}
