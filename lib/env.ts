import { z } from "zod";

/** Env files pass `KEY=` as an empty string; it is treated as "not set" so defaults and optionals apply. */
const unsetIfEmpty = (value: unknown) => (value === "" ? undefined : value);
const optionalString = z.preprocess(unsetIfEmpty, z.string().optional());
const urlWithDefault = (fallback: string) => z.preprocess(unsetIfEmpty, z.url().default(fallback));

/** `chainId=url` pairs separated by commas, read into a map from EVM chain id to its RPC address. */
const evmRpcUrls = z.preprocess(unsetIfEmpty, z.string().optional()).transform((value, ctx) => {
  const urls = new Map<number, string>();
  for (const entry of (value ?? "").split(",").map((part) => part.trim()).filter(Boolean)) {
    const separator = entry.indexOf("=");
    const chainId = Number(entry.slice(0, separator));
    const url = entry.slice(separator + 1);
    if (separator < 1 || !Number.isInteger(chainId) || !URL.canParse(url) || !/^https?:/.test(url)) {
      ctx.addIssue({ code: "custom", message: "EVM_RPC_URLS entries must look like 8453=https://base.example" });
      return z.NEVER;
    }
    urls.set(chainId, url);
  }
  return urls;
});

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1"]);
/** Production serves sessions and checkout links from APP_URL, so it must be https unless the server runs locally. */
const servesSecurely = (value: string) => {
  if (process.env.NODE_ENV !== "production" || !URL.canParse(value)) return true;
  const url = new URL(value);
  return url.protocol === "https:" || (url.protocol === "http:" && LOCAL_HOSTNAMES.has(url.hostname));
};

const PAIRED_SETTINGS = [
  ["DATABASE_CLIENT_CERT", "DATABASE_CLIENT_KEY"],
  ["RESEND_API_KEY", "EMAIL_FROM"],
  ["TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET"],
] as const;

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  /** PEM of the CA that signed the database certificate; set where the database is reached over the internet (Vercel) to require TLS. */
  DATABASE_CA_CERT: z.preprocess(
    unsetIfEmpty,
    z.string().includes("-----BEGIN CERTIFICATE-----", { error: "DATABASE_CA_CERT must be a PEM certificate" }).optional(),
  ),
  /** The website's client certificate and its PEM key (deploy/postgres-tls.sh), which the database's PgBouncer requires before any password. */
  DATABASE_CLIENT_CERT: z.preprocess(
    unsetIfEmpty,
    z.string().includes("-----BEGIN CERTIFICATE-----", { error: "DATABASE_CLIENT_CERT must be a PEM certificate" }).optional(),
  ),
  DATABASE_CLIENT_KEY: z.preprocess(unsetIfEmpty, z.string().includes("PRIVATE KEY-----", { error: "DATABASE_CLIENT_KEY must be a PEM private key" }).optional()),
  /** Most database connections one process keeps; each Vercel function instance is one process, so keep it small there. */
  DATABASE_POOL_MAX: z.preprocess(unsetIfEmpty, z.coerce.number().int().min(1).max(100).default(10)),
  APP_URL: z.url().refine(servesSecurely, "APP_URL must use https in production (http is allowed only for localhost and 127.0.0.1)"),
  ONECLICK_BASE_URL: urlWithDefault("https://1click.chaindefuser.com"),
  ONECLICK_API_KEY: optionalString,
  /** Confidential Intents level for private payments; 1Click quotes it only with the partner key, so both must be set to offer them. */
  ONECLICK_CONFIDENTIALITY: z.preprocess(unsetIfEmpty, z.enum(["basic", "advanced"]).optional()),
  ENCRYPTION_KEY: z
    .string()
    .refine((value) => Buffer.from(value, "base64").length === 32, "ENCRYPTION_KEY must be 32 bytes, base64-encoded"),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  NEAR_RPC_URL: urlWithDefault("https://free.rpc.fastnear.com"),
  /** Solana RPC the server uses to check transfers and read Earn vault balances. */
  SOLANA_RPC_URL: urlWithDefault("https://api.mainnet-beta.solana.com"),
  /** Server EVM RPCs (transfer checks, smart-wallet signatures, Earn balances) as `8453=https://base.example,1=…`; else viem's public RPC. */
  EVM_RPC_URLS: evmRpcUrls,
  RESEND_API_KEY: optionalString,
  EMAIL_FROM: optionalString,
  /** Telegram bot token from BotFather; the Telegram bot is off without it. */
  TELEGRAM_BOT_TOKEN: optionalString,
  /** Random string Telegram echoes in a header so the webhook can reject forged updates. */
  TELEGRAM_WEBHOOK_SECRET: z.preprocess(unsetIfEmpty, z.string().min(32, "TELEGRAM_WEBHOOK_SECRET must be at least 32 characters").optional()),
  /** DSN of the GlitchTip project that receives server and worker errors; error reports are off without it. */
  SENTRY_DSN: z.preprocess(unsetIfEmpty, z.url().optional()),
}).superRefine((env, ctx) => {
  /** Settings that work only as a pair: one without the other would quietly turn the feature off. */
  for (const [a, b] of PAIRED_SETTINGS) {
    if (Boolean(env[a]) !== Boolean(env[b])) ctx.addIssue({ code: "custom", path: [env[a] ? b : a], message: `${a} and ${b} must be set together` });
  }
  /** A client certificate is sent only over the verified TLS that DATABASE_CA_CERT turns on. */
  if (env.DATABASE_CLIENT_CERT && !env.DATABASE_CA_CERT) {
    ctx.addIssue({ code: "custom", path: ["DATABASE_CA_CERT"], message: "DATABASE_CLIENT_CERT needs DATABASE_CA_CERT" });
  }
});

type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** Reads and validates environment variables on first use, so builds without runtime env still succeed. */
export function getEnv(): Env {
  if (!cached) {
    const result = envSchema.safeParse(process.env);
    if (!result.success) {
      const names = result.error.issues.map((issue) => issue.path.join(".")).join(", ");
      throw new Error(`Invalid or missing environment variables: ${names}`);
    }
    cached = result.data;
  }
  return cached;
}
