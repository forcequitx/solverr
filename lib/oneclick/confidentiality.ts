import type { Mode } from "@/generated/prisma/client";
import { getEnv } from "@/lib/env";
import type { OneClickError } from "@/lib/oneclick/client";
import type { Confidentiality } from "@/lib/oneclick/types";

/** Level the test-mode mock quotes private payments with; it needs no partner key. */
const TEST_LEVEL = "basic";

/** Why this server cannot serve private payments, or null; 1Click answers confidential quotes without a partner key with 401. */
export function privatePaymentsUnavailable(): string | null {
  const { ONECLICK_API_KEY, ONECLICK_CONFIDENTIALITY } = getEnv();
  if (!ONECLICK_API_KEY) return "This Solverr server has no NEAR Intents partner key, which private payments need.";
  if (!ONECLICK_CONFIDENTIALITY) return "This Solverr server has no private payment level set yet.";
  return null;
}

/** The confidentiality a private payment is quoted with in `mode`, or null when this server cannot serve it. */
export function privateLevel(mode: Mode): Exclude<Confidentiality, "public"> | null {
  if (mode === "test") return TEST_LEVEL;
  return privatePaymentsUnavailable() === null ? (getEnv().ONECLICK_CONFIDENTIALITY ?? null) : null;
}

/** Whether 1Click refused a confidential quote over access (missing or invalid partner key); other 4xx answers concern one coin. */
export function isConfidentialRefusal(error: OneClickError): boolean {
  return error.status === 401 || error.status === 403;
}

/** Whether a 1Click quote was issued as a confidential intent, read case-insensitively from the request 1Click signed with it. */
export function isConfidentialQuote(rawResponse: unknown): boolean {
  const level = (rawResponse as { quoteRequest?: { confidentiality?: unknown } } | null)?.quoteRequest?.confidentiality;
  return typeof level === "string" && ["basic", "advanced"].includes(level.toLowerCase());
}
