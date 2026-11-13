import { MINUTE_CACHE_HEADERS } from "@/lib/api/cache";
import { handleRoute } from "@/lib/api/errors";
import { clientIp, rateLimit } from "@/lib/api/rate-limit";
import { chainForToken } from "@/lib/chains/registry";
import { listTokens } from "@/lib/oneclick/tokens";

/** Coins customers can pay with: 1Click tokens on the chains Solverr supports, with a USD price, as the checkout lists them. */
export async function GET(request: Request) {
  return handleRoute(async () => {
    await rateLimit(`tokens:${clientIp(request)}`, 120, 60_000);
    const tokens = await listTokens();
    const data = tokens.flatMap((token) => {
      const chain = chainForToken(token);
      /** 1Click lists some coins without a price; the checkout cannot price a payment in them, so it hides them too. */
      if (!chain || !token.price) return [];
      return [
        {
          asset_id: token.assetId,
          symbol: token.symbol,
          blockchain: token.blockchain,
          chain_name: chain.name,
          decimals: token.decimals,
          price_usd: token.price,
          contract_address: token.contractAddress ?? null,
        },
      ];
    });
    return Response.json({ object: "list", data }, { headers: MINUTE_CACHE_HEADERS });
  });
}
