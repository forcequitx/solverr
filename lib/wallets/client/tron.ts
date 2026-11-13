import type { TronConnector } from "@reown/appkit-adapter-tron";
import { connectReown, getAppKit, watchReown } from "@/lib/wallets/client/reown";
import { cannotSignIn, type ConnectedWallet, WalletError } from "@/lib/wallets/client/types";

/** Connects a TRON wallet (TronLink, Trust, OKX, Binance, phone wallets) through the Reown modal; it pays in TRX. */
export async function connectTronWallet(): Promise<ConnectedWallet> {
  const { address, walletName } = await connectReown("tron");
  const kit = await getAppKit();
  const provider = kit.getProvider<TronConnector>("tron");
  if (!provider) throw new WalletError("noConnection");

  return {
    kind: "tron",
    name: walletName,
    address,
    signMessage: cannotSignIn,
    async pay(instruction) {
      if (instruction.tokenContract) throw new WalletError("nativeOnly");
      /** `value` is in sun, the base unit 1Click quotes for TRX; the wallet signs and the transaction id comes back. */
      return provider.sendTransaction({ from: address, to: instruction.depositAddress, value: instruction.amountBase });
    },
    watch: (onLost) => watchReown(kit, "tron", address, onLost),
    disconnect: () => kit.disconnect("tron"),
  };
}
