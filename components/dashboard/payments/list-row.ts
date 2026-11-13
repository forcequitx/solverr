import { chainByName, type ChainInfo, getChain } from "@/lib/chains/registry";
import type { PaymentRow } from "@/lib/merchants/payment-stats";

/** Payment in the plain, serializable shape the client payment lists render. */
export type PaymentListRow = {
  id: string;
  createdAt: string;
  orderId: string | null;
  description: string | null;
  amount: string;
  currency: string;
  status: string;
  /** Such as "25.00 USDT · TRON". */
  paidWith: string | null;
  chain: string | null;
  agent: boolean;
};

/** The payment list's filters: a status, a chain name, and text searched in the order ID, description and payment ID. */
type PaymentFilters = { status: string; chain: string; search: string };

/** Whether a payment passes the list's filters; an empty filter passes every payment. The CSV export applies the same test. */
export function matchesPaymentFilters(row: PaymentListRow, { status, chain, search }: PaymentFilters): boolean {
  const query = search.trim().toLowerCase();
  return (!status || row.status === status) && (!chain || row.chain === chain) && (!query || [row.orderId, row.description, row.id].some((value) => value?.toLowerCase().includes(query)));
}

/** The networks the listed payments were paid on, for the chain filter, in name order. */
export function paymentChains(rows: readonly PaymentListRow[]): ChainInfo[] {
  const names = [...new Set(rows.flatMap((row) => (row.chain ? [row.chain] : [])))].sort();
  return names.map(chainByName).filter((chain): chain is ChainInfo => chain !== undefined);
}

export function paymentListRow(row: PaymentRow): PaymentListRow {
  const chain = row.paidWith ? (getChain(row.paidWith.chain)?.name ?? row.paidWith.chain) : null;
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    orderId: row.orderId,
    description: row.description,
    amount: row.amount,
    currency: row.currency,
    status: row.status,
    paidWith: row.paidWith ? `${row.paidWith.amount} ${row.paidWith.symbol} · ${chain}` : null,
    chain,
    agent: row.agent,
  };
}
