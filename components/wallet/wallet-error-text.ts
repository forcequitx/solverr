import { format } from "@/lib/i18n/interpolate";
import type { CheckoutMessages } from "@/lib/i18n/messages/en";
import type { WalletError } from "@/lib/wallets/client/types";
import { walletFailure } from "@/lib/wallets/client/wallet-errors";

/** A failed wallet connect or payment as checkout text. A payment (`coin` given) can be declined, lack funds, be on the wrong network
    or use a coin the wallet cannot send; a connect can end without a connection. Anything else shows `fallback`. */
export function walletErrorText(cause: unknown, messages: CheckoutMessages, fallback: string, coin?: { symbol: string; chainName: string }): string {
  const failure = walletFailure(cause);
  if (failure === "notConnected" || failure === "noConnection") return messages.walletErrors[failure];
  if (!coin) return fallback;
  if (failure === "rejected") return messages.walletPay.rejected;
  if (failure === "insufficientFunds") return format(messages.walletPay.insufficientFunds, { symbol: coin.symbol });
  if (failure === "wrongNetwork") return format(messages.walletPay.wrongNetwork, { chain: coin.chainName });
  if (failure === "walletCannotSend") return messages.walletPay.walletCannotSend;
  return failure === "unsupported" ? messages.walletErrors[(cause as WalletError).reason] : fallback;
}
