import {
  TokenAAVE,
  TokenADA,
  TokenAPT,
  TokenARB,
  TokenAURORA,
  TokenAVAX,
  TokenBCH,
  TokenBNB,
  TokenBTC,
  TokenCAKE,
  TokenCOW,
  TokenDAI,
  TokenDASH,
  TokenDOGE,
  TokenETH,
  TokenEURC,
  TokenFRAX,
  TokenGMX,
  TokenGNO,
  TokenHYPE,
  TokenJUP,
  TokenKNC,
  TokenLDO,
  TokenLINK,
  TokenLTC,
  TokenMKR,
  TokenMON,
  TokenNEAR,
  TokenOP,
  TokenPEPE,
  TokenPOL,
  TokenPYUSD,
  TokenSAFE,
  TokenSHIB,
  TokenSOL,
  TokenSTRK,
  TokenSUI,
  TokenSWEAT,
  TokenTAO,
  TokenTON,
  TokenTRX,
  TokenUNI,
  TokenUSDC,
  TokenUSDE,
  TokenUSDT,
  TokenWBTC,
  TokenXAUT,
  TokenXLM,
  TokenXRP,
  TokenZEC,
} from "@web3icons/react";
import type { ComponentType } from "react";

type Logo = ComponentType<{ variant?: "mono" | "branded" | "background"; className?: string }>;

/** Each coin's logo by upper-case symbol. */
const LOGOS: Record<string, Logo> = {
  AAVE: TokenAAVE,
  ADA: TokenADA,
  APT: TokenAPT,
  ARB: TokenARB,
  AURORA: TokenAURORA,
  AVAX: TokenAVAX,
  BCH: TokenBCH,
  BNB: TokenBNB,
  BTC: TokenBTC,
  CAKE: TokenCAKE,
  COW: TokenCOW,
  DAI: TokenDAI,
  DASH: TokenDASH,
  DOGE: TokenDOGE,
  ETH: TokenETH,
  EURC: TokenEURC,
  FRAX: TokenFRAX,
  GMX: TokenGMX,
  GNO: TokenGNO,
  HYPE: TokenHYPE,
  JUP: TokenJUP,
  KNC: TokenKNC,
  LDO: TokenLDO,
  LINK: TokenLINK,
  LTC: TokenLTC,
  MKR: TokenMKR,
  MON: TokenMON,
  NEAR: TokenNEAR,
  OP: TokenOP,
  PEPE: TokenPEPE,
  POL: TokenPOL,
  PYUSD: TokenPYUSD,
  SAFE: TokenSAFE,
  SHIB: TokenSHIB,
  SOL: TokenSOL,
  STRK: TokenSTRK,
  SUI: TokenSUI,
  SWEAT: TokenSWEAT,
  TAO: TokenTAO,
  TON: TokenTON,
  TRX: TokenTRX,
  UNI: TokenUNI,
  USDC: TokenUSDC,
  USDE: TokenUSDE,
  USDT: TokenUSDT,
  WBTC: TokenWBTC,
  XAUT: TokenXAUT,
  XLM: TokenXLM,
  XRP: TokenXRP,
  ZEC: TokenZEC,
};

/** Wrapped coins shown with the logo of the coin they stand for. */
const ALIASES: Record<string, string> = { wNEAR: "NEAR" };

/** A mid-tone hue from the symbol, which reads with white letters. */
function colorsFor(symbol: string): { background: string; color: string } {
  let hash = 0;
  for (const char of symbol) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return { background: `hsl(${hash} 55% 45%)`, color: "#ffffff" };
}

/** A coin's logo in a round badge; a coin without a logo shows its first letter on a color from its symbol. */
export function CoinIcon({ symbol, className }: { symbol: string; className: string }) {
  const Logo = LOGOS[(ALIASES[symbol] ?? symbol).toUpperCase()];
  if (Logo) {
    return (
      <span aria-hidden="true" className={`inline-grid shrink-0 overflow-hidden rounded-full ${className}`}>
        <Logo variant="background" className="size-full" />
      </span>
    );
  }
  return (
    <span className={`inline-grid shrink-0 place-items-center rounded-full font-bold ${className}`} style={colorsFor(symbol)} aria-hidden="true">
      {symbol.replace(/^w(?=[A-Z])/, "").slice(0, 1)}
    </span>
  );
}
