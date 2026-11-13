import type { AppKit } from "@reown/appkit";
import type { AppKitNetwork } from "@reown/appkit/networks";
import { EVM_CHAINS } from "@/lib/chains/evm-chains";
import { walletAppMetadata } from "@/lib/wallets/client/app-metadata";
import { WalletNotConnected } from "@/lib/wallets/client/types";

type Namespace = "eip155" | "solana" | "bip122" | "tron" | "ton";

type ReownAccount = { address: string; walletName: string };

/** Dashboard blue and the app's text font, so the modal looks like part of Solverr. */
const THEME_VARIABLES = {
  "--w3m-accent": "#155dfc",
  "--w3m-font-family": "Figtree, ui-sans-serif, system-ui, sans-serif",
  /** Reown multiplies this: the modal gets 22px (--card-radius) and wallet rows 11px. */
  "--w3m-border-radius-master": "2.75px",
  "--w3m-z-index": 1000,
};

/** After the modal closes, how long a connection that is still finishing may take before the close counts as a cancel. */
const CLOSE_GRACE_MS = 1500;
/** After AppKit reports a successful connect, how long the account may take to appear (phone wallets fetch it after the modal closes). */
const CONNECT_FINISH_MS = 20_000;

/** Kept on globalThis so that Fast Refresh in development, which re-runs this module, reuses the one AppKit and its WalletConnect core. */
const reown = ((globalThis as { __solverrReown?: { modal?: Promise<AppKit>; loaded?: AppKit } }).__solverrReown ??= {});

function themeMode(): "light" | "dark" {
  const chosen = document.documentElement.dataset.theme;
  if (chosen === "light" || chosen === "dark") return chosen;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Silences Lit's dev-only hints from the Reown modal (dev mode, AppKit's own extra updates); Lit skips the codes in this set. */
function silenceLitDevHints(): void {
  if (process.env.NODE_ENV === "production") return;
  const shown = ((globalThis as { litIssuedWarnings?: Set<string> }).litIssuedWarnings ??= new Set());
  shown.add("dev-mode").add("change-in-update");
}

async function createModal(): Promise<AppKit> {
  silenceLitDevHints();
  const [
    { createAppKit },
    { bitcoin, solana, ton, tronMainnet },
    { WagmiAdapter },
    { SolanaAdapter },
    { BitcoinAdapter },
    { TronAdapter },
    { TonAdapter },
    { baseAccount, coinbaseWallet },
  ] = await Promise.all([
    import("@reown/appkit"),
    import("@reown/appkit/networks"),
    import("@reown/appkit-adapter-wagmi"),
    import("@reown/appkit-adapter-solana"),
    import("@reown/appkit-adapter-bitcoin"),
    import("@reown/appkit-adapter-tron"),
    import("@reown/appkit-adapter-ton"),
    import("wagmi/connectors"),
  ]);
  const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";
  const networks: [AppKitNetwork, ...AppKitNetwork[]] = [...EVM_CHAINS, solana, bitcoin, tronMainnet, ton];
  /** Telemetry-off copies replacing AppKit's analytics-sending ones: same Base Account id wins, Coinbase Wallet's off via `enableCoinbase: false`. */
  const coinbaseConnectors = [
    coinbaseWallet({ version: "4", appName: "Solverr", preference: { options: "all", telemetry: false } }),
    baseAccount({ appName: "Solverr", preference: { telemetry: false } }),
  ];
  return createAppKit({
    adapters: [
      new WagmiAdapter({ networks: EVM_CHAINS, projectId, connectors: coinbaseConnectors }),
      new SolanaAdapter(),
      new BitcoinAdapter({ projectId }),
      new TronAdapter(),
      new TonAdapter(),
    ],
    networks,
    projectId,
    enableCoinbase: false,
    metadata: walletAppMetadata(),
    /** Wallets only: no hosted email or social wallets, swaps, buying crypto or analytics. */
    features: { email: false, socials: false, emailShowWallets: false, swaps: false, onramp: false, send: false, receive: false, history: false, analytics: false },
    allowUnsupportedChain: true,
    /** Every connect asks the person to choose a wallet, so a session from an earlier visit is not restored on load. */
    enableReconnect: false,
    themeMode: themeMode(),
    themeVariables: THEME_VARIABLES,
  });
}

/** The Reown AppKit modal (EVM, Solana, Bitcoin, TRON, TON), created on first use and resolved once ready; a failed start retries next call. */
export function getAppKit(): Promise<AppKit> {
  reown.modal ??= createModal()
    .then(async (kit) => {
      await kit.ready();
      reown.loaded = kit;
      return kit;
    })
    .catch((cause: unknown) => {
      reown.modal = undefined;
      throw cause;
    });
  return reown.modal;
}

/** Whether the Reown modal is open right now; false while it has never been loaded. */
export function reownModalOpen(): boolean {
  return reown.loaded?.isOpen() ?? false;
}

function connectedAccount(kit: AppKit, namespace: Namespace): ReownAccount | null {
  const account = kit.getAccount(namespace);
  if (!account?.isConnected || !account.address) return null;
  return { address: account.address, walletName: kit.getWalletInfo(namespace)?.name ?? "Wallet" };
}

/** Calls `onLost` when the `namespace` account disconnects or changes address (ignoring passing states such as "connecting"); returns an unsubscribe. */
export function watchReown(kit: AppKit, namespace: Namespace, address: string, onLost: () => void): () => void {
  const same = (other: string) => (namespace === "eip155" ? other.toLowerCase() === address.toLowerCase() : other === address);
  return kit.subscribeAccount((state) => {
    if (state.status === "disconnected" || (state.status === "connected" && state.address && !same(state.address))) onLost();
  }, namespace);
}

/** Opens the modal for one chain family and resolves with the wallet the person connects; rejects when they close it without connecting. */
export async function connectReown(namespace: Namespace): Promise<ReownAccount> {
  const kit = await getAppKit();
  kit.setThemeMode(themeMode());
  /** A remembered session is dropped first, so every connect lets the person choose the wallet again. */
  if (connectedAccount(kit, namespace)) await kit.disconnect(namespace);

  return new Promise((resolve, reject) => {
    const unsubscribe: Array<() => void> = [];
    let opened = false;
    let closed = false;
    let succeeded = false;
    let settled = false;
    let giveUp: ReturnType<typeof setTimeout> | undefined;
    const settle = (result: { account: ReownAccount } | { error: Error }) => {
      if (settled) return;
      settled = true;
      clearTimeout(giveUp);
      unsubscribe.forEach((stop) => stop());
      if ("account" in result) {
        void kit.close();
        resolve(result.account);
      } else reject(result.error);
    };
    const check = () => {
      const account = connectedAccount(kit, namespace);
      if (account) settle({ account });
    };
    /** AppKit closes the modal before the account is set, so a close cancels only if no account appears in the grace
        (longer after CONNECT_SUCCESS). */
    const waitAfterClose = () => {
      clearTimeout(giveUp);
      giveUp = setTimeout(
        () => {
          check();
          settle({ error: new WalletNotConnected() });
        },
        succeeded ? CONNECT_FINISH_MS : CLOSE_GRACE_MS,
      );
    };
    unsubscribe.push(
      kit.subscribeAccount(check, namespace),
      kit.subscribeEvents(({ data }) => {
        if (data.event !== "CONNECT_SUCCESS" || succeeded) return;
        succeeded = true;
        check();
        if (closed) waitAfterClose();
      }),
      kit.subscribeState((state) => {
        if (state.open) opened = true;
        else if (opened && !closed) {
          closed = true;
          check();
          waitAfterClose();
        }
      }),
    );
    kit.open({ view: "Connect", namespace }).catch((cause: unknown) => settle({ error: cause instanceof Error ? cause : new WalletNotConnected() }));
  });
}
