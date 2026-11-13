/** 1Click "Earn" vault share tokens: settling into one puts revenue in a third-party yield vault, shares held in the merchant's wallet;
    yield and principal are not guaranteed. */
export const EARN_ASSETS: Record<string, { vault: string; provider: string }> = {
  "nep141:base-0x0bb69b79bc829e1cfcc34a740110886d98d2bd14.omft.near": { vault: "gtUSDCp (USDC vault on Base)", provider: "Gauntlet" },
  "nep141:eth-0x0f38f1ce62776d4a0038bc6cac66877a5687383b.omft.near": { vault: "TLO (Ethereum vault)", provider: "Third-party vault" },
  "nep141:sol-0xa69aa1bcb03a369e338156a8718ad60271145803.omdep.near": { vault: "kV-gtSOLb (SOL vault on Solana)", provider: "Kamino" },
};

export function isEarnAsset(assetId: string): boolean {
  return assetId in EARN_ASSETS;
}
