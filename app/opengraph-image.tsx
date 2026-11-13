import { ImageResponse } from "next/og";
import { CHAINS } from "@/lib/chains/registry";

/** Link preview image for every page: logo, name and pitch on white. Colors repeat the brand tokens in globals.css and icon.svg. */
export const alt = "Solverr: get paid in crypto straight into your own wallet";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const LOGO_TOP = "#155dfc";
const LOGO_BOTTOM = "#7ccf00";
const INK = "#0a0a0a";
const MUTED = "#6b6b6b";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 80, background: "#ffffff" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
        <svg width="88" height="88" viewBox="7 7 34 34">
          <path d="M24 8H38V24H24A8 8 0 0 1 24 8Z" fill={LOGO_TOP} />
          <path d="M24 24H10V40H24A8 8 0 0 0 24 24Z" fill={LOGO_BOTTOM} />
        </svg>
        <span style={{ fontSize: 64, fontWeight: 700, color: INK, letterSpacing: -2 }}>Solverr</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <span style={{ fontSize: 68, fontWeight: 700, color: INK, letterSpacing: -2, lineHeight: 1.1 }}>
          Get paid by humans and AI agents, in any coin, straight into your own wallet.
        </span>
        <span style={{ fontSize: 32, color: MUTED }}>{`Crypto checkout on NEAR Intents · ${CHAINS.length} chains · No custody`}</span>
      </div>
    </div>,
    size,
  );
}
