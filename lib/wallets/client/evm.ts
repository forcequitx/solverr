import { createWalletClient, custom, type EIP1193Provider, erc20Abi, getAddress } from "viem";
import { EVM_CHAIN_BY_ID } from "@/lib/chains/evm-chains";
import { connectReown, getAppKit, watchReown } from "@/lib/wallets/client/reown";
import { type ConnectedWallet, WalletError } from "@/lib/wallets/client/types";
import type { PaymentInstruction } from "@/lib/wallets/payment-instruction";

/** Connects an EVM wallet through the Reown modal: browser extensions, and phone wallets by QR code or deep link. */
export async function connectEvmWallet(): Promise<ConnectedWallet> {
  const { address, walletName } = await connectReown("eip155");
  const kit = await getAppKit();
  const provider = kit.getProvider<EIP1193Provider>("eip155");
  if (!provider) throw new WalletError("noConnection");
  const account = getAddress(address);
  const client = createWalletClient({ account, transport: custom(provider) });

  return {
    kind: "evm",
    name: walletName,
    address: account,
    chainId: Number(await provider.request({ method: "eth_chainId" })),
    async signMessage({ message }) {
      return { signature: await client.signMessage({ account, message }) };
    },
    async pay(instruction: PaymentInstruction) {
      const chain = instruction.evmChainId ? EVM_CHAIN_BY_ID.get(instruction.evmChainId) : undefined;
      if (!chain) throw new WalletError("unsupportedNetwork");
      await kit.switchNetwork(chain, { throwOnFailure: true }).catch((cause: unknown) => {
        throw new WalletError("wrongNetwork", { cause });
      });
      /** A network switch can replace the wallet's provider (reown-com/appkit#5453), so the payment uses the current one. */
      const current = kit.getProvider<EIP1193Provider>("eip155");
      if (!current) throw new WalletError("noConnection");
      const payer = createWalletClient({ account, transport: custom(current) });
      const to = getAddress(instruction.depositAddress);
      if (!instruction.tokenContract) {
        return payer.sendTransaction({ account, chain, to, value: BigInt(instruction.amountBase) });
      }
      return payer.writeContract({
        account,
        chain,
        address: getAddress(instruction.tokenContract),
        abi: erc20Abi,
        functionName: "transfer",
        args: [to, BigInt(instruction.amountBase)],
      });
    },
    watch: (onLost) => watchReown(kit, "eip155", account, onLost),
    disconnect: () => kit.disconnect("eip155"),
  };
}
