import { createHash } from "node:crypto";
import { KeyPair, baseDecode, baseEncode, decodeSignedTransaction } from "near-api-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WalletAsset } from "../src/assets.js";
import { NearWallet } from "../src/chains/near.js";
import { PaymentError } from "../src/errors.js";
import { TimeoutError } from "../src/timeout.js";
import { ETH_BASE, USDC_NEAR, hangingReply, stubJsonRpc, type RpcCall, type RpcReply } from "./fixtures.js";

const RPC_URL = "https://rpc.near.test";
const ACCOUNT = "agent.near";
/** 1Click NEAR deposit addresses are fresh implicit accounts: 64 hex characters. */
const DEPOSIT = "3f9a1c6e2b7d4085a1e6c3b9f2d7048e5a1c6b3d9f2e7048a5c1b6d3e9f20748";
const TOKEN = USDC_NEAR.contract_address as string;
const WNEAR: WalletAsset = { asset_id: "nep141:wrap.near", symbol: "wNEAR", blockchain: "near", decimals: 24, contract_address: "wrap.near" };
const NATIVE_NEAR: WalletAsset = { asset_id: "near", symbol: "NEAR", blockchain: "near", decimals: 24, contract_address: null };

const MILLI_NEAR = 10n ** 21n;
const GAS_RESERVE = 10n * MILLI_NEAR;
/** Storage staking price: 10^19 yoctoNEAR per byte. */
const BYTE_COST = 10n ** 19n;
/** USDC's `storage_balance_bounds.min` on mainnet: 0.00125 NEAR. */
const STORAGE_MIN = 1_250_000_000_000_000_000_000n;
const CALL_GAS = 30_000_000_000_000n;
const BLOCK_HASH = baseEncode(new Uint8Array(32).fill(7));
const ACCESS_KEY_NONCE = 41;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

interface NodeState {
  /** Whether the deposit address already has token storage. */
  registered: boolean;
  /** The agent account's liquid balance and storage use. */
  amount: bigint;
  storageUsage: number;
  tokenBalance: string;
  /** Answer to `send_tx`; the default is a successful outcome. */
  sendTx: () => RpcReply | Promise<RpcReply>;
  /** Answers that replace the default for single view methods, by method name. */
  views: Record<string, () => RpcReply | Promise<RpcReply>>;
}

const viewResult = (value: unknown): RpcReply => ({
  result: { result: Array.from(Buffer.from(JSON.stringify(value))), logs: [], block_height: 100, block_hash: BLOCK_HASH },
});

/** A NEAR RPC node with one USDC contract, the agent's account and access key; every request is recorded. */
function nearNode(overrides: Partial<NodeState> = {}) {
  const state: NodeState = {
    registered: false,
    amount: 1n * 10n ** 24n,
    storageUsage: 0,
    tokenBalance: "0",
    sendTx: () => ({ result: { status: { SuccessValue: "" }, transaction: {}, transaction_outcome: {}, receipts_outcome: [] } }),
    views: {},
    ...overrides,
  };
  const calls = stubJsonRpc((method, params) => {
    const query = params as { request_type?: string; account_id?: string; method_name?: string };
    if (method === "send_tx") return state.sendTx();
    if (method === "block") return { result: { header: { hash: BLOCK_HASH, height: 100 } } };
    if (method !== "query") return { error: { code: -32601, message: `Method not found: ${method}` } };
    if (query.request_type === "view_access_key") return { result: { nonce: ACCESS_KEY_NONCE, permission: "FullAccess", block_height: 100, block_hash: BLOCK_HASH } };
    if (query.request_type === "view_account") {
      return { result: { amount: state.amount.toString(), locked: "0", code_hash: "11111111111111111111111111111111", storage_usage: state.storageUsage, storage_paid_at: 0, block_height: 100, block_hash: BLOCK_HASH } };
    }
    const override = state.views[query.method_name ?? ""];
    if (override) return override();
    if (query.method_name === "storage_balance_of") return viewResult(state.registered ? { total: STORAGE_MIN.toString(), available: "0" } : null);
    if (query.method_name === "storage_balance_bounds") return viewResult({ min: STORAGE_MIN.toString(), max: (STORAGE_MIN * 100n).toString() });
    if (query.method_name === "ft_balance_of") return viewResult(state.tokenBalance);
    return { error: { code: -32601, message: `Unexpected query ${query.request_type} ${query.method_name}` } };
  });
  return calls;
}

function newWallet(requestTimeoutMs?: number) {
  const key = KeyPair.fromRandom("ed25519");
  const wallet = new NearWallet({ accountId: ACCOUNT, privateKey: key.toString(), rpcUrl: RPC_URL, requestTimeoutMs });
  return { wallet, key };
}

/** Each view call as `contract.method(args)`, and each account lookup as `view_account(account)`, in the order sent. */
function views(calls: RpcCall[]): string[] {
  return calls
    .filter((call) => call.method === "query")
    .map((call) => call.params as { request_type: string; account_id: string; method_name?: string; args_base64?: string })
    .filter((query) => query.request_type !== "view_access_key")
    .map((query) =>
      query.request_type === "call_function" ? `${query.account_id}.${query.method_name}(${Buffer.from(query.args_base64 ?? "", "base64").toString()})` : `${query.request_type}(${query.account_id})`,
    );
}

/** The signed transactions sent with `send_tx`, decoded from the wire, with their `wait_until`. */
function broadcasts(calls: RpcCall[]) {
  return calls
    .filter((call) => call.method === "send_tx")
    .map((call) => {
      const params = call.params as { signed_tx_base64: string; wait_until: string };
      const signed = decodeSignedTransaction(Buffer.from(params.signed_tx_base64, "base64"));
      const actions = signed.transaction.actions.map((action) => {
        const { methodName, args, gas, deposit } = action.functionCall!;
        return { method: methodName, args: JSON.parse(Buffer.from(args).toString()) as unknown, gas: BigInt(gas), deposit: BigInt(deposit) };
      });
      const txHash = createHash("sha256").update(signed.transaction.encode()).digest();
      /** Decoding gives the plain borsh shape of the signature, not near-api-js's `Signature` class. */
      const signature = Uint8Array.from((signed.signature as unknown as { ed25519Signature: { data: ArrayLike<number> } }).ed25519Signature.data);
      return { signed, actions, txHash, signature, waitUntil: params.wait_until };
    });
}

async function failure(promise: Promise<unknown>): Promise<Error> {
  const error = await promise.then(() => undefined, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(Error);
  return error as Error;
}

describe("NearWallet setup", () => {
  it("refuses an invalid account ID or a key without its curve prefix", () => {
    const key = KeyPair.fromRandom("ed25519").toString();
    expect(() => new NearWallet({ accountId: "Agent.near", privateKey: key })).toThrow("near.accountId is not a valid NEAR account ID.");
    expect(() => new NearWallet({ accountId: ACCOUNT, privateKey: key.slice("ed25519:".length) })).toThrow("near.privateKey must start with ed25519: or secp256k1:.");
  });

  it("accepts named, implicit and ETH-implicit accounts as recipients, and nothing else", () => {
    const { wallet } = newWallet();
    expect(wallet.address).toBe(ACCOUNT);
    expect(wallet.blockchain).toBe("near");
    expect(wallet.isValidRecipient("merchant.near")).toBe(true);
    expect(wallet.isValidRecipient(DEPOSIT)).toBe(true);
    expect(wallet.isValidRecipient("0x1111111111111111111111111111111111111111")).toBe(true);
    expect(wallet.isValidRecipient("Merchant.near")).toBe(false);
    expect(wallet.isValidRecipient("a")).toBe(false);
    expect(wallet.isValidRecipient("merchant..near")).toBe(false);
    expect(wallet.isValidRecipient("merchant near")).toBe(false);
    expect(wallet.isValidRecipient(`${"a".repeat(61)}.near`)).toBe(false);
  });
});

describe("NearWallet.balance", () => {
  it("reads ft_balance_of for the agent account from the token contract", async () => {
    const calls = nearNode({ tokenBalance: "12345678901234567890123" });
    const { wallet } = newWallet();
    await expect(wallet.balance(USDC_NEAR)).resolves.toBe(12_345_678_901_234_567_890_123n);
    expect(views(calls)).toEqual([`${TOKEN}.ft_balance_of({"account_id":"${ACCOUNT}"})`]);
    expect(calls.every((call) => call.url === RPC_URL)).toBe(true);
  });

  it("refuses an asset that is not a NEP-141 token on NEAR without calling the RPC", async () => {
    const calls = nearNode();
    const { wallet } = newWallet();
    await expect(wallet.balance(NATIVE_NEAR)).rejects.toThrow("NEAR is not a NEP-141 token on NEAR.");
    await expect(wallet.balance(ETH_BASE)).rejects.toThrow("ETH is not a NEP-141 token on NEAR.");
    expect(calls).toEqual([]);
  });
});

describe("NearWallet.transfer", () => {
  it("registers a new deposit address with the token's minimum storage and sends ft_transfer in the same transaction", async () => {
    const calls = nearNode({ registered: false });
    const { wallet, key } = newWallet();
    const result = await wallet.transfer(USDC_NEAR, DEPOSIT, 4_100_000n);

    expect(views(calls)).toEqual([
      `${TOKEN}.storage_balance_of({"account_id":"${DEPOSIT}"})`,
      `${TOKEN}.storage_balance_bounds({})`,
      `view_account(${ACCOUNT})`,
    ]);
    const [sent, ...others] = broadcasts(calls);
    expect(others).toEqual([]);
    expect(sent.waitUntil).toBe("EXECUTED_OPTIMISTIC");
    expect(sent.signed.transaction).toMatchObject({ signerId: ACCOUNT, receiverId: TOKEN, nonce: BigInt(ACCESS_KEY_NONCE + 1) });
    expect(Buffer.from(sent.signed.transaction.blockHash)).toEqual(Buffer.from(baseDecode(BLOCK_HASH)));
    expect(sent.actions).toEqual([
      { method: "storage_deposit", args: { account_id: DEPOSIT, registration_only: true }, gas: CALL_GAS, deposit: STORAGE_MIN },
      { method: "ft_transfer", args: { receiver_id: DEPOSIT, amount: "4100000" }, gas: CALL_GAS, deposit: 1n },
    ]);
    expect(key.verify(sent.txHash, sent.signature)).toBe(true);
    expect(result).toEqual({ hash: baseEncode(sent.txHash) });
    expect(calls.every((call) => call.url === RPC_URL)).toBe(true);
  });

  it("sends only ft_transfer with 1 yoctoNEAR to a deposit address that is already registered", async () => {
    const calls = nearNode({ registered: true });
    const { wallet } = newWallet();
    const result = await wallet.transfer(USDC_NEAR, DEPOSIT, 4_100_000n);

    expect(views(calls)).toEqual([`${TOKEN}.storage_balance_of({"account_id":"${DEPOSIT}"})`, `view_account(${ACCOUNT})`]);
    const [sent] = broadcasts(calls);
    expect(sent.signed.transaction.receiverId).toBe(TOKEN);
    expect(sent.actions).toEqual([{ method: "ft_transfer", args: { receiver_id: DEPOSIT, amount: "4100000" }, gas: CALL_GAS, deposit: 1n }]);
    expect(result.hash).toBe(baseEncode(sent.txHash));
  });

  it("sends an amount above 2^53 base units exactly, as a decimal string, to the asset's own contract", async () => {
    const calls = nearNode({ registered: true });
    const { wallet } = newWallet();
    const amount = 123n * 10n ** 24n + 1n;
    await wallet.transfer(WNEAR, "merchant.near", amount);

    const [sent] = broadcasts(calls);
    expect(sent.signed.transaction.receiverId).toBe("wrap.near");
    expect(sent.actions).toEqual([{ method: "ft_transfer", args: { receiver_id: "merchant.near", amount: "123000000000000000000000001" }, gas: CALL_GAS, deposit: 1n }]);
  });

  it("uses a new nonce for each transfer from the same wallet", async () => {
    const calls = nearNode({ registered: true });
    const { wallet } = newWallet();
    const first = await wallet.transfer(USDC_NEAR, DEPOSIT, 1n);
    const second = await wallet.transfer(USDC_NEAR, DEPOSIT, 1n);

    expect(broadcasts(calls).map((sent) => sent.signed.transaction.nonce)).toEqual([42n, 43n]);
    expect(first.hash).not.toBe(second.hash);
  });

  it("refuses an invalid deposit address with quote_mismatch before calling the RPC", async () => {
    const calls = nearNode();
    const { wallet } = newWallet();
    const error = await failure(wallet.transfer(USDC_NEAR, "Deposit.near", 1n));
    expect(error).toMatchObject({ name: "PaymentError", code: "quote_mismatch", fundsSent: false, message: "The deposit address Deposit.near is not a valid NEAR account." });
    expect(calls).toEqual([]);
  });

  it("refuses native NEAR, which is not a payment coin, before calling the RPC", async () => {
    const calls = nearNode();
    const { wallet } = newWallet();
    await expect(wallet.transfer(NATIVE_NEAR, DEPOSIT, 1n)).rejects.toThrow("NEAR is not a NEP-141 token on NEAR.");
    expect(calls).toEqual([]);
  });
});

describe("NearWallet gas reserve", () => {
  it("sends when exactly 0.01 NEAR is available after storage staking", async () => {
    const storageUsage = 1_000;
    const calls = nearNode({ registered: true, amount: GAS_RESERVE + BigInt(storageUsage) * BYTE_COST, storageUsage });
    const { wallet } = newWallet();
    await wallet.transfer(USDC_NEAR, DEPOSIT, 4_100_000n);
    expect(broadcasts(calls)).toHaveLength(1);
  });

  it("refuses with no_funds and signs nothing when 1 yoctoNEAR less than the 0.01 NEAR reserve is available", async () => {
    const storageUsage = 1_000;
    const calls = nearNode({ registered: true, amount: GAS_RESERVE + BigInt(storageUsage) * BYTE_COST - 1n, storageUsage });
    const { wallet } = newWallet();
    const error = await failure(wallet.transfer(USDC_NEAR, DEPOSIT, 4_100_000n));
    expect(error).toMatchObject({ name: "PaymentError", code: "no_funds", fundsSent: false, message: `${ACCOUNT} needs at least 0.01 NEAR available for gas and token storage.` });
    expect(calls.map((call) => call.method)).not.toContain("send_tx");
    expect(calls.map((call) => call.method)).not.toContain("block");
  });

  it("counts the storage deposit of a new deposit address on top of the reserve", async () => {
    const calls = nearNode({ registered: false, amount: GAS_RESERVE + STORAGE_MIN - 1n });
    const { wallet } = newWallet();
    const error = await failure(wallet.transfer(USDC_NEAR, DEPOSIT, 4_100_000n));
    expect(error).toMatchObject({ code: "no_funds", fundsSent: false });
    expect(error.message).toMatch(/^agent\.near needs at least 0\.011\d* NEAR available for gas and token storage\.$/);
    expect(broadcasts(calls)).toEqual([]);
  });

  it("sends to a new deposit address when the reserve and the storage deposit are both covered", async () => {
    const calls = nearNode({ registered: false, amount: GAS_RESERVE + STORAGE_MIN });
    const { wallet } = newWallet();
    await wallet.transfer(USDC_NEAR, DEPOSIT, 4_100_000n);
    expect(broadcasts(calls)[0].actions.map((action) => action.method)).toEqual(["storage_deposit", "ft_transfer"]);
  });
});

describe("NearWallet errors", () => {
  it("reports transfer_failed with funds sent when the transaction fails on-chain", async () => {
    const calls = nearNode({
      registered: true,
      sendTx: () => ({ result: { status: { Failure: { ActionError: { index: 0, kind: { FunctionCallError: { ExecutionError: "Smart contract panicked: The account doesn't have enough balance" } } } } } } }),
    });
    const { wallet } = newWallet();
    const error = await failure(wallet.transfer(USDC_NEAR, DEPOSIT, 4_100_000n));
    const [sent] = broadcasts(calls);
    expect(error).toMatchObject({ name: "PaymentError", code: "transfer_failed", fundsSent: true, message: `The NEAR transfer ${baseEncode(sent.txHash)} failed on-chain.` });
  });

  it("reports transfer_failed with funds sent and the hash when the RPC rejects the broadcast", async () => {
    const calls = nearNode({
      registered: true,
      sendTx: () => ({ error: { code: -32000, message: "Server error", data: "Transaction nonce 42 must be larger than nonce of the used access key 42" } }),
    });
    const { wallet } = newWallet();
    const error = await failure(wallet.transfer(USDC_NEAR, DEPOSIT, 4_100_000n));
    const [sent] = broadcasts(calls);
    expect(error).toBeInstanceOf(PaymentError);
    expect(error).toMatchObject({ code: "transfer_failed", fundsSent: true });
    expect(error.message.startsWith(`The NEAR transfer ${baseEncode(sent.txHash)} was not accepted: `)).toBe(true);
  });

  it("returns the hash when the RPC gives no answer to the broadcast within 60 s", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const hanging = hangingReply();
    const calls = nearNode({ registered: true, sendTx: hanging.reply });
    const { wallet } = newWallet();
    const transfer = wallet.transfer(USDC_NEAR, DEPOSIT, 4_100_000n);
    await hanging.reached;
    await vi.advanceTimersByTimeAsync(59_999);
    let settled = false;
    void transfer.finally(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(transfer).resolves.toEqual({ hash: baseEncode(broadcasts(calls)[0].txHash) });
  });

  it("fails before signing, with the RPC's own error, when a view call is refused", async () => {
    const calls = nearNode({ views: { storage_balance_of: () => ({ error: { code: -32000, message: "Server error", data: "Contract method is not found" } }) } });
    const { wallet } = newWallet();
    const error = await failure(wallet.transfer(USDC_NEAR, DEPOSIT, 4_100_000n));
    expect(error).not.toBeInstanceOf(PaymentError);
    expect(calls.map((call) => call.method)).toEqual(["query"]);
  });

  it("times out a view call after requestTimeoutMs and sends nothing", async () => {
    const hanging = hangingReply();
    const calls = nearNode({ views: { storage_balance_of: hanging.reply } });
    const { wallet } = newWallet(50);
    const error = await failure(wallet.transfer(USDC_NEAR, DEPOSIT, 4_100_000n));
    expect(error).toBeInstanceOf(TimeoutError);
    expect(error.message).toMatch(/^NEAR storage_balance_of did not finish within \d+ s\.$/);
    expect(broadcasts(calls)).toEqual([]);
  });

  it("times out the account lookup after requestTimeoutMs and sends nothing", async () => {
    const hanging = hangingReply();
    const calls = stubJsonRpc((method, params) =>
      (params as { request_type?: string }).request_type === "view_account" ? hanging.reply() : method === "query" ? viewResult({ total: "1", available: "0" }) : { error: { code: -32601, message: method } },
    );
    const { wallet } = newWallet(50);
    const error = await failure(wallet.transfer(USDC_NEAR, DEPOSIT, 4_100_000n));
    expect(error).toBeInstanceOf(TimeoutError);
    expect(error.message).toContain("NEAR account lookup");
    expect(calls.map((call) => call.method)).not.toContain("send_tx");
  });

  it("retries a view call once after HTTP 503 and then completes the transfer", async () => {
    let unavailable = 1;
    const calls = nearNode({
      registered: true,
      views: { storage_balance_of: () => (unavailable-- > 0 ? new Response("busy", { status: 503 }) : viewResult({ total: "1", available: "0" })) },
    });
    const { wallet } = newWallet();
    await wallet.transfer(USDC_NEAR, DEPOSIT, 4_100_000n);
    expect(views(calls).filter((view) => view.includes("storage_balance_of"))).toHaveLength(2);
    expect(broadcasts(calls)).toHaveLength(1);
  });

  it("gives up after a second HTTP 503 and sends nothing", async () => {
    const calls = nearNode({ views: { storage_balance_of: () => new Response("busy", { status: 503 }) } });
    const { wallet } = newWallet();
    const error = await failure(wallet.transfer(USDC_NEAR, DEPOSIT, 4_100_000n));
    expect(error.message).toBe(`${RPC_URL} unavailable`);
    expect(views(calls)).toHaveLength(2);
    expect(broadcasts(calls)).toEqual([]);
  });
});
