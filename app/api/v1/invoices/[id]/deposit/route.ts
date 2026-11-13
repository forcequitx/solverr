import { readJson } from "@/lib/api/body";
import { handleRoute, parseInput } from "@/lib/api/errors";
import { clientIp, clientNetwork, rateLimit } from "@/lib/api/rate-limit";
import { getCheckoutState } from "@/lib/payments/checkout-state";
import { reportDeposit, reportDepositSchema, reportWalletSent } from "@/lib/payments/deposit";

/** Public: the checkout reports the customer's transaction hash right after a wallet payment, or that a wallet without hashes sent it. */
export async function POST(request: Request, ctx: RouteContext<"/api/v1/invoices/[id]/deposit">) {
  return handleRoute(async () => {
    const { id } = await ctx.params;
    await rateLimit(`deposit-ip:${clientIp(request)}`, 20, 60_000);
    await rateLimit(`deposit-net:${clientNetwork(request)}`, 80, 60_000);
    /** A customer reports one transaction, perhaps retried; more reports for one invoice only spend 1Click capacity. Counted per client
        network too, so someone who has the link cannot use up the payer's reports. */
    await rateLimit(`deposit-invoice:${id}:${clientNetwork(request)}`, 5, 60_000);
    const input = parseInput(reportDepositSchema, (await readJson(request)).data);
    if (input.tx_hash) await reportDeposit(id, input.tx_hash, input.payment_id);
    else await reportWalletSent(id, input.payment_id);
    return Response.json(await getCheckoutState(id, { markSeen: false }));
  });
}
