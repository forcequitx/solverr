#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createAgentWallet } from "./agent-wallet.js";
import { agentOptionsFromEnv } from "./env.js";
import { errorSummary } from "./errors.js";
import { normalizeLimits } from "./limits.js";
import { serveAgentMcp } from "./mcp-server.js";

const USAGE = `Usage: solverr-agent mcp

Starts a local MCP server on stdin/stdout with the tools pay_url, get_balances, get_spending and set_limits.

Environment:
  AGENT_NEAR_ACCOUNT, AGENT_NEAR_KEY   NEAR account and ed25519: private key
  AGENT_BASE_KEY                       Base private key (0x…)
  AGENT_LIMIT_PER_PAYMENT_USD          Largest single payment in USD (required)
  AGENT_LIMIT_DAILY_USD                Largest total over 24 hours in USD (required)
  AGENT_ALLOW_HOSTS                    Comma-separated hosts the agent may request and pay (required)
  AGENT_TRUSTED_GATEWAYS               Comma-separated Solverr URLs to pay through (required)
  AGENT_NEAR_RPC_URL, AGENT_BASE_RPC_URL, AGENT_SPEND_LOG   Optional
  AGENT_PAYMENT_TIMEOUT_MS, AGENT_RESOURCE_TIMEOUT_MS      Optional timeouts in ms
`;

function packageVersion(): string {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
  return manifest.version;
}

function main(argv: string[]): void {
  const [command] = argv;
  if (command !== "mcp") {
    process.stderr.write(USAGE);
    process.exitCode = command === "--help" || command === "-h" ? 0 : 1;
    return;
  }
  const options = agentOptionsFromEnv();
  const agent = createAgentWallet(options);
  serveAgentMcp(agent, { name: "solverr-agent", version: packageVersion(), ceiling: normalizeLimits(options.limits) });
}

try {
  main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`solverr-agent: ${errorSummary(error)}\n`);
  process.exitCode = 1;
}
