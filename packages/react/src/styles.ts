import { OVERLAY_CSS } from "solverr-embed/core";
import { useInsertionEffect, type CSSProperties } from "react";

const STYLE_ID = "solverr-react-styles";

export const PAY_BUTTON_CLASS = "solverr-pay-button";

/** Default button look, inline so server-rendered HTML is styled before hydration. */
export const PAY_BUTTON_STYLE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 44,
  padding: "0 20px",
  border: 0,
  borderRadius: 10,
  background: "#155DFC",
  color: "#FFFFFF",
  font: '600 15px/1.2 "DM Sans", system-ui, sans-serif',
  /** The full-page button is a link, so the host page's link underline is removed. */
  textDecoration: "none",
  cursor: "pointer",
};

/** Button states, followed by the overlay stylesheet shared with the script button. */
const CSS = `
.solverr-pay-button:hover:not(:disabled){background:#1447E6!important}
.solverr-pay-button:disabled{opacity:.5;cursor:not-allowed!important}
.solverr-pay-button:focus-visible{outline:2px solid #155DFC;outline-offset:2px}
@media (prefers-reduced-motion:no-preference){.solverr-pay-button{transition:background-color .15s ease}}
${OVERLAY_CSS}`;

/** Adds the button and overlay stylesheet to the page once, on the client only. */
export function useSolverrStyles(): void {
  useInsertionEffect(() => {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.append(style);
  }, []);
}
