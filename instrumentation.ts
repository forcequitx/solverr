import type { Instrumentation } from "next";

/** Validates the environment at Node.js server start, so a bad setting stops it before serving, and starts error reports when SENTRY_DSN is set. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { getEnv } = await import("@/lib/env");
    getEnv();
    const { startErrorReports } = await import("@/lib/error-reports");
    startErrorReports("web");
  }
}

/** Reports errors Next.js caught while rendering or running a route; the path is sent without its query string. */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { reportError } = await import("@/lib/error-reports");
  reportError(error, { method: request.method, path: request.path.split("?")[0], route: context.routePath, kind: context.routeType });
};
