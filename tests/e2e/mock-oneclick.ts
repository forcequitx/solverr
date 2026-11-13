import { createServer, type Server } from "node:http";
import type { OneClickToken } from "@/lib/oneclick/types";

/** Coins the browser tests can see: stablecoins and native coins on the payout networks, plus the Arbitrum USDC the coin check pays from. */
export const MOCK_TOKENS: OneClickToken[] = [
  { assetId: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", decimals: 6, blockchain: "base", symbol: "USDC", price: 1, priceUpdatedAt: "", contractAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" },
  { assetId: "nep141:base.omft.near", decimals: 18, blockchain: "base", symbol: "ETH", price: 3000, priceUpdatedAt: "" },
  { assetId: "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near", decimals: 6, blockchain: "eth", symbol: "USDC", price: 1, priceUpdatedAt: "", contractAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" },
  { assetId: "nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near", decimals: 6, blockchain: "eth", symbol: "USDT", price: 1, priceUpdatedAt: "", contractAddress: "0xdac17f958d2ee523a2206206994597c13d831ec7" },
  { assetId: "nep141:eth.omft.near", decimals: 18, blockchain: "eth", symbol: "ETH", price: 3000, priceUpdatedAt: "" },
  { assetId: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near", decimals: 6, blockchain: "arb", symbol: "USDC", price: 1, priceUpdatedAt: "", contractAddress: "0xaf88d065e77c8cc2239327c5edb3a432268e5831" },
  { assetId: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", decimals: 6, blockchain: "sol", symbol: "USDC", price: 1, priceUpdatedAt: "", contractAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
  { assetId: "nep141:sol.omft.near", decimals: 9, blockchain: "sol", symbol: "SOL", price: 150, priceUpdatedAt: "" },
  { assetId: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", decimals: 6, blockchain: "near", symbol: "USDC", price: 1, priceUpdatedAt: "", contractAddress: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1" },
  { assetId: "nep141:wrap.near", decimals: 24, blockchain: "near", symbol: "wNEAR", price: 3, priceUpdatedAt: "", contractAddress: "wrap.near" },
];

/** A coin whose dry quotes are refused with 1Click's dollar-minimum wording, so setup shows its minimum warning. */
export const REFUSED_ASSET = "nep141:eth.omft.near";
export const REFUSED_MINIMUM = "Minimum swap amount is $1,000";

/** A local stand-in for the 1Click API: the token list, dry quotes (refused for REFUSED_ASSET), and nothing that moves money. */
export function startMockOneClick(port: number): Promise<Server> {
  const server = createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && url.pathname === "/v0/tokens") return send(200, MOCK_TOKENS);
    if (req.method === "POST" && url.pathname === "/v0/quote") {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        const body = JSON.parse(raw || "{}") as { dry?: boolean; destinationAsset?: string; amount?: string };
        if (!body.dry) return send(400, { message: "Failed to get quote" });
        if (body.destinationAsset === REFUSED_ASSET) return send(400, { message: REFUSED_MINIMUM });
        return send(200, { quote: { amountIn: body.amount ?? "1000000", amountInFormatted: "1.00", amountInUsd: "1.01" } });
      });
      return;
    }
    return send(404, { message: "Not found" });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}
