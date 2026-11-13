import type { Payment } from "@/components/checkout/checkout-api";
import { format } from "@/lib/i18n/interpolate";
import type { CheckoutMessages } from "@/lib/i18n/messages/en";
import { shortAddress } from "@/lib/wallets/short-address";

type TransactionSource = Pick<Payment, "origin_transactions" | "destination_transactions"> & { coin: Pick<Payment["coin"], "chain_name"> };

/** Links to a payment's blockchain transactions; `messages` names them for the reader (payer or merchant). */
export function TransactionLinks({ payment, messages }: { payment: TransactionSource; messages: Pick<CheckoutMessages["paymentStatus"], "yourPayment" | "merchantSettlement"> }) {
  const links = [
    ...payment.origin_transactions.map((tx) => ({ ...tx, label: format(messages.yourPayment, { chain: payment.coin.chain_name }) })),
    ...payment.destination_transactions.map((tx) => ({ ...tx, label: messages.merchantSettlement })),
  ];
  if (links.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {links.map((tx) => (
        <li key={tx.hash} className="flex items-center justify-between gap-3">
          <span className="text-muted">{tx.label}</span>
          {tx.url ? (
            <a href={tx.url} target="_blank" rel="noreferrer" className="inline-flex items-center font-mono whitespace-nowrap text-accent-text hover:underline pointer-coarse:min-h-11">
              {shortAddress(tx.hash, 8, 6)}
            </a>
          ) : (
            <span className="font-mono whitespace-nowrap">{shortAddress(tx.hash, 8, 6)}</span>
          )}
        </li>
      ))}
    </ul>
  );
}
