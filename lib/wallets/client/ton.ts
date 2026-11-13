import type { TonConnector } from "@reown/appkit-adapter-ton";
import { connectReown, getAppKit, watchReown } from "@/lib/wallets/client/reown";
import { cannotSignIn, type ConnectedWallet, WalletError } from "@/lib/wallets/client/types";

/** The wallet rejects the transfer if it is not signed within five minutes. */
const VALID_FOR_SECONDS = 300;

/** Connects a TON wallet (Tonkeeper, MyTonWallet, phone wallets) through the Reown modal; it pays in TON. */
export async function connectTonWallet(): Promise<ConnectedWallet> {
  const { address, walletName } = await connectReown("ton");
  const kit = await getAppKit();
  const provider = kit.getProvider<TonConnector>("ton");
  if (!provider) throw new WalletError("noConnection");

  return {
    kind: "ton",
    name: walletName,
    address,
    signMessage: cannotSignIn,
    async pay(instruction) {
      if (instruction.tokenContract) throw new WalletError("nativeOnly");
      /** `amount` is in nanotons. TON wallets return the signed message rather than a transaction hash, so status polling finds the payment. */
      await provider.sendMessage({
        validUntil: Math.floor(Date.now() / 1000) + VALID_FOR_SECONDS,
        messages: [{ address: instruction.depositAddress, amount: instruction.amountBase }],
      });
      return null;
    },
    watch: (onLost) => watchReown(kit, "ton", address, onLost),
    disconnect: () => kit.disconnect("ton"),
  };
}
