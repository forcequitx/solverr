import { base58 } from "@scure/base";
import { encodeAbiParameters, encodeEventTopics, erc20Abi, numberToHex, type Address, type Hex } from "viem";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getChain, type ChainInfo } from "@/lib/chains/registry";
import type * as Onchain from "@/lib/transfers/onchain";

type Expected = Parameters<typeof Onchain.checkDirectTransfer>[0];
type RpcCall = { url: string; method: string; params: unknown };
type RpcReply = { result?: unknown; error?: unknown } | Response;

/** Every JSON-RPC request (viem's EVM transport, NEAR and Solana) is answered here by method name; an unexpected method fails the test. */
const rpc = { calls: [] as RpcCall[], handlers: new Map<string, (params: unknown) => RpcReply>() };

/** viem caches the block number per client for 4 s, so each test loads fresh modules and gets its own EVM client. */
beforeEach(() => {
  vi.resetModules();
  rpc.calls.length = 0;
  rpc.handlers.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { id: number; method: string; params: unknown };
      rpc.calls.push({ url: String(input), method: request.method, params: request.params });
      const handler = rpc.handlers.get(request.method);
      if (!handler) throw new Error(`Unexpected RPC method ${request.method}`);
      const reply = handler(request.params);
      return reply instanceof Response ? reply : Response.json({ jsonrpc: "2.0", id: request.id, ...reply });
    }),
  );
});

const load = (): Promise<typeof Onchain> => import("@/lib/transfers/onchain");

/** Compiles the module and its chain clients once, so their cold first import does not count against the first test's timeout. */
beforeAll(async () => {
  await load();
});

const methods = () => rpc.calls.map((call) => call.method);

const NOT_BEFORE = new Date("2026-11-11T10:00:00Z");
const AFTER_SECONDS = NOT_BEFORE.getTime() / 1000 + 300;

const MISMATCH = { state: "failed", reason: "The transaction does not send the transfer amount from your payout wallet to the recipient." };
const NOT_A_HASH = { state: "failed", reason: "This is not a transaction on the transfer's network." };
const TOO_OLD = { state: "failed", reason: "The transaction was made before this transfer existed, so it is not this transfer's transaction." };
const TX_FAILED = { state: "failed", reason: "The transaction failed on the network, so nothing was sent." };

describe("checkDirectTransfer on EVM", () => {
  const BASE = getChain("base")!;
  const TX_HASH: Hex = `0x${"ab".repeat(32)}`;
  const BLOCK_HASH: Hex = `0x${"cd".repeat(32)}`;
  const BLOCK = 100n;
  const USDC: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  const PAYOUT_WALLET: Address = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
  const RECIPIENT: Address = "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359";
  const OTHER: Address = "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB";
  const BUNDLER: Address = "0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb";

  const expected = (overrides: Partial<Expected> = {}): Expected => ({
    chain: BASE,
    tokenContract: USDC,
    from: PAYOUT_WALLET,
    to: RECIPIENT,
    amountBase: 25_000_000n,
    txHash: TX_HASH,
    notBefore: NOT_BEFORE,
    ...overrides,
  });

  /** An ERC-20 Transfer event log, encoded as a node returns it. */
  const transferLog = (token: Address, from: Address, to: Address, value: bigint) => ({
    address: token.toLowerCase(),
    topics: encodeEventTopics({ abi: erc20Abi, eventName: "Transfer", args: { from, to } }),
    data: encodeAbiParameters([{ type: "uint256" }], [value]),
    blockNumber: numberToHex(BLOCK),
    blockHash: BLOCK_HASH,
    transactionHash: TX_HASH,
    transactionIndex: "0x0",
    logIndex: "0x0",
    removed: false,
  });

  /** Answers for a transaction mined in block 100 at `blockSeconds`, with the chain head at `head`. */
  function chainState(input: { status?: "0x1" | "0x0"; sender?: Address; to: Address; logs?: object[]; value?: bigint; head?: bigint; blockSeconds?: number }) {
    const sender = (input.sender ?? PAYOUT_WALLET).toLowerCase();
    rpc.handlers.set("eth_getTransactionReceipt", () => ({
      result: {
        transactionHash: TX_HASH,
        transactionIndex: "0x0",
        blockHash: BLOCK_HASH,
        blockNumber: numberToHex(BLOCK),
        from: sender,
        to: input.to.toLowerCase(),
        cumulativeGasUsed: "0x5208",
        gasUsed: "0x5208",
        effectiveGasPrice: "0x3b9aca00",
        contractAddress: null,
        logs: input.logs ?? [],
        logsBloom: `0x${"00".repeat(256)}`,
        status: input.status ?? "0x1",
        type: "0x2",
      },
    }));
    rpc.handlers.set("eth_blockNumber", () => ({ result: numberToHex(input.head ?? BLOCK + 2n) }));
    rpc.handlers.set("eth_getBlockByNumber", () => ({
      result: { number: numberToHex(BLOCK), hash: BLOCK_HASH, timestamp: numberToHex(input.blockSeconds ?? AFTER_SECONDS), transactions: [] },
    }));
    rpc.handlers.set("eth_getTransactionByHash", () => ({
      result: {
        hash: TX_HASH,
        blockHash: BLOCK_HASH,
        blockNumber: numberToHex(BLOCK),
        transactionIndex: "0x0",
        from: sender,
        to: input.to.toLowerCase(),
        value: numberToHex(input.value ?? 0n),
        nonce: "0x7",
        gas: "0x5208",
        gasPrice: "0x3b9aca00",
        input: "0x",
        type: "0x0",
        v: "0x1b",
        r: `0x${"11".repeat(32)}`,
        s: `0x${"22".repeat(32)}`,
      },
    }));
  }

  it("confirms an ERC-20 transfer with 3 confirmations, the right sender, recipient and amount", async () => {
    chainState({ to: USDC, logs: [transferLog(USDC, PAYOUT_WALLET, RECIPIENT, 25_000_000n)] });
    const { checkDirectTransfer } = await load();
    expect(await checkDirectTransfer(expected())).toEqual({ state: "confirmed" });
    expect(methods()).toEqual(["eth_getTransactionReceipt", "eth_blockNumber", "eth_getBlockByNumber"]);
    expect(rpc.calls[0].params).toEqual([TX_HASH]);
    expect(rpc.calls[2].params).toEqual([numberToHex(BLOCK), false]);
  });

  it("confirms a token transfer sent through a bundler, proved by its Transfer event alone", async () => {
    chainState({ sender: BUNDLER, to: OTHER, logs: [transferLog(USDC, PAYOUT_WALLET, RECIPIENT, 30_000_000n)] });
    const { checkDirectTransfer } = await load();
    expect(await checkDirectTransfer(expected())).toEqual({ state: "confirmed" });
  });

  it("waits while the transaction has fewer than 3 confirmations", async () => {
    chainState({ to: USDC, logs: [transferLog(USDC, PAYOUT_WALLET, RECIPIENT, 25_000_000n)], head: BLOCK + 1n });
    const { checkDirectTransfer } = await load();
    expect(await checkDirectTransfer(expected())).toEqual({ state: "pending" });
    expect(methods()).toEqual(["eth_getTransactionReceipt", "eth_blockNumber"]);
  });

  it("waits while the network has no receipt for the hash", async () => {
    rpc.handlers.set("eth_getTransactionReceipt", () => ({ result: null }));
    const { checkDirectTransfer } = await load();
    expect(await checkDirectTransfer(expected())).toEqual({ state: "pending" });
  });

  it("fails a reverted transaction", async () => {
    chainState({ status: "0x0", to: USDC });
    const { checkDirectTransfer } = await load();
    expect(await checkDirectTransfer(expected())).toEqual(TX_FAILED);
  });

  it("refuses a token transfer from another sender, to another recipient, of another token or of less", async () => {
    const wrongLogs = [
      transferLog(USDC, OTHER, RECIPIENT, 25_000_000n),
      transferLog(USDC, PAYOUT_WALLET, OTHER, 25_000_000n),
      transferLog(OTHER, PAYOUT_WALLET, RECIPIENT, 25_000_000n),
      transferLog(USDC, PAYOUT_WALLET, RECIPIENT, 24_999_999n),
    ];
    chainState({ to: USDC, logs: wrongLogs });
    const { checkDirectTransfer } = await load();
    expect(await checkDirectTransfer(expected())).toEqual(MISMATCH);
  });

  it("refuses a transaction mined more than a minute before the transfer existed", async () => {
    chainState({ to: USDC, logs: [transferLog(USDC, PAYOUT_WALLET, RECIPIENT, 25_000_000n)], blockSeconds: NOT_BEFORE.getTime() / 1000 - 61 });
    const { checkDirectTransfer } = await load();
    expect(await checkDirectTransfer(expected())).toEqual(TOO_OLD);
  });

  it("allows a block clock up to a minute behind the server", async () => {
    chainState({ to: USDC, logs: [transferLog(USDC, PAYOUT_WALLET, RECIPIENT, 25_000_000n)], blockSeconds: NOT_BEFORE.getTime() / 1000 - 59 });
    const { checkDirectTransfer } = await load();
    expect(await checkDirectTransfer(expected())).toEqual({ state: "confirmed" });
  });

  it("confirms a native transfer by the transaction's sender, recipient and value", async () => {
    chainState({ to: RECIPIENT, value: 10n ** 16n });
    const { checkDirectTransfer } = await load();
    expect(await checkDirectTransfer(expected({ tokenContract: null, amountBase: 10n ** 16n }))).toEqual({ state: "confirmed" });
    expect(methods()).toEqual(["eth_getTransactionReceipt", "eth_blockNumber", "eth_getBlockByNumber", "eth_getTransactionByHash"]);
  });

  it("refuses a native transfer from another sender, to another recipient or of less", async () => {
    const native = expected({ tokenContract: null, amountBase: 10n ** 16n });
    chainState({ sender: OTHER, to: RECIPIENT, value: 10n ** 16n });
    expect(await (await load()).checkDirectTransfer(native)).toEqual(MISMATCH);
    expect(methods()).not.toContain("eth_getTransactionByHash");

    vi.resetModules();
    chainState({ to: OTHER, value: 10n ** 16n });
    expect(await (await load()).checkDirectTransfer(native)).toEqual(MISMATCH);

    vi.resetModules();
    chainState({ to: RECIPIENT, value: 10n ** 16n - 1n });
    expect(await (await load()).checkDirectTransfer(native)).toEqual(MISMATCH);
  });

  it("refuses a hash that is not an EVM transaction hash without asking the network", async () => {
    const { checkDirectTransfer } = await load();
    expect(await checkDirectTransfer(expected({ txHash: "0x1234" }))).toEqual(NOT_A_HASH);
    expect(rpc.calls).toEqual([]);
  });

  it("refuses an EVM network it has no client for", async () => {
    const { checkDirectTransfer } = await load();
    const unknown: ChainInfo = { ...BASE, name: "Unknown EVM", evmChainId: 1_234_567 };
    expect(await checkDirectTransfer(expected({ chain: unknown }))).toEqual({ state: "failed", reason: "Transactions on Unknown EVM cannot be checked." });
    expect(rpc.calls).toEqual([]);
  });

  it("throws on an RPC error instead of treating it as pending", async () => {
    rpc.handlers.set("eth_getTransactionReceipt", () => ({ error: { code: -32602, message: "invalid argument 0" } }));
    const { checkDirectTransfer } = await load();
    await expect(checkDirectTransfer(expected())).rejects.toThrow("invalid argument 0");
  });
});

describe("isContractWallet", () => {
  const BASE = getChain("base")!;
  const WALLET: Address = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";

  it("tells a deployed contract from a key-held account and an EIP-7702 delegated account", async () => {
    let code = "0x";
    rpc.handlers.set("eth_getCode", () => ({ result: code }));
    const { isContractWallet } = await load();
    expect(await isContractWallet(BASE, WALLET)).toBe(false);
    code = "0x6080604052";
    expect(await isContractWallet(BASE, WALLET)).toBe(true);
    code = `0xef0100${"12".repeat(20)}`;
    expect(await isContractWallet(BASE, WALLET)).toBe(false);
    expect(rpc.calls[0].params).toEqual([WALLET, "latest"]);
  });

  it("answers false on a network that is not EVM without asking any network", async () => {
    const { isContractWallet } = await load();
    expect(await isContractWallet(getChain("sol")!, WALLET)).toBe(false);
    expect(rpc.calls).toEqual([]);
  });
});

describe("checkDirectTransfer on Solana", () => {
  const SOLANA = getChain("sol")!;
  const SIGNATURE = base58.encode(new Uint8Array(64).fill(7));
  const PAYOUT_WALLET = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
  const RECIPIENT = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
  const OTHER = "HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH";
  const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const SYSTEM_PROGRAM = "11111111111111111111111111111111";

  const expected = (overrides: Partial<Expected> = {}): Expected => ({
    chain: SOLANA,
    tokenContract: USDC_MINT,
    from: PAYOUT_WALLET,
    to: RECIPIENT,
    amountBase: 25_000_000n,
    txHash: SIGNATURE,
    notBefore: NOT_BEFORE,
    ...overrides,
  });

  const key = (pubkey: string, signer: boolean) => ({ pubkey, signer, writable: true, source: "transaction" });
  const tokenBalance = (accountIndex: number, owner: string, amount: string, mint = USDC_MINT) => ({ accountIndex, mint, owner, uiTokenAmount: { amount } });

  /** A finalized `getTransaction` answer in the jsonParsed encoding. */
  const transaction = (meta: object, keys = [key(PAYOUT_WALLET, true), key(RECIPIENT, false), key(SYSTEM_PROGRAM, false)], blockTime: number | null = AFTER_SECONDS) => ({
    blockTime,
    meta: { err: null, preBalances: [5_000_000_000, 1_000_000_000, 1], postBalances: [5_000_000_000, 1_000_000_000, 1], ...meta },
    transaction: { message: { accountKeys: keys } },
  });

  const answer = (result: unknown) => rpc.handlers.set("getTransaction", () => ({ result }));

  it("confirms a finalized token transfer by the recipient's balance change", async () => {
    answer(
      transaction({
        preTokenBalances: [tokenBalance(3, PAYOUT_WALLET, "100000000"), tokenBalance(4, RECIPIENT, "5000000")],
        postTokenBalances: [tokenBalance(3, PAYOUT_WALLET, "75000000"), tokenBalance(4, RECIPIENT, "30000000")],
      }),
    );
    const { checkDirectTransfer } = await load();
    expect(await checkDirectTransfer(expected())).toEqual({ state: "confirmed" });
    expect(rpc.calls).toEqual([
      {
        url: "https://solana-rpc.invalid",
        method: "getTransaction",
        params: [SIGNATURE, { commitment: "finalized", encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }],
      },
    ]);
  });

  it("counts a token account the transaction created as starting from zero", async () => {
    answer(transaction({ preTokenBalances: [], postTokenBalances: [tokenBalance(4, RECIPIENT, "25000000")] }));
    const { checkDirectTransfer } = await load();
    expect(await checkDirectTransfer(expected())).toEqual({ state: "confirmed" });
  });

  it("refuses a token transfer of less, of another mint or to another owner", async () => {
    const { checkDirectTransfer } = await load();
    answer(transaction({ preTokenBalances: [], postTokenBalances: [tokenBalance(4, RECIPIENT, "24999999")] }));
    expect(await checkDirectTransfer(expected())).toEqual(MISMATCH);
    answer(transaction({ preTokenBalances: [], postTokenBalances: [tokenBalance(4, RECIPIENT, "25000000", OTHER)] }));
    expect(await checkDirectTransfer(expected())).toEqual(MISMATCH);
    answer(transaction({ preTokenBalances: [], postTokenBalances: [tokenBalance(4, OTHER, "25000000")] }));
    expect(await checkDirectTransfer(expected())).toEqual(MISMATCH);
  });

  it("refuses a transaction the payout wallet did not sign", async () => {
    const received = { preTokenBalances: [], postTokenBalances: [tokenBalance(4, RECIPIENT, "25000000")] };
    answer(transaction(received, [key(OTHER, true), key(PAYOUT_WALLET, false), key(RECIPIENT, false)]));
    const { checkDirectTransfer } = await load();
    expect(await checkDirectTransfer(expected())).toEqual(MISMATCH);
  });

  it("confirms a native SOL transfer by the recipient's lamport change", async () => {
    answer(transaction({ preBalances: [5_000_000_000, 1_000_000_000, 1], postBalances: [2_499_995_000, 3_500_000_000, 1] }));
    const { checkDirectTransfer } = await load();
    expect(await checkDirectTransfer(expected({ tokenContract: null, amountBase: 2_500_000_000n }))).toEqual({ state: "confirmed" });
    expect(await checkDirectTransfer(expected({ tokenContract: null, amountBase: 2_500_000_001n }))).toEqual(MISMATCH);
  });

  it("refuses a native transfer whose recipient is not in the transaction", async () => {
    answer(transaction({}, [key(PAYOUT_WALLET, true), key(OTHER, false)]));
    const { checkDirectTransfer } = await load();
    expect(await checkDirectTransfer(expected({ tokenContract: null, amountBase: 1n }))).toEqual(MISMATCH);
  });

  it("waits while the transaction is not finalized", async () => {
    const { checkDirectTransfer } = await load();
    answer(null);
    expect(await checkDirectTransfer(expected())).toEqual({ state: "pending" });
    answer({ ...transaction({}), meta: null });
    expect(await checkDirectTransfer(expected())).toEqual({ state: "pending" });
  });

  it("fails a transaction that failed on the network", async () => {
    answer(transaction({ err: { InstructionError: [0, { Custom: 1 }] } }));
    const { checkDirectTransfer } = await load();
    expect(await checkDirectTransfer(expected())).toEqual(TX_FAILED);
  });

  it("refuses a transaction older than the transfer, and skips the age check without a block time", async () => {
    const received = { preTokenBalances: [], postTokenBalances: [tokenBalance(4, RECIPIENT, "25000000")] };
    const { checkDirectTransfer } = await load();
    answer(transaction(received, undefined, NOT_BEFORE.getTime() / 1000 - 61));
    expect(await checkDirectTransfer(expected())).toEqual(TOO_OLD);
    answer(transaction(received, undefined, null));
    expect(await checkDirectTransfer(expected())).toEqual({ state: "confirmed" });
  });

  it("refuses a malformed signature without asking the RPC", async () => {
    const { checkDirectTransfer } = await load();
    expect(await checkDirectTransfer(expected({ txHash: `0x${"ab".repeat(32)}` }))).toEqual(NOT_A_HASH);
    expect(rpc.calls).toEqual([]);
  });

  it("throws when the RPC answers with an error", async () => {
    rpc.handlers.set("getTransaction", () => ({ error: { code: -32005, message: "Node is behind" } }));
    const { checkDirectTransfer } = await load();
    await expect(checkDirectTransfer(expected())).rejects.toThrow("Solana RPC getTransaction failed: Node is behind");
  });
});

describe("checkDirectTransfer on NEAR", () => {
  const NEAR = getChain("near")!;
  const TX_HASH = base58.encode(new Uint8Array(32).fill(9));
  const BLOCK_HASH = base58.encode(new Uint8Array(32).fill(4));
  const USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
  const PAYOUT_WALLET = "shop.near";
  const RECIPIENT = "customer.near";

  const expected = (overrides: Partial<Expected> = {}): Expected => ({
    chain: NEAR,
    tokenContract: USDC,
    from: PAYOUT_WALLET,
    to: RECIPIENT,
    amountBase: 25_000_000n,
    txHash: TX_HASH,
    notBefore: NOT_BEFORE,
    ...overrides,
  });

  const functionCall = (method_name: string, args: unknown) => ({
    FunctionCall: { method_name, args: Buffer.from(typeof args === "string" ? args : JSON.stringify(args)).toString("base64"), gas: 30_000_000_000_000, deposit: "1" },
  });
  const ftTransfer = (receiver_id: string, amount: string) => functionCall("ft_transfer", { receiver_id, amount, memo: null });

  /** A `tx` answer for a transaction `signer` sent to `receiver`, plus the `block` answer for its block at `blockMs`. */
  function nearState(input: { status?: object; finality?: string; signer?: string; receiver?: string; actions?: unknown[]; blockMs?: number } = {}) {
    rpc.handlers.set("tx", () => ({
      result: {
        final_execution_status: input.finality ?? "FINAL",
        status: input.status ?? { SuccessValue: "" },
        transaction: {
          signer_id: input.signer ?? PAYOUT_WALLET,
          receiver_id: input.receiver ?? USDC,
          actions: input.actions ?? [ftTransfer(RECIPIENT, "25000000")],
        },
        transaction_outcome: { block_hash: BLOCK_HASH },
      },
    }));
    const nanos = BigInt(input.blockMs ?? AFTER_SECONDS * 1000) * 1_000_000n;
    rpc.handlers.set("block", () => ({ result: { header: { timestamp_nanosec: nanos.toString() } } }));
  }

  it("confirms a final ft_transfer and asks the RPC with wait_until NONE", async () => {
    nearState();
    const { checkDirectTransfer } = await load();
    expect(await checkDirectTransfer(expected())).toEqual({ state: "confirmed" });
    expect(rpc.calls).toEqual([
      { url: "https://near-rpc.invalid", method: "tx", params: { tx_hash: TX_HASH, sender_account_id: PAYOUT_WALLET, wait_until: "NONE" } },
      { url: "https://near-rpc.invalid", method: "block", params: { block_id: BLOCK_HASH } },
    ]);
  });

  it("finds the ft_transfer among other actions, and accepts more than the amount", async () => {
    nearState({ actions: ["CreateAccount", functionCall("storage_deposit", { account_id: RECIPIENT }), ftTransfer(RECIPIENT, "26000000")] });
    const { checkDirectTransfer } = await load();
    expect(await checkDirectTransfer(expected())).toEqual({ state: "confirmed" });
  });

  it("waits while the transaction is not final", async () => {
    nearState({ finality: "EXECUTED_OPTIMISTIC" });
    const { checkDirectTransfer } = await load();
    expect(await checkDirectTransfer(expected())).toEqual({ state: "pending" });
    expect(methods()).toEqual(["tx"]);
  });

  it("waits while the RPC does not know the transaction or times out", async () => {
    const { checkDirectTransfer } = await load();
    rpc.handlers.set("tx", () => ({ error: { name: "HANDLER_ERROR", cause: { name: "UNKNOWN_TRANSACTION" } } }));
    expect(await checkDirectTransfer(expected())).toEqual({ state: "pending" });
    rpc.handlers.set("tx", () => ({ error: { name: "TIMEOUT_ERROR" } }));
    expect(await checkDirectTransfer(expected())).toEqual({ state: "pending" });
  });

  it("throws on any other RPC error", async () => {
    const { checkDirectTransfer } = await load();
    rpc.handlers.set("tx", () => ({ error: { name: "HANDLER_ERROR", cause: { name: "UNKNOWN_BLOCK" } } }));
    await expect(checkDirectTransfer(expected())).rejects.toThrow("NEAR RPC tx failed: UNKNOWN_BLOCK");
    rpc.handlers.set("tx", () => new Response("busy", { status: 503 }));
    await expect(checkDirectTransfer(expected())).rejects.toThrow("tx failed with HTTP 503");
  });

  it("fails a transaction whose execution failed", async () => {
    const { checkDirectTransfer } = await load();
    nearState({ status: { Failure: { ActionError: { index: 0, kind: { FunctionCallError: { ExecutionError: "Smart contract panicked" } } } } } });
    expect(await checkDirectTransfer(expected())).toEqual(TX_FAILED);
    nearState({ status: {} });
    expect(await checkDirectTransfer(expected())).toEqual(TX_FAILED);
  });

  it("refuses a transaction signed by another account or sent to another token contract", async () => {
    const { checkDirectTransfer } = await load();
    nearState({ signer: "someone.near" });
    expect(await checkDirectTransfer(expected())).toEqual(MISMATCH);
    nearState({ receiver: "usdt.tether-token.near" });
    expect(await checkDirectTransfer(expected())).toEqual(MISMATCH);
    expect(methods()).not.toContain("block");
  });

  it("refuses an ft_transfer to another receiver, of less, or with unreadable arguments", async () => {
    const { checkDirectTransfer } = await load();
    for (const actions of [
      [ftTransfer("someone.near", "25000000")],
      [ftTransfer(RECIPIENT, "24999999")],
      [ftTransfer(RECIPIENT, "2.5e7")],
      [functionCall("ft_transfer", "not json")],
      [functionCall("ft_transfer_call", { receiver_id: RECIPIENT, amount: "25000000", msg: "" })],
    ]) {
      nearState({ actions });
      expect(await checkDirectTransfer(expected())).toEqual(MISMATCH);
    }
  });

  it("refuses a transaction in a block older than the transfer", async () => {
    nearState({ blockMs: NOT_BEFORE.getTime() - 61_000 });
    const { checkDirectTransfer } = await load();
    expect(await checkDirectTransfer(expected())).toEqual(TOO_OLD);
  });

  it("throws when the block cannot be read", async () => {
    nearState();
    rpc.handlers.set("block", () => ({ error: { name: "UNKNOWN_BLOCK" } }));
    const { checkDirectTransfer } = await load();
    await expect(checkDirectTransfer(expected())).rejects.toThrow("NEAR RPC block failed: UNKNOWN_BLOCK");
  });

  it("refuses a malformed hash or a transfer without a token contract without asking the RPC", async () => {
    const { checkDirectTransfer } = await load();
    expect(await checkDirectTransfer(expected({ txHash: `0x${"ab".repeat(32)}` }))).toEqual(NOT_A_HASH);
    expect(await checkDirectTransfer(expected({ tokenContract: null }))).toEqual(NOT_A_HASH);
    expect(rpc.calls).toEqual([]);
  });
});

describe("checkDirectTransfer on other networks", () => {
  it("refuses networks it cannot check", async () => {
    const { checkDirectTransfer } = await load();
    const tron = getChain("tron")!;
    const check = await checkDirectTransfer({ chain: tron, tokenContract: null, from: "TA", to: "TB", amountBase: 1n, txHash: "ab".repeat(32), notBefore: NOT_BEFORE });
    expect(check).toEqual({ state: "failed", reason: "Transactions on TRON cannot be checked." });
    expect(rpc.calls).toEqual([]);
  });
});
