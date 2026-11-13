import {
  BaseError,
  InsufficientFundsError,
  RpcRequestError,
  TransactionNotFoundError,
  WaitForTransactionReceiptTimeoutError,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  http,
  isAddress,
  keccak256,
  zeroAddress,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import type { WalletAsset } from "../assets.js";
import { DEFAULT_BASE_RPC_URL, DEFAULT_REQUEST_TIMEOUT_MS, DEFAULT_TRANSFER_TIMEOUT_MS } from "../config.js";
import { PaymentError, errorSummary } from "../errors.js";
import type { ChainWallet, TransferResult } from "./chain-wallet.js";

interface BaseWalletOptions {
  /** 32-byte hex private key, with or without `0x`. */
  privateKey: string;
  rpcUrl?: string;
  requestTimeoutMs?: number;
}

const PRIVATE_KEY_PATTERN = /^(0x)?[0-9a-fA-F]{64}$/;
/** Node answers to a broadcast that mean the node already holds this exact transaction. */
const ALREADY_KNOWN = /already known|known transaction|already imported/i;

/** Base wallet paying with ERC-20 `transfer` or native ETH. */
export class BaseWallet implements ChainWallet {
  readonly blockchain = "base";
  readonly address: string;
  private readonly publicClient;
  private readonly walletClient;

  constructor(options: BaseWalletOptions) {
    if (!PRIVATE_KEY_PATTERN.test(options.privateKey)) throw new Error("base.privateKey must be a 32-byte hex private key.");
    const key = (options.privateKey.startsWith("0x") ? options.privateKey : `0x${options.privateKey}`) as Hex;
    const account = privateKeyToAccount(key);
    const transport = http(options.rpcUrl ?? DEFAULT_BASE_RPC_URL, { timeout: options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS, retryCount: 2 });
    this.address = account.address;
    this.publicClient = createPublicClient({ chain: base, transport });
    this.walletClient = createWalletClient({ account, chain: base, transport });
  }

  isValidRecipient(address: string): boolean {
    return isAddress(address, { strict: false }) && getAddress(address) !== zeroAddress;
  }

  async balance(asset: WalletAsset): Promise<bigint> {
    const token = this.tokenOf(asset);
    if (!token) return this.publicClient.getBalance({ address: this.address as Hex });
    return this.publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [this.address as Hex] });
  }

  async transfer(asset: WalletAsset, to: string, amount: bigint): Promise<TransferResult> {
    if (!this.isValidRecipient(to)) throw new PaymentError("quote_mismatch", `The deposit address ${to} is not a valid Base address.`);
    const recipient = getAddress(to);
    const token = this.tokenOf(asset);
    const call = token
      ? { to: token, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [recipient, amount] }) }
      : { to: recipient, value: amount };

    let serialized: Hex;
    try {
      const request = await this.walletClient.prepareTransactionRequest(call);
      serialized = await this.walletClient.signTransaction(request);
    } catch (error) {
      throw new PaymentError("transfer_failed", `The Base transfer could not be prepared: ${errorSummary(error)}`);
    }
    const hash = keccak256(serialized);

    try {
      await this.publicClient.sendRawTransaction({ serializedTransaction: serialized });
    } catch (error) {
      await this.throwIfRefused(error, hash);
      /** Any other failure may have happened after the node accepted the transaction, so inclusion is checked below. */
    }

    try {
      const receipt = await this.publicClient.waitForTransactionReceipt({ hash, timeout: DEFAULT_TRANSFER_TIMEOUT_MS });
      if (receipt.status !== "success") throw new PaymentError("transfer_failed", `The Base transfer ${hash} reverted.`, true);
      return { hash };
    } catch (error) {
      if (error instanceof WaitForTransactionReceiptTimeoutError) return { hash };
      if (error instanceof PaymentError) throw error;
      throw new PaymentError("transfer_failed", `The Base transfer ${hash} could not be confirmed: ${errorSummary(error)}`, true);
    }
  }

  /** Throws when the node answered the broadcast with an error and does not hold `hash`, so nothing was sent; returns when the
      transaction may still have been accepted (no answer, "already known", or a lookup that could not tell). */
  private async throwIfRefused(error: unknown, hash: Hex): Promise<void> {
    const answer = error instanceof BaseError ? error.walk((cause) => cause instanceof RpcRequestError) : null;
    const nodeMessage = answer instanceof RpcRequestError ? answer.details : "";
    if (!answer || ALREADY_KNOWN.test(nodeMessage)) return;
    const mayHoldIt = await this.publicClient.getTransaction({ hash }).then(
      () => true,
      (lookup: unknown) => !(lookup instanceof TransactionNotFoundError),
    );
    if (mayHoldIt) return;
    if (InsufficientFundsError.nodeMessage.test(nodeMessage)) {
      throw new PaymentError("no_funds", `${this.address} does not have enough ETH on Base for this transfer and its gas.`);
    }
    throw new PaymentError("transfer_failed", `The Base node refused the transfer: ${nodeMessage.slice(0, 300)}`);
  }

  private tokenOf(asset: WalletAsset): Hex | undefined {
    if (asset.blockchain !== "base") throw new Error(`${asset.symbol} is not a Base asset.`);
    if (asset.contract_address === null) return undefined;
    if (!isAddress(asset.contract_address, { strict: false })) throw new Error(`${asset.symbol} has an invalid Base contract address.`);
    return getAddress(asset.contract_address);
  }
}
