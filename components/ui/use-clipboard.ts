"use client";

import { useEffect, useRef, useState } from "react";

const COPIED_MS = 1500;

/** Copies text, or the clipboard items `content` builds: `copied` is true for a moment after success, `failed` after a refusal until the next try. */
export function useClipboard() {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async (content: string | (() => ClipboardItem[])) => {
    clearTimeout(timer.current);
    try {
      /** The clipboard call starts before the first await, so the click still counts as the user gesture. */
      await (typeof content === "string" ? navigator.clipboard.writeText(content) : navigator.clipboard.write(content()));
    } catch {
      setCopied(false);
      setFailed(true);
      return;
    }
    setFailed(false);
    setCopied(true);
    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
  };

  return { copied, failed, copy };
}
