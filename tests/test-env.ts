import { randomBytes } from "node:crypto";

/** Throwaway settings that pass `lib/env.ts`; keys are generated per run and every outside service points at a host that never resolves,
    except EVM chains: with no `EVM_RPC_URLS` entry they use viem's public RPCs. Empty values count as unset, so settings from the developer's
    shell or `.env` cannot reach the tests. */
export function testEnv(databaseUrl: string | undefined, overrides: Record<string, string> = {}): Record<string, string | undefined> {
  return {
    DATABASE_URL: databaseUrl,
    DATABASE_CA_CERT: "",
    DATABASE_CLIENT_CERT: "",
    DATABASE_CLIENT_KEY: "",
    DATABASE_POOL_MAX: "5",
    APP_URL: "http://localhost:3000",
    ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    BETTER_AUTH_SECRET: randomBytes(32).toString("base64"),
    ONECLICK_BASE_URL: "https://oneclick.invalid",
    ONECLICK_API_KEY: "",
    ONECLICK_CONFIDENTIALITY: "",
    NEAR_RPC_URL: "https://near-rpc.invalid",
    SOLANA_RPC_URL: "https://solana-rpc.invalid",
    EVM_RPC_URLS: "",
    RESEND_API_KEY: "",
    EMAIL_FROM: "",
    TELEGRAM_BOT_TOKEN: "",
    TELEGRAM_WEBHOOK_SECRET: "",
    SENTRY_DSN: "",
    ...overrides,
  };
}
