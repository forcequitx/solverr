import { createHash } from "node:crypto";
import { Account, JsonRpcProvider, actions, baseEncode, teraToGas, yoctoToNear, type KeyPairString } from "near-api-js";
import type { WalletAsset } from "../assets.js";
import { DEFAULT_NEAR_RPC_URL, DEFAULT_REQUEST_TIMEOUT_MS, DEFAULT_TRANSFER_TIMEOUT_MS } from "../config.js";
import { PaymentError, errorSummary } from "../errors.js";
import { TimeoutError, withTimeout } from "../timeout.js";
import type { ChainWallet, TransferResult } from "./chain-wallet.js";

interface NearWalletOptions {
  accountId: string;
  /** `ed25519:…` private key. */
  privateKey: string;
  rpcUrl?: string;
  requestTimeoutMs?: number;
}

const ACCOUNT_ID_PATTERN = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const FUNCTION_CALL_GAS = teraToGas("30");
const ONE_YOCTO = 1n;
/** Native NEAR kept back for gas (two 30 TGas calls cost well under 0.01 NEAR). */
const GAS_RESERVE_YOCTO = 10n ** 22n;
const STORAGE_PRICE_PER_BYTE = 10n ** 19n;
const RPC_RETRIES = { retries: 2, wait: 500, backoff: 2 };

function isNearAccountId(value: string): boolean {
  return value.length >= 2 && value.length <= 64 && ACCOUNT_ID_PATTERN.test(value);
}

/** NEAR wallet paying with NEP-141 tokens through `ft_transfer`, registering the recipient's token storage first when needed. */
export class NearWallet implements ChainWallet {
  readonly blockchain = "near";
  readonly address: string;
  private readonly provider: JsonRpcProvider;
  private readonly account: Account;
  private readonly requestTimeoutMs: number;
  private readonly rpcUrl: string;

  constructor(options: NearWalletOptions) {
    if (!isNearAccountId(options.accountId)) throw new Error("near.accountId is not a valid NEAR account ID.");
    if (!/^(ed25519|secp256k1):/.test(options.privateKey)) throw new Error("near.privateKey must start with ed25519: or secp256k1:.");
    this.address = options.accountId;
    this.rpcUrl = options.rpcUrl ?? DEFAULT_NEAR_RPC_URL;
    this.provider = new JsonRpcProvider({ url: this.rpcUrl }, RPC_RETRIES);
    this.account = new Account(options.accountId, this.provider, options.privateKey as KeyPairString);
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  isValidRecipient(address: string): boolean {
    return isNearAccountId(address);
  }

  async balance(asset: WalletAsset): Promise<bigint> {
    const balance = await this.view<string>(this.contractOf(asset), "ft_balance_of", { account_id: this.address });
    return BigInt(balance ?? "0");
  }

  async transfer(asset: WalletAsset, to: string, amount: bigint): Promise<TransferResult> {
    if (!this.isValidRecipient(to)) throw new PaymentError("quote_mismatch", `The deposit address ${to} is not a valid NEAR account.`);
    const contract = this.contractOf(asset);

    const registered = await this.view<unknown>(contract, "storage_balance_of", { account_id: to });
    const transferActions = [];
    let storageCost = 0n;
    if (registered == null) {
      const bounds = await this.view<{ min: string }>(contract, "storage_balance_bounds", {});
      storageCost = BigInt(bounds?.min ?? "0");
      transferActions.push(actions.functionCall("storage_deposit", { account_id: to, registration_only: true }, FUNCTION_CALL_GAS, storageCost));
    }
    transferActions.push(actions.functionCall("ft_transfer", { receiver_id: to, amount: amount.toString() }, FUNCTION_CALL_GAS, ONE_YOCTO));

    await this.assertGasBalance(storageCost);
    const signed = await this.rpc(this.account.createSignedTransaction({ receiverId: contract, actions: transferActions }), this.requestTimeoutMs, "Preparing the NEAR transaction");
    const hash = baseEncode(createHash("sha256").update(signed.transaction.encode()).digest());

    try {
      const outcome = await this.rpc(this.provider.sendTransactionUntil(signed, "EXECUTED_OPTIMISTIC"), DEFAULT_TRANSFER_TIMEOUT_MS, "The NEAR transfer");
      if (typeof outcome.status === "object" && "Failure" in outcome.status) {
        throw new PaymentError("transfer_failed", `The NEAR transfer ${hash} failed on-chain.`, true);
      }
      return { hash };
    } catch (error) {
      if (error instanceof TimeoutError) return { hash };
      if (error instanceof PaymentError) throw error;
      throw new PaymentError("transfer_failed", `The NEAR transfer ${hash} was not accepted: ${errorSummary(error)}`, true);
    }
  }

  private contractOf(asset: WalletAsset): string {
    if (asset.blockchain !== "near" || !asset.contract_address) throw new Error(`${asset.symbol} is not a NEP-141 token on NEAR.`);
    return asset.contract_address;
  }

  private view<T>(contractId: string, method: string, args: Record<string, unknown>): Promise<T | undefined> {
    return this.rpc(this.provider.callFunction<T & {}>({ contractId, method, args }), this.requestTimeoutMs, `NEAR ${method}`) as Promise<T | undefined>;
  }

  /** Awaits an RPC call within `timeoutMs`; its error text names only the RPC origin, since the full URL may carry an API key. */
  private rpc<T>(call: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    return withTimeout(call, timeoutMs, label).catch((error: unknown) => {
      if (!(error instanceof Error) || !error.message.includes(this.rpcUrl)) throw error;
      throw new Error(error.message.replaceAll(this.rpcUrl, URL.canParse(this.rpcUrl) ? new URL(this.rpcUrl).origin : "the NEAR RPC"));
    });
  }

  private async assertGasBalance(storageCost: bigint): Promise<void> {
    const account = await this.rpc(this.provider.viewAccount({ accountId: this.address }), this.requestTimeoutMs, "NEAR account lookup");
    const available = account.amount - BigInt(account.storage_usage) * STORAGE_PRICE_PER_BYTE;
    if (available < storageCost + GAS_RESERVE_YOCTO) {
      throw new PaymentError("no_funds", `${this.address} needs at least ${yoctoToNear(storageCost + GAS_RESERVE_YOCTO, 4)} NEAR available for gas and token storage.`);
    }
  }
}
