import { erc20Abi, isAddressEqual, isHash, parseEventLogs, TransactionReceiptNotFoundError, type Address } from "viem";
import { EVM_CHAIN_BY_ID } from "@/lib/chains/evm-chains";
import type { ChainInfo } from "@/lib/chains/registry";
import { evmClient } from "@/lib/chains/rpc/evm-rpc";
import { nearRpc } from "@/lib/chains/rpc/near-rpc";
import { solanaRpc } from "@/lib/chains/rpc/solana-rpc";
/** Confirmations an EVM transaction needs, its own block counting as one, so a short reorganisation cannot undo a completed transfer. */
const EVM_CONFIRMATIONS = 3n;
const SOLANA_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
const NEAR_TX_HASH = /^[1-9A-HJ-NP-Za-km-z]{40,50}$/;

/** What the transaction must show: at least `amountBase` moved `from` → `to`, in a block after `notBefore`, so an older payment cannot count. */
type ExpectedTransfer = { chain: ChainInfo; tokenContract: string | null; from: string; to: string; amountBase: bigint; txHash: string; notBefore: Date };

/** Allowance for block timestamps running behind the server clock. */
const BLOCK_TIME_SKEW_MS = 60_000;

type TransferCheck = { state: "confirmed" } | { state: "pending" } | { state: "failed"; reason: string };

const CONFIRMED: TransferCheck = { state: "confirmed" };
const PENDING: TransferCheck = { state: "pending" };
const failed = (reason: string): TransferCheck => ({ state: "failed", reason });
const MISMATCH = failed("The transaction does not send the transfer amount from your payout wallet to the recipient.");
const NOT_A_HASH = failed("This is not a transaction on the transfer's network.");
const TOO_OLD = failed("The transaction was made before this transfer existed, so it is not this transfer's transaction.");
const madeBefore = (blockTimeMs: number, expected: ExpectedTransfer) => blockTimeMs < expected.notBefore.getTime() - BLOCK_TIME_SKEW_MS;

async function checkEvm(expected: ExpectedTransfer): Promise<TransferCheck> {
  const chain = expected.chain.evmChainId ? EVM_CHAIN_BY_ID.get(expected.chain.evmChainId) : undefined;
  if (!chain) return failed(`Transactions on ${expected.chain.name} cannot be checked.`);
  if (!isHash(expected.txHash)) return NOT_A_HASH;
  const client = evmClient(chain);
  let receipt;
  try {
    receipt = await client.getTransactionReceipt({ hash: expected.txHash });
  } catch (error) {
    if (error instanceof TransactionReceiptNotFoundError) return PENDING;
    throw error;
  }
  if (receipt.status !== "success") return failed("The transaction failed on the network, so nothing was sent.");
  if ((await client.getBlockNumber()) - receipt.blockNumber + 1n < EVM_CONFIRMATIONS) return PENDING;
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  if (madeBefore(Number(block.timestamp) * 1000, expected)) return TOO_OLD;
  const from = expected.from as Address;
  const to = expected.to as Address;
  /** A token transfer is proved by its Transfer event alone: a smart-contract wallet's transaction is sent by a bundler or co-signer. */
  if (expected.tokenContract) {
    const token = expected.tokenContract as Address;
    const transfers = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.logs, strict: true });
    const moved = transfers.some(
      (log) => isAddressEqual(log.address, token) && isAddressEqual(log.args.from, from) && isAddressEqual(log.args.to, to) && log.args.value >= expected.amountBase,
    );
    return moved ? CONFIRMED : MISMATCH;
  }
  if (!isAddressEqual(receipt.from, from)) return MISMATCH;
  const transaction = await client.getTransaction({ hash: expected.txHash });
  return transaction.to && isAddressEqual(transaction.to, to) && transaction.value >= expected.amountBase ? CONFIRMED : MISMATCH;
}

/** Code of an EIP-7702 delegated account: an ordinary key-held wallet that still sends its own transactions. */
const DELEGATED_ACCOUNT_CODE = "0xef0100";

/** Whether `address` is an EVM smart-contract wallet, whose native-coin sends are inner calls a receipt cannot show or confirm. */
export async function isContractWallet(chain: ChainInfo, address: string): Promise<boolean> {
  const evmChain = chain.evmChainId ? EVM_CHAIN_BY_ID.get(chain.evmChainId) : undefined;
  if (!evmChain) return false;
  const code = await evmClient(evmChain).getCode({ address: address as Address });
  return Boolean(code && code !== "0x" && !code.startsWith(DELEGATED_ACCOUNT_CODE));
}

/** Whether `hash` has the shape of a transaction id on `chain`, checked before it is recorded so the worker never polls a typo. */
export function isTransactionHash(chain: ChainInfo, hash: string): boolean {
  switch (chain.family) {
    case "evm":
      return isHash(hash);
    case "solana":
      return SOLANA_SIGNATURE.test(hash);
    case "near":
      return NEAR_TX_HASH.test(hash);
    default:
      return true;
  }
}

type TokenBalance = { accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount: string } };
type SolanaTransaction = {
  blockTime: number | null;
  meta: { err: unknown; preBalances: number[]; postBalances: number[]; preTokenBalances?: TokenBalance[]; postTokenBalances?: TokenBalance[] } | null;
  transaction: { message: { accountKeys: { pubkey: string; signer: boolean }[] } };
};

/** The amount of `mint` that `owner` holds across the token accounts listed in `balances`. */
const tokenHeld = (balances: TokenBalance[] | undefined, mint: string, owner: string) =>
  (balances ?? []).filter((entry) => entry.mint === mint && entry.owner === owner).reduce((sum, entry) => sum + BigInt(entry.uiTokenAmount.amount), 0n);

async function checkSolana(expected: ExpectedTransfer): Promise<TransferCheck> {
  if (!SOLANA_SIGNATURE.test(expected.txHash)) return NOT_A_HASH;
  /** A finalized transaction cannot be rolled back; before that the RPC answers null. */
  const transaction = await solanaRpc<SolanaTransaction | null>("getTransaction", [
    expected.txHash,
    { commitment: "finalized", encoding: "jsonParsed", maxSupportedTransactionVersion: 0 },
  ]);
  if (!transaction?.meta) return PENDING;
  if (transaction.meta.err) return failed("The transaction failed on the network, so nothing was sent.");
  if (transaction.blockTime !== null && madeBefore(transaction.blockTime * 1000, expected)) return TOO_OLD;
  const keys = transaction.transaction.message.accountKeys;
  if (!keys.some((key) => key.signer && key.pubkey === expected.from)) return MISMATCH;
  const { meta } = transaction;
  if (expected.tokenContract) {
    const received = tokenHeld(meta.postTokenBalances, expected.tokenContract, expected.to) - tokenHeld(meta.preTokenBalances, expected.tokenContract, expected.to);
    return received >= expected.amountBase ? CONFIRMED : MISMATCH;
  }
  const index = keys.findIndex((key) => key.pubkey === expected.to);
  if (index < 0) return MISMATCH;
  return BigInt(meta.postBalances[index]) - BigInt(meta.preBalances[index]) >= expected.amountBase ? CONFIRMED : MISMATCH;
}

type NearAction = { FunctionCall?: { method_name: string; args: string } };
type NearTransaction = {
  final_execution_status?: string;
  status: { SuccessValue?: string; Failure?: unknown };
  transaction: { signer_id: string; receiver_id: string; actions: (NearAction | string)[] };
  transaction_outcome: { block_hash: string };
};

/** NEAR transfers are NEP-141 `ft_transfer` calls on the token contract; the browser wallet sends no native NEAR. */
async function checkNear(expected: ExpectedTransfer): Promise<TransferCheck> {
  if (!NEAR_TX_HASH.test(expected.txHash) || !expected.tokenContract) return NOT_A_HASH;
  /** `NONE` answers at once with what is known, where waiting for `FINAL` holds an unknown transaction past the RPC timeout. */
  const body = await nearRpc<NearTransaction>("tx", { tx_hash: expected.txHash, sender_account_id: expected.from, wait_until: "NONE" });
  if (body.error) {
    const name = body.error.cause?.name ?? body.error.name;
    if (name === "UNKNOWN_TRANSACTION" || name === "TIMEOUT_ERROR") return PENDING;
    throw new Error(`NEAR RPC tx failed: ${name ?? "unknown error"}`);
  }
  const outcome = body.result;
  if (!outcome || outcome.final_execution_status !== "FINAL") return PENDING;
  if (outcome.status.Failure !== undefined || outcome.status.SuccessValue === undefined) return failed("The transaction failed on the network, so nothing was sent.");
  if (outcome.transaction.signer_id !== expected.from || outcome.transaction.receiver_id !== expected.tokenContract) return MISMATCH;
  const block = await nearRpc<{ header: { timestamp_nanosec: string } }>("block", { block_id: outcome.transaction_outcome.block_hash });
  if (!block.result) throw new Error(`NEAR RPC block failed: ${block.error?.name ?? "unknown error"}`);
  if (madeBefore(Number(BigInt(block.result.header.timestamp_nanosec) / 1_000_000n), expected)) return TOO_OLD;
  const moved = outcome.transaction.actions.some((action) => {
    const call = typeof action === "object" ? action.FunctionCall : undefined;
    if (call?.method_name !== "ft_transfer") return false;
    try {
      const args = JSON.parse(Buffer.from(call.args, "base64").toString("utf8")) as { receiver_id?: unknown; amount?: unknown };
      return args.receiver_id === expected.to && typeof args.amount === "string" && /^\d+$/.test(args.amount) && BigInt(args.amount) >= expected.amountBase;
    } catch {
      return false;
    }
  });
  return moved ? CONFIRMED : MISMATCH;
}

/** Checks that a direct transfer's transaction succeeded, is final and moved the amount; `pending` means not found or not final, RPC outages throw. */
export async function checkDirectTransfer(expected: ExpectedTransfer): Promise<TransferCheck> {
  switch (expected.chain.family) {
    case "evm":
      return checkEvm(expected);
    case "solana":
      return checkSolana(expected);
    case "near":
      return checkNear(expected);
    default:
      return failed(`Transactions on ${expected.chain.name} cannot be checked.`);
  }
}
