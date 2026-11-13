import { decodeFunctionData, encodeFunctionResult, erc20Abi, getAddress, keccak256, parseTransaction, recoverTransactionAddress, toHex, zeroAddress, type Hex, type TransactionSerialized } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WalletAsset } from "../src/assets.js";
import { BaseWallet } from "../src/chains/base.js";
import { PaymentError } from "../src/errors.js";
import { ETH_BASE, USDC_BASE, USDC_NEAR, hangingReply, stubJsonRpc, type RpcCall, type RpcReply } from "./fixtures.js";

/** viem sends to the parsed URL, which gains a trailing slash. */
const RPC_URL = "https://rpc.base.test";
const RPC_HREF = new URL(RPC_URL).href;
const BASE_CHAIN_ID = 8453;
/** A 1Click deposit address as the gateway returns it, in lowercase. */
const DEPOSIT = "0x9f2d7048e5a1c6b3d9f2e7048a5c1b6d3e9f2074";
const TOKEN = getAddress(USDC_BASE.contract_address as string);
const NONCE = 7;
const ESTIMATED_GAS = 65_000n;
const BLOCK_HASH = `0x${"ab".repeat(32)}` as Hex;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

interface NodeState {
  ethBalance: bigint;
  tokenBalance: bigint;
  estimateGas: () => RpcReply | Promise<RpcReply>;
  /** Answer to `eth_sendRawTransaction`; the default accepts and returns the transaction hash. */
  sendRaw: (raw: Hex) => RpcReply | Promise<RpcReply>;
  /** Answer to `eth_getTransactionReceipt`; the default is a successful receipt. */
  receipt: (hash: Hex) => RpcReply | Promise<RpcReply>;
  getTransaction: () => RpcReply | Promise<RpcReply>;
}

const receiptOf = (hash: Hex, status: "0x1" | "0x0"): RpcReply => ({
  result: {
    transactionHash: hash,
    transactionIndex: "0x0",
    blockHash: BLOCK_HASH,
    blockNumber: "0x64",
    from: zeroAddress,
    to: TOKEN,
    cumulativeGasUsed: toHex(ESTIMATED_GAS),
    gasUsed: toHex(ESTIMATED_GAS),
    effectiveGasPrice: "0x1e8480",
    contractAddress: null,
    logs: [],
    logsBloom: `0x${"0".repeat(512)}`,
    status,
    type: "0x2",
  },
});

/** A Base RPC node without `eth_fillTransaction`, as most public nodes are; every request is recorded. */
function baseNode(overrides: Partial<NodeState> = {}) {
  const state: NodeState = {
    ethBalance: 0n,
    tokenBalance: 0n,
    estimateGas: () => ({ result: toHex(ESTIMATED_GAS) }),
    sendRaw: (raw) => ({ result: keccak256(raw) }),
    receipt: (hash) => receiptOf(hash, "0x1"),
    getTransaction: () => ({ result: null }),
    ...overrides,
  };
  const calls = stubJsonRpc((method, params) => {
    const args = params as unknown[];
    switch (method) {
      case "eth_fillTransaction":
        return { error: { code: -32601, message: "the method eth_fillTransaction does not exist/is not available" } };
      case "eth_chainId":
        return { result: toHex(BASE_CHAIN_ID) };
      case "eth_getTransactionCount":
        return { result: toHex(NONCE) };
      case "eth_getBlockByNumber":
        return { result: { number: "0x64", hash: BLOCK_HASH, parentHash: BLOCK_HASH, timestamp: "0x6553f100", baseFeePerGas: "0xf4240", gasLimit: "0x1c9c380", gasUsed: "0x0", transactions: [] } };
      case "eth_maxPriorityFeePerGas":
        return { result: "0xf4240" };
      case "eth_estimateGas":
        return state.estimateGas();
      case "eth_sendRawTransaction":
        return state.sendRaw(args[0] as Hex);
      case "eth_getTransactionReceipt":
        return state.receipt(args[0] as Hex);
      case "eth_getTransactionByHash":
        return state.getTransaction();
      case "eth_blockNumber":
        return { result: "0x64" };
      case "eth_getBalance":
        return { result: toHex(state.ethBalance) };
      case "eth_call":
        return { result: encodeFunctionResult({ abi: erc20Abi, functionName: "balanceOf", result: state.tokenBalance }) };
      default:
        return { error: { code: -32601, message: `Method not found: ${method}` } };
    }
  });
  return calls;
}

function newWallet(requestTimeoutMs?: number) {
  return { wallet: new BaseWallet({ privateKey: generatePrivateKey(), rpcUrl: RPC_URL, requestTimeoutMs }) };
}

/** An `eth_sendRawTransaction` answer that accepts the transaction; `reached` resolves once it is sent. */
function acceptedBroadcast() {
  let markReached = () => {};
  const reached = new Promise<void>((resolve) => (markReached = resolve));
  return { reached, sendRaw: (raw: Hex): RpcReply => (markReached(), { result: keccak256(raw) }) };
}

/** The raw transactions sent with `eth_sendRawTransaction`, in order. */
const rawSent = (calls: RpcCall[]) => calls.filter((call) => call.method === "eth_sendRawTransaction").map((call) => (call.params as TransactionSerialized[])[0]);

async function failure(promise: Promise<unknown>): Promise<PaymentError> {
  const error = await promise.then(() => undefined, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(PaymentError);
  return error as PaymentError;
}

describe("BaseWallet setup", () => {
  it("refuses a private key that is not 32 bytes of hex", () => {
    expect(() => new BaseWallet({ privateKey: "0x1234" })).toThrow("base.privateKey must be a 32-byte hex private key.");
    expect(() => new BaseWallet({ privateKey: `0x${"g".repeat(64)}` })).toThrow("base.privateKey must be a 32-byte hex private key.");
  });

  it("takes the key with or without 0x and uses its address", () => {
    const privateKey = generatePrivateKey();
    const expected = privateKeyToAccount(privateKey).address;
    expect(new BaseWallet({ privateKey }).address).toBe(expected);
    expect(new BaseWallet({ privateKey: privateKey.slice(2) }).address).toBe(expected);
  });

  it("accepts any well-formed address except the zero address as a recipient", () => {
    const { wallet } = newWallet();
    expect(wallet.blockchain).toBe("base");
    expect(wallet.isValidRecipient(DEPOSIT)).toBe(true);
    expect(wallet.isValidRecipient(getAddress(DEPOSIT))).toBe(true);
    expect(wallet.isValidRecipient(zeroAddress)).toBe(false);
    expect(wallet.isValidRecipient("0x1234")).toBe(false);
    expect(wallet.isValidRecipient("merchant.near")).toBe(false);
  });
});

describe("BaseWallet.balance", () => {
  it("reads the native ETH balance of the agent address", async () => {
    const calls = baseNode({ ethBalance: 1_500_000_000_000_000_000n });
    const { wallet } = newWallet();
    await expect(wallet.balance(ETH_BASE)).resolves.toBe(1_500_000_000_000_000_000n);
    expect(calls.map((call) => [call.method, call.params])).toEqual([["eth_getBalance", [wallet.address, "latest"]]]);
    expect(calls[0].url).toBe(RPC_HREF);
  });

  it("reads balanceOf of the agent address from the ERC-20 contract", async () => {
    const calls = baseNode({ tokenBalance: 12_345_678n });
    const { wallet } = newWallet();
    await expect(wallet.balance(USDC_BASE)).resolves.toBe(12_345_678n);
    const [{ method, params }] = calls;
    const [request] = params as [{ to: Hex; data: Hex }];
    expect(method).toBe("eth_call");
    expect(getAddress(request.to)).toBe(TOKEN);
    expect(decodeFunctionData({ abi: erc20Abi, data: request.data })).toEqual({ functionName: "balanceOf", args: [wallet.address] });
  });

  it("refuses an asset from another chain or with a malformed contract address without calling the RPC", async () => {
    const calls = baseNode();
    const { wallet } = newWallet();
    await expect(wallet.balance(USDC_NEAR)).rejects.toThrow("USDC is not a Base asset.");
    const broken: WalletAsset = { ...USDC_BASE, contract_address: "0x1234" };
    await expect(wallet.balance(broken)).rejects.toThrow("USDC has an invalid Base contract address.");
    expect(calls).toEqual([]);
  });
});

describe("BaseWallet.transfer", () => {
  it("signs an ERC-20 transfer of the exact amount to the checksummed deposit address on chain 8453", async () => {
    const calls = baseNode();
    const { wallet } = newWallet();
    const result = await wallet.transfer(USDC_BASE, DEPOSIT, 4_100_000n);

    const [raw, ...others] = rawSent(calls);
    expect(others).toEqual([]);
    const tx = parseTransaction(raw);
    expect(tx).toMatchObject({ type: "eip1559", chainId: BASE_CHAIN_ID, nonce: NONCE, to: TOKEN.toLowerCase(), gas: ESTIMATED_GAS });
    expect(tx.value ?? 0n).toBe(0n);
    expect(decodeFunctionData({ abi: erc20Abi, data: tx.data! })).toEqual({ functionName: "transfer", args: [getAddress(DEPOSIT), 4_100_000n] });
    expect(await recoverTransactionAddress({ serializedTransaction: raw })).toBe(wallet.address);
    expect(result).toEqual({ hash: keccak256(raw) });
    expect(calls.filter((call) => call.method === "eth_getTransactionReceipt").map((call) => call.params)).toEqual([[keccak256(raw)]]);
    expect(calls.every((call) => call.url === RPC_HREF)).toBe(true);
  });

  it("sends native ETH as a plain value transfer to the deposit address", async () => {
    const calls = baseNode();
    const { wallet } = newWallet();
    const amount = 1_234_567_890_123_456_789n;
    const result = await wallet.transfer(ETH_BASE, DEPOSIT, amount);

    const [raw] = rawSent(calls);
    const tx = parseTransaction(raw);
    expect(tx).toMatchObject({ chainId: BASE_CHAIN_ID, to: DEPOSIT, value: amount });
    expect(tx.data).toBeUndefined();
    expect(result.hash).toBe(keccak256(raw));
  });

  it("refuses an invalid or zero deposit address with quote_mismatch before calling the RPC", async () => {
    const calls = baseNode();
    const { wallet } = newWallet();
    expect(await failure(wallet.transfer(USDC_BASE, "0x1234", 1n))).toMatchObject({ code: "quote_mismatch", fundsSent: false, message: "The deposit address 0x1234 is not a valid Base address." });
    expect(await failure(wallet.transfer(USDC_BASE, zeroAddress, 1n))).toMatchObject({ code: "quote_mismatch", fundsSent: false });
    expect(calls).toEqual([]);
  });

  it("reports transfer_failed with funds sent when the transaction reverts", async () => {
    const calls = baseNode({ receipt: (hash) => receiptOf(hash, "0x0") });
    const { wallet } = newWallet();
    const error = await failure(wallet.transfer(USDC_BASE, DEPOSIT, 4_100_000n));
    expect(error).toMatchObject({ code: "transfer_failed", fundsSent: true, message: `The Base transfer ${keccak256(rawSent(calls)[0])} reverted.` });
  });

  it("reports transfer_failed without funds sent, and broadcasts nothing, when the transaction cannot be prepared", async () => {
    const calls = baseNode({ estimateGas: () => ({ error: { code: 3, message: "execution reverted: ERC20: transfer amount exceeds balance", data: "0x" } }) });
    const { wallet } = newWallet();
    const error = await failure(wallet.transfer(USDC_BASE, DEPOSIT, 4_100_000n));
    expect(error).toMatchObject({ code: "transfer_failed", fundsSent: false });
    expect(error.message.startsWith("The Base transfer could not be prepared: ")).toBe(true);
    expect(rawSent(calls)).toEqual([]);
  });

  it("reports transfer_failed without funds sent when the RPC does not answer within requestTimeoutMs", async () => {
    const hanging = hangingReply();
    const calls = stubJsonRpc(hanging.reply);
    const { wallet } = newWallet(50);
    const error = await failure(wallet.transfer(USDC_BASE, DEPOSIT, 4_100_000n));
    expect(error).toMatchObject({ code: "transfer_failed", fundsSent: false });
    expect(error.message.startsWith("The Base transfer could not be prepared: ")).toBe(true);
    expect(rawSent(calls)).toEqual([]);
  });

  it("checks inclusion and returns the hash when the broadcast fails after the node may have accepted it", async () => {
    const calls = baseNode({ sendRaw: () => new Response("upstream error", { status: 502 }) });
    const { wallet } = newWallet();
    const result = await wallet.transfer(USDC_BASE, DEPOSIT, 4_100_000n);
    const [raw, ...resent] = rawSent(calls);
    expect(resent).toEqual([]);
    expect(result).toEqual({ hash: keccak256(raw) });
  });

  it("returns the hash when the node already knows the transaction", async () => {
    const calls = baseNode({ sendRaw: () => ({ error: { code: -32000, message: "already known" } }) });
    const { wallet } = newWallet();
    const result = await wallet.transfer(USDC_BASE, DEPOSIT, 4_100_000n);
    expect(result).toEqual({ hash: keccak256(rawSent(calls)[0]) });
  });

  it("reports no_funds without funds sent when the node refuses the broadcast for insufficient funds", async () => {
    const calls = baseNode({ sendRaw: () => ({ error: { code: -32000, message: "insufficient funds for gas * price + value: balance 0, tx cost 1" } }) });
    const { wallet } = newWallet();
    const error = await failure(wallet.transfer(USDC_BASE, DEPOSIT, 4_100_000n));
    expect(error).toMatchObject({ code: "no_funds", fundsSent: false, message: `${wallet.address} does not have enough ETH on Base for this transfer and its gas.` });
    expect(calls.map((call) => call.method)).toContain("eth_getTransactionByHash");
    expect(calls.map((call) => call.method)).not.toContain("eth_getTransactionReceipt");
  });

  it("reports transfer_failed without funds sent when the node refuses the broadcast and does not hold it", async () => {
    const calls = baseNode({ sendRaw: () => ({ error: { code: -32000, message: "nonce too low: next nonce 8, tx nonce 7" } }) });
    const { wallet } = newWallet();
    const error = await failure(wallet.transfer(USDC_BASE, DEPOSIT, 4_100_000n));
    expect(error).toMatchObject({ code: "transfer_failed", fundsSent: false, message: "The Base node refused the transfer: nonce too low: next nonce 8, tx nonce 7" });
    expect(calls.map((call) => call.method)).not.toContain("eth_getTransactionReceipt");
  });

  it("checks inclusion when the node refuses the broadcast but the lookup of the hash cannot tell", async () => {
    const calls = baseNode({
      sendRaw: () => ({ error: { code: -32000, message: "insufficient funds for gas * price + value" } }),
      getTransaction: () => ({ error: { code: -32000, message: "header not found" } }),
    });
    const { wallet } = newWallet();
    const result = await wallet.transfer(USDC_BASE, DEPOSIT, 4_100_000n);
    expect(result).toEqual({ hash: keccak256(rawSent(calls)[0]) });
  });

  it("returns the hash when no receipt appears within 60 s", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const sent = acceptedBroadcast();
    const calls = baseNode({ sendRaw: sent.sendRaw, receipt: () => ({ result: null }) });
    const { wallet } = newWallet();
    let settled = false;
    const transfer = wallet.transfer(USDC_BASE, DEPOSIT, 4_100_000n).finally(() => (settled = true));
    await sent.reached;
    await vi.advanceTimersByTimeAsync(59_000);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(transfer).resolves.toEqual({ hash: keccak256(rawSent(calls)[0]) });
  });

  it("reports transfer_failed with funds sent when the inclusion check itself fails", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const sent = acceptedBroadcast();
    const calls = baseNode({
      sendRaw: sent.sendRaw,
      receipt: () => ({ result: null }),
      getTransaction: () => ({ error: { code: -32000, message: "header not found" } }),
    });
    const { wallet } = newWallet();
    const transfer = failure(wallet.transfer(USDC_BASE, DEPOSIT, 4_100_000n));
    await sent.reached;
    await vi.advanceTimersByTimeAsync(20_000);
    const error = await transfer;
    expect(error).toMatchObject({ code: "transfer_failed", fundsSent: true });
    expect(error.message.startsWith(`The Base transfer ${keccak256(rawSent(calls)[0])} could not be confirmed: `)).toBe(true);
  });
});
