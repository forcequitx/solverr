import { readJson } from "@/lib/api/body";
import { handleRoute, parseInput } from "@/lib/api/errors";
import { clientIp, clientNetwork, rateLimit } from "@/lib/api/rate-limit";
import { createCaseSchema, openSupportCase } from "@/lib/support/cases";

/** Public: the help page opens a support case for a payment problem. */
export async function POST(request: Request) {
  return handleRoute(async () => {
    await rateLimit(`support-ip:${clientIp(request)}`, 5, 60_000);
    await rateLimit(`support-net:${clientNetwork(request)}`, 20, 60_000);
    const input = parseInput(createCaseSchema, (await readJson(request)).data);
    return Response.json(await openSupportCase(input), { status: 201 });
  });
}
