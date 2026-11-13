import type { BitcoinConnector } from "@reown/appkit-adapter-bitcoin";
import { connectReown, getAppKit, watchReown } from "@/lib/wallets/client/reown";
import { cannotSignIn, type ConnectedWallet, WalletError } from "@/lib/wallets/client/types";

/** AppKit 1.8.24's Unisat, Bitget and Binance connectors pass BTC where satoshis are expected (1/100,000,000 sent, appkit#5822); refused. */
const WRONG_UNIT_CONNECTORS = new Set(["unisat", "bitget", "binancew3w"]);
/** Wallet Standard Bitcoin wallets (Phantom, MetaMask) reject `sendTransfer` before showing anything, with this text. */
const SEND_TRANSFER_UNSUPPORTED = /use "?signPSBT"? instead/i;

/** Connects a Bitcoin wallet (Xverse, Leather, OKX, Phantom, phone wallets) through the Reown modal; it pays in BTC. */
export async function connectBitcoinWallet(): Promise<ConnectedWallet> {
  const { address, walletName } = await connectReown("bip122");
  const kit = await getAppKit();
  const provider = kit.getProvider<BitcoinConnector>("bip122");
  if (!provider) throw new WalletError("noConnection");

  return {
    kind: "bitcoin",
    name: walletName,
    address,
    signMessage: cannotSignIn,
    async pay(instruction) {
      if (instruction.tokenContract) throw new WalletError("nativeOnly");
      if (WRONG_UNIT_CONNECTORS.has(provider.id)) throw new WalletError("walletCannotSend");
      /** `amount` is in satoshis, the base unit 1Click quotes for BTC. */
      return provider.sendTransfer({ recipient: instruction.depositAddress, amount: instruction.amountBase }).catch((cause: unknown) => {
        throw cause instanceof Error && SEND_TRANSFER_UNSUPPORTED.test(cause.message) ? new WalletError("walletCannotSend", { cause }) : cause;
      });
    },
    watch: (onLost) => watchReown(kit, "bip122", address, onLost),
    disconnect: () => kit.disconnect("bip122"),
  };
}
