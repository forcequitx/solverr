"use client";

import { useEffect } from "react";
import { walletDialogOpen } from "@/lib/wallets/client/connect";

/** A message from the embedded checkout to the page that opened it; `source: "solverr"` is added when sent. */
type EmbedMessage = { type: "close" } | { type: "paid"; invoice: Record<string, unknown> };

/** Origin of the page that opened this embedded checkout, once found. */
let knownEmbedderOrigin: string | undefined;

/** The origin of an http or https URL; anything else gives `undefined`. */
function webOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

/** The page that opened the embedded checkout: the `origin` query parameter when it is a bare http(s) origin, kept for later pages in the frame. */
export function embedderOrigin(): string | undefined {
  if (knownEmbedderOrigin) return knownEmbedderOrigin;
  const declared = new URLSearchParams(window.location.search).get("origin");
  knownEmbedderOrigin = declared && webOrigin(declared) === declared ? declared : undefined;
  return knownEmbedderOrigin;
}

/** Posts `message` to the page that opened the embedded checkout, and to that origin only; with no known origin nothing is sent. */
export function postToEmbedder(message: EmbedMessage): void {
  const origin = embedderOrigin();
  if (!origin || window.parent === window) return;
  window.parent.postMessage({ source: "solverr", ...message }, origin);
}

/** In the embedded checkout, Escape asks the merchant page to close the overlay, since key presses inside the frame never reach it;
    the capture phase runs before a wallet dialog handles Escape, so an open wallet dialog closes alone. */
export function useEmbedEscape(embedded: boolean): void {
  useEffect(() => {
    if (!embedded) return;
    /** Reads the opener's origin while this page's URL still carries it, before the frame moves to another page. */
    embedderOrigin();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || walletDialogOpen()) return;
      postToEmbedder({ type: "close" });
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [embedded]);
}
