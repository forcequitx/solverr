import { goToCheckout } from "./checkout-page.js";
import { appOrigin } from "./checkout-url.js";
import { openCheckout } from "./overlay.js";
import type { CheckoutMode, CheckoutTarget } from "./types.js";

declare global {
  interface Window {
    Solverr?: { open(target: CheckoutTarget, mode?: CheckoutMode): void };
  }
}

const TRIGGER_SELECTOR = "[data-solverr-link],[data-solverr-invoice]";

/** The tag that loaded this script: `document.currentScript`, else one marked `data-solverr-embed`, else the only script served at `/embed.js`. */
function embedScript(): HTMLScriptElement | undefined {
  const current = document.currentScript;
  if (current instanceof HTMLScriptElement && current.src) return current;
  const marked = document.querySelector("script[src][data-solverr-embed]");
  if (marked instanceof HTMLScriptElement) return marked;
  const atEmbedPath = Array.from(document.scripts).filter((script) => script.src && new URL(script.src).pathname === "/embed.js");
  return atEmbedPath.length === 1 ? atEmbedPath[0] : undefined;
}

/** The app origin is the origin this script was loaded from. */
function scriptOrigin(): string {
  const script = embedScript();
  if (!script) {
    throw new Error("Solverr embed: load embed.js with a <script src> tag from your Solverr app; if a script loader adds it, give the tag a data-solverr-embed attribute.");
  }
  return appOrigin(script.src);
}

function targetOf(trigger: HTMLElement): CheckoutTarget {
  const link = trigger.dataset.solverrLink;
  return link ? { link } : { invoice: trigger.dataset.solverrInvoice ?? "" };
}

/** Opens the checkout in the chosen mode; the full checkout page unless the overlay is asked for. */
function open(origin: string, target: CheckoutTarget, mode: CheckoutMode = "page", trigger?: Element, newTab = false): void {
  if (mode === "overlay") openCheckout(origin, target, trigger);
  else goToCheckout(origin, target, newTab);
}

/** A second copy of the script on the same page does nothing; an element with the id `Solverr`, which browsers also expose as `window.Solverr`, does not count. */
if (typeof window.Solverr?.open !== "function") {
  const origin = scriptOrigin();

  document.addEventListener("click", (event) => {
    const trigger = event.target instanceof Element ? event.target.closest<HTMLElement>(TRIGGER_SELECTOR) : null;
    if (!trigger) return;
    event.preventDefault();
    const mode: CheckoutMode = trigger.dataset.solverrMode === "overlay" ? "overlay" : "page";
    open(origin, targetOf(trigger), mode, trigger, event.metaKey || event.ctrlKey);
  });

  window.Solverr = { open: (target, mode) => open(origin, target, mode) };
}
