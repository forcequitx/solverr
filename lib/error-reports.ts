import * as Sentry from "@sentry/node";
import { waitUntil } from "@vercel/functions";
import { getEnv } from "@/lib/env";

/** Nothing about requests, users or local variables leaves the server; a report carries the error and its stack only. */
const NO_PERSONAL_DATA = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  mcp: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
} satisfies Sentry.NodeOptions["dataCollection"];

/** URLs in error text keep only their origin: RPC keys, the Telegram bot token and webhook paths sit in paths and queries (viem puts the URL in its messages). */
export function redactUrls(text: string): string {
  return text.replace(/\b(?:https?|wss?):\/\/[^\s"'<>`]+/gi, (url) => {
    try {
      return new URL(url).origin;
    } catch {
      return "[url]";
    }
  });
}

/** Default integrations left out: ContextLines sends the source lines around each frame, ProcessSession tracks sessions. */
const SKIPPED_INTEGRATIONS = new Set(["ContextLines", "ProcessSession"]);

/** Sends unexpected errors of `service` to GlitchTip (Sentry-compatible) when SENTRY_DSN is set; errors only, no tracing or sessions. */
export function startErrorReports(service: "web" | "worker"): void {
  const dsn = getEnv().SENTRY_DSN;
  if (!dsn || Sentry.isInitialized()) return;
  Sentry.init({
    dsn,
    serverName: service,
    defaultIntegrations: Sentry.getDefaultIntegrationsWithoutPerformance().filter((integration) => !SKIPPED_INTEGRATIONS.has(integration.name)),
    sendClientReports: false,
    /** Breadcrumbs record outgoing request URLs with their paths, which carry the Telegram bot token, webhook paths and RPC keys. */
    maxBreadcrumbs: 0,
    dataCollection: NO_PERSONAL_DATA,
    beforeSend(event) {
      if (event.message) event.message = redactUrls(event.message);
      for (const exception of event.exception?.values ?? []) if (exception.value) exception.value = redactUrls(exception.value);
      return event;
    },
  });
}

/** Longest a Vercel function stays up after its response to send a queued report. */
const SEND_TIMEOUT_MS = 2_000;

/** Reports an unexpected error with labels (job, route) when reports are on; keeps a Vercel function up until it is sent. */
export function reportError(error: unknown, labels?: Record<string, string>): void {
  if (!Sentry.isInitialized()) return;
  Sentry.captureException(error, labels ? { tags: labels } : undefined);
  waitUntil(Sentry.flush(SEND_TIMEOUT_MS));
}

/** Sends reports still queued, waiting at most `timeoutMs`; call before the process exits. */
export async function flushErrorReports(timeoutMs: number): Promise<void> {
  if (Sentry.isInitialized()) await Sentry.close(timeoutMs);
}
