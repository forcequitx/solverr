"use client";

import { useEffect } from "react";

/** How long the page waits before opening the stream again after the server refused it, or it kept failing to connect. */
const REOPEN_MS = 30_000;
/** Connection errors in a row, without the stream opening, after which it is closed and opened again only after REOPEN_MS. */
const MAX_FAILED_CONNECTS = 3;

/** While `active`, an SSE stream calls `refresh` on every change, and polling runs every `pollMs` (`streamPollMs` while the stream is
    connected, for missed updates). A hidden page does neither; one shown again or restored from the back-forward cache refreshes at once. */
export function useLiveStatus(
  invoiceId: string,
  refresh: () => Promise<void>,
  { active, pollMs, streamPollMs }: { active: boolean; pollMs: number; streamPollMs: number },
): void {
  useEffect(() => {
    if (!active) return;
    let source: EventSource | null = null;
    let connected = false;
    let failedConnects = 0;
    let timer: ReturnType<typeof setInterval> | undefined;
    let period = 0;
    let reopen: ReturnType<typeof setTimeout> | undefined;

    /** Polls at the stream state's pace; the timer is replaced only when the pace changes, since a failing stream errors every few
        seconds and restarting the timer each time would keep it from ever firing. */
    const poll = () => {
      const next = connected ? streamPollMs : pollMs;
      if (timer !== undefined && next === period) return;
      clearInterval(timer);
      period = next;
      timer = setInterval(() => void refresh(), next);
    };
    const openStream = () => {
      if (typeof EventSource === "undefined") return;
      const stream = new EventSource(`/api/v1/invoices/${encodeURIComponent(invoiceId)}/events`);
      source = stream;
      /** Each (re)connect refreshes once, because changes made while the stream was down were not sent. */
      stream.onopen = () => {
        connected = true;
        failedConnects = 0;
        poll();
        void refresh();
      };
      stream.addEventListener("change", () => void refresh());
      stream.onerror = () => {
        connected = false;
        poll();
        if (source !== stream) return;
        /** The browser reconnects a dropped stream but not a refused one; that one, or one that keeps failing (a proxy cutting streams),
            is reopened later while polling carries the page. */
        if (stream.readyState === EventSource.CLOSED || ++failedConnects >= MAX_FAILED_CONNECTS) {
          stream.close();
          source = null;
          failedConnects = 0;
          reopen = setTimeout(openStream, REOPEN_MS);
        }
      };
    };
    const start = () => {
      openStream();
      poll();
    };
    const stop = () => {
      source?.close();
      source = null;
      connected = false;
      failedConnects = 0;
      clearTimeout(reopen);
      clearInterval(timer);
      timer = undefined;
    };
    const restart = () => {
      stop();
      if (document.hidden) return;
      void refresh();
      start();
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) restart();
    };

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", restart);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", restart);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [invoiceId, refresh, active, pollMs, streamPollMs]);
}
