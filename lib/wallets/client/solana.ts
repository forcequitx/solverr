import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createNoopSigner,
  createSolanaRpc,
  createTransactionMessage,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Instruction,
} from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import type { Provider as SolanaProvider } from "@reown/appkit-adapter-solana";
import { Connection, VersionedTransaction } from "@solana/web3.js";
import { SOLANA_RPC_URL } from "@/lib/wallets/client/balances";
import { connectReown, getAppKit, watchReown } from "@/lib/wallets/client/reown";
import { type ConnectedWallet, WalletError } from "@/lib/wallets/client/types";
import type { PaymentInstruction } from "@/lib/wallets/payment-instruction";

/** Reown's WalletConnect provider text when the wallet's session lacks `solana_signAndSendTransaction`. */
const SIGN_AND_SEND_UNSUPPORTED = /"solana_signAndSendTransaction" is not supported/;

async function paymentInstructions(owner: string, instruction: PaymentInstruction): Promise<Instruction[]> {
  const payer = createNoopSigner(address(owner));
  const destination = address(instruction.depositAddress);
  const amount = BigInt(instruction.amountBase);
  if (!instruction.tokenContract) {
    return [getTransferSolInstruction({ source: payer, destination, amount })];
  }

  const mint = address(instruction.tokenContract);
  const rpc = createSolanaRpc(SOLANA_RPC_URL);
  const mintAccount = await rpc.getAccountInfo(mint, { encoding: "base64" }).send();
  if (mintAccount.value?.owner !== TOKEN_PROGRAM_ADDRESS) {
    throw new WalletError("unsupportedToken");
  }
  const [sourceAta] = await findAssociatedTokenPda({ owner: payer.address, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  const [destinationAta] = await findAssociatedTokenPda({ owner: destination, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  return [
    getCreateAssociatedTokenIdempotentInstruction({ payer, ata: destinationAta, owner: destination, mint }),
    getTransferCheckedInstruction({ source: sourceAta, mint, destination: destinationAta, authority: payer, amount, decimals: instruction.decimals }),
  ];
}

/** Connects a Solana wallet through the Reown modal: browser extensions, and phone wallets by QR code or deep link. */
export async function connectSolanaWallet(): Promise<ConnectedWallet> {
  const { address: owner, walletName } = await connectReown("solana");
  const kit = await getAppKit();
  const provider = kit.getProvider<SolanaProvider>("solana");
  if (!provider) throw new WalletError("noConnection");

  return {
    kind: "solana",
    name: walletName,
    address: owner,
    async signMessage({ message }) {
      const signature = await provider.signMessage(new TextEncoder().encode(message));
      return { signature: Buffer.from(signature).toString("base64") };
    },
    async pay(instruction) {
      const rpc = createSolanaRpc(SOLANA_RPC_URL);
      const { value: blockhash } = await rpc.getLatestBlockhash().send();
      const instructions = await paymentInstructions(owner, instruction);
      const transactionMessage = pipe(
        createTransactionMessage({ version: 0 }),
        (m) => setTransactionMessageFeePayer(address(owner), m),
        (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
        (m) => appendTransactionMessageInstructions(instructions, m),
      );
      const transaction = VersionedTransaction.deserialize(new Uint8Array(getTransactionEncoder().encode(compileTransaction(transactionMessage))));
      /** Returns the base58 signature. WalletConnect phone wallets lacking signAndSendTransaction only sign; the page then sends it. */
      return provider.signAndSendTransaction(transaction).catch((cause: unknown) => {
        if (!(cause instanceof Error && SIGN_AND_SEND_UNSUPPORTED.test(cause.message))) throw cause;
        return provider.sendTransaction(transaction, new Connection(SOLANA_RPC_URL, "confirmed"));
      });
    },
    watch: (onLost) => watchReown(kit, "solana", owner, onLost),
    disconnect: () => kit.disconnect("solana"),
  };
}
