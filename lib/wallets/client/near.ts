import type { EventMap, NearConnector, NearWalletBase, WalletManifest } from "@hot-labs/near-connect";
import { walletAppMetadata } from "@/lib/wallets/client/app-metadata";
import { nearTokenBalance, WRAPPED_NEAR } from "@/lib/wallets/client/balances";
import { type ConnectedWallet, WalletError, WalletNotConnected } from "@/lib/wallets/client/types";
import type { PaymentInstruction } from "@/lib/wallets/payment-instruction";

const GAS_30_TGAS = "30000000000000";
/** NEP-145 storage registration costs 0.00125 NEAR; any excess is refunded by the token contract. */
const STORAGE_DEPOSIT_YOCTO = "1250000000000000000000";
/** Storage prefix of NEAR Connect's WalletConnect client, kept apart from the Reown modal's. */
const NEAR_WALLETCONNECT_PREFIX = "near-connect";

/** Connector promise, stored at once so concurrent calls share one connector; on globalThis so Fast Refresh reuses it too. */
const near = ((globalThis as { __solverrNear?: { connector?: Promise<NearConnector> } }).__solverrNear ??= {});
/** Connects and transaction approvals in progress; NEAR Connect shows its dialog while one is pending. */
let pendingDialogs = 0;

async function withDialog<T>(run: () => Promise<T>): Promise<T> {
  pendingDialogs += 1;
  try {
    return await run();
  } finally {
    pendingDialogs -= 1;
  }
}

/** Whether a NEAR Connect dialog (wallet list or transaction approval) is open right now. */
export function nearDialogOpen(): boolean {
  return pendingDialogs > 0;
}

function getConnector(): Promise<NearConnector> {
  near.connector ??= createConnector().catch((cause: unknown) => {
    near.connector = undefined;
    throw cause;
  });
  return near.connector;
}

async function createConnector(): Promise<NearConnector> {
  const [{ NearConnector }, { default: wallets }] = await Promise.all([import("@hot-labs/near-connect"), import("@/lib/wallets/client/near-wallets.json")]);
  const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
  return new NearConnector({
    network: "mainnet",
    /** Reviewed wallet list with GitHub-hosted wallet code pinned to commits; `platform` objects differ from the declared `string[]`, hence the cast. */
    manifest: wallets as unknown as { wallets: WalletManifest[]; version: string },
    features: { signAndSendTransaction: true },
    /** No "NEAR Connector" footer; the dialog is restyled to the app's theme in app/globals.css. */
    footerBranding: null,
    /** Lets phone wallets connect by QR. Own storage prefix: in Reown's shared store, its EVM/Solana sessions break NEAR connects. */
    walletConnect: projectId
      ? import("@walletconnect/sign-client").then(({ SignClient }) => SignClient.init({ projectId, metadata: walletAppMetadata(), customStoragePrefix: NEAR_WALLETCONNECT_PREFIX }))
      : undefined,
  });
}

/** Starts loading NEAR Connect in the background, so its wallet list opens without a wait when NEAR is chosen. */
export function preloadNearConnector(): void {
  void getConnector().catch(() => {});
}

const call = (methodName: string, args: object, deposit: string) => ({
  type: "FunctionCall" as const,
  params: { methodName, args, gas: GAS_30_TGAS, deposit },
});

/** Registers storage for the deposit address, wraps the NEAR a wNEAR payment needs beyond `wrappedHeld`, then transfers the tokens. */
function paymentActions(signer: string, instruction: PaymentInstruction, wrappedHeld: bigint) {
  const token = instruction.tokenContract;
  if (!token) throw new WalletError("unsupportedToken");
  const actions = [call("storage_deposit", { account_id: instruction.depositAddress, registration_only: true }, STORAGE_DEPOSIT_YOCTO)];
  const toWrap = token === WRAPPED_NEAR ? BigInt(instruction.amountBase) - wrappedHeld : 0n;
  if (toWrap > 0n) {
    actions.push(call("storage_deposit", { account_id: signer, registration_only: true }, STORAGE_DEPOSIT_YOCTO));
    actions.push(call("near_deposit", {}, toWrap.toString()));
  }
  actions.push(call("ft_transfer", { receiver_id: instruction.depositAddress, amount: instruction.amountBase }, "1"));
  return { receiverId: token, actions };
}

function wrap(nearConnector: NearConnector, wallet: NearWalletBase, accountId: string): ConnectedWallet {
  return {
    kind: "near",
    name: wallet.manifest.name,
    address: accountId,
    async signMessage({ message, near }) {
      if (!near) throw new Error("Missing NEAR signing parameters.");
      const signed = await wallet.signMessage({ message, recipient: near.recipient, nonce: Uint8Array.from(Buffer.from(near.nonce, "base64")) });
      return { signature: signed.signature, publicKey: signed.publicKey };
    },
    async pay(instruction) {
      const wrappedHeld = instruction.tokenContract === WRAPPED_NEAR ? await nearTokenBalance(accountId, WRAPPED_NEAR) : 0n;
      const outcome = await withDialog(() => wallet.signAndSendTransaction({ signerId: accountId, ...paymentActions(accountId, instruction, wrappedHeld) }));
      /** A transaction that was included but failed (for example, too little balance) still returns an outcome, with `Failure` in its status. */
      if (typeof outcome.status === "object" && outcome.status !== null && "Failure" in outcome.status) {
        throw new Error("The NEAR transaction failed.", { cause: outcome.status.Failure });
      }
      return outcome.transaction.hash;
    },
    watch(onLost) {
      const onSignOut = () => onLost();
      const onSignIn = (event: EventMap["wallet:signIn"]) => {
        if (event.accounts[0]?.accountId !== accountId) onLost();
      };
      nearConnector.on("wallet:signOut", onSignOut);
      nearConnector.on("wallet:signIn", onSignIn);
      return () => {
        nearConnector.off("wallet:signOut", onSignOut);
        nearConnector.off("wallet:signIn", onSignIn);
      };
    },
    async disconnect() {
      await nearConnector.disconnect(wallet);
    },
  };
}

/** Connects a NEAR wallet through NEAR Connect, which shows its own list of browser, web and phone wallets; with `signsMessages`,
    only wallets that can sign a message are listed. */
export async function connectNearWallet({ signsMessages }: { signsMessages: boolean }): Promise<ConnectedWallet> {
  const nearConnector = await getConnector();
  const wallet = await withDialog(async () => {
    const walletId = await nearConnector.selectWallet({ features: { signMessage: signsMessages } });
    return nearConnector.connect({ walletId });
  }).catch((error: unknown) => {
    /** Closing the wallet list rejects with "User rejected"; as with the other connectors, that means no wallet was chosen. */
    throw error instanceof Error && error.message === "User rejected" ? new WalletNotConnected() : error;
  });
  const [account] = await wallet.getAccounts();
  if (!account) throw new WalletError("noConnection");
  return wrap(nearConnector, wallet, account.accountId);
}
