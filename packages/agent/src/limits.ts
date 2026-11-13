import { PaymentError } from "./errors.js";

export interface SpendingLimits {
  /** Largest single payment in USD. */
  perPaymentUsd: number;
  /** Largest total in USD over any rolling 24 hours. */
  dailyUsd: number;
  /** Hosts the agent may pay: `api.example.com`, or `*.example.com` for its subdomains. An empty list allows none. */
  allow: string[];
}

/** Validates limits and normalizes host patterns to lowercase. */
export function normalizeLimits(limits: SpendingLimits): SpendingLimits {
  for (const [name, value] of [["perPaymentUsd", limits.perPaymentUsd], ["dailyUsd", limits.dailyUsd]] as const) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`limits.${name} must be a number of USD, 0 or more.`);
  }
  if (!Array.isArray(limits.allow) || limits.allow.some((host) => typeof host !== "string" || !host.trim())) {
    throw new Error("limits.allow must be a list of host names.");
  }
  return { perPaymentUsd: limits.perPaymentUsd, dailyUsd: limits.dailyUsd, allow: limits.allow.map((host) => host.trim().toLowerCase()) };
}

export function isHostAllowed(hostname: string, allow: readonly string[]): boolean {
  const host = hostname.toLowerCase();
  return allow.some((pattern) => (pattern.startsWith("*.") ? host.endsWith(pattern.slice(1)) : host === pattern));
}

export function assertHostAllowed(limits: SpendingLimits, hostname: string): void {
  if (!isHostAllowed(hostname, limits.allow)) {
    throw new PaymentError("host_not_allowed", `Payments to ${hostname} are not allowed. Add it to the allow list to pay this site.`);
  }
}

/** Throws a `PaymentError` when paying `amountUsd` to `hostname` would break a limit. */
export function enforceLimits(limits: SpendingLimits, payment: { hostname: string; amountUsd: number; spentLast24hUsd: number }): void {
  assertHostAllowed(limits, payment.hostname);
  if (payment.amountUsd > limits.perPaymentUsd) {
    throw new PaymentError("per_payment_limit", `This payment costs about $${payment.amountUsd.toFixed(2)}, above the per-payment limit of $${limits.perPaymentUsd.toFixed(2)}.`);
  }
  if (payment.spentLast24hUsd + payment.amountUsd > limits.dailyUsd) {
    throw new PaymentError(
      "daily_limit",
      `This payment of about $${payment.amountUsd.toFixed(2)} would bring the last 24 hours to $${(payment.spentLast24hUsd + payment.amountUsd).toFixed(2)}, above the daily limit of $${limits.dailyUsd.toFixed(2)}.`,
    );
  }
}
