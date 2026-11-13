import { InvoiceStatus } from "@/generated/prisma/client";
import { matchesPaymentFilters, paymentListRow } from "@/components/dashboard/payments/list-row";
import { ApiError } from "@/lib/api/errors";
import { requireShownMerchant } from "@/lib/auth/session";
import { paymentRows } from "@/lib/merchants/payment-stats";

const MAX_ROWS = 5000;
/** Byte order mark: without it, Excel reads the UTF-8 file in the local code page and garbles non-ASCII names. */
const UTF8_BOM = "﻿";

function csvCell(value: string): string {
  /** Leading = + - @, tab or carriage return would be read as formulas by spreadsheet apps. */
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** The payments the list shows for `merchant` (the business the tab shows) with its `status`, `chain` and `search` filters, as CSV. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  let context;
  try {
    context = await requireShownMerchant(params.get("merchant") ?? "");
  } catch (error) {
    /** The link opens as a page, so the refusal is plain text the browser shows. */
    if (error instanceof ApiError) return new Response(error.message, { status: error.status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
    throw error;
  }
  const { merchant, mode } = context;
  const requested = params.get("status") ?? "";
  const status = Object.hasOwn(InvoiceStatus, requested) ? (requested as InvoiceStatus) : undefined;
  const filters = { status: status ?? "", chain: params.get("chain") ?? "", search: params.get("search") ?? "" };
  const rows = (await paymentRows(merchant.id, mode, { take: MAX_ROWS, status })).filter((row) => matchesPaymentFilters(paymentListRow(row), filters));
  const lines = [
    ["invoice_id", "created_at", "order_id", "description", "amount", "currency", "status", "paid_with_amount", "paid_with_coin", "paid_with_chain"].join(","),
    ...rows.map((row) =>
      [row.id, row.createdAt.toISOString(), row.orderId ?? "", row.description ?? "", row.amount, row.currency, row.status, row.paidWith?.amount ?? "", row.paidWith?.symbol ?? "", row.paidWith?.chain ?? ""]
        .map(csvCell)
        .join(","),
    ),
  ];
  return new Response(UTF8_BOM + lines.join("\n") + "\n", {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="solverr-payments.csv"', "cache-control": "no-store" },
  });
}
