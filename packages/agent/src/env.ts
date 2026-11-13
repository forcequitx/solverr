import type { AgentWalletOptions } from "./agent-wallet.js";

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function usd(env: NodeJS.ProcessEnv, name: string): number {
  const value = Number(required(env, name));
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a USD amount, such as 5.`);
  return value;
}

function milliseconds(env: NodeJS.ProcessEnv, name: string): number | undefined {
  const value = env[name]?.trim();
  if (!value) return undefined;
  const ms = Number(value);
  if (!Number.isInteger(ms) || ms <= 0) throw new Error(`${name} must be a whole number of milliseconds.`);
  return ms;
}

const list = (value: string | undefined) => (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);

/** Reads AGENT_* variables. Required: AGENT_NEAR_ACCOUNT + AGENT_NEAR_KEY or AGENT_BASE_KEY, AGENT_LIMIT_PER_PAYMENT_USD, AGENT_LIMIT_DAILY_USD,
    AGENT_ALLOW_HOSTS, AGENT_TRUSTED_GATEWAYS; optional: AGENT_NEAR_RPC_URL, AGENT_BASE_RPC_URL, AGENT_SPEND_LOG, AGENT_PAYMENT_TIMEOUT_MS, AGENT_RESOURCE_TIMEOUT_MS. */
export function agentOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): AgentWalletOptions {
  const nearAccount = env.AGENT_NEAR_ACCOUNT?.trim();
  const nearKey = env.AGENT_NEAR_KEY?.trim();
  if (!!nearAccount !== !!nearKey) throw new Error("Set both AGENT_NEAR_ACCOUNT and AGENT_NEAR_KEY to use a NEAR wallet.");
  const baseKey = env.AGENT_BASE_KEY?.trim();
  if (!nearAccount && !baseKey) throw new Error("Set AGENT_NEAR_ACCOUNT and AGENT_NEAR_KEY, or AGENT_BASE_KEY.");

  const allow = list(env.AGENT_ALLOW_HOSTS);
  if (allow.length === 0) throw new Error("AGENT_ALLOW_HOSTS is required: a comma-separated list of hosts the agent may pay.");
  const trustedGateways = list(env.AGENT_TRUSTED_GATEWAYS);
  if (trustedGateways.length === 0) {
    throw new Error("AGENT_TRUSTED_GATEWAYS is required: a comma-separated list of Solverr URLs the agent may pay through, such as https://pay.example.com.");
  }
  return {
    ...(nearAccount && nearKey ? { near: { accountId: nearAccount, privateKey: nearKey, rpcUrl: env.AGENT_NEAR_RPC_URL?.trim() || undefined } } : {}),
    ...(baseKey ? { base: { privateKey: baseKey, rpcUrl: env.AGENT_BASE_RPC_URL?.trim() || undefined } } : {}),
    limits: { perPaymentUsd: usd(env, "AGENT_LIMIT_PER_PAYMENT_USD"), dailyUsd: usd(env, "AGENT_LIMIT_DAILY_USD"), allow },
    spendLogPath: env.AGENT_SPEND_LOG?.trim() || undefined,
    trustedGateways,
    paymentTimeoutMs: milliseconds(env, "AGENT_PAYMENT_TIMEOUT_MS"),
    resourceTimeoutMs: milliseconds(env, "AGENT_RESOURCE_TIMEOUT_MS"),
  };
}
