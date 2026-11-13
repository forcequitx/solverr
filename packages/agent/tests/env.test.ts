import { describe, expect, it } from "vitest";
import { agentOptionsFromEnv } from "../src/env.js";

const base = {
  AGENT_BASE_KEY: "0xkey",
  AGENT_LIMIT_PER_PAYMENT_USD: "1",
  AGENT_LIMIT_DAILY_USD: "5",
  AGENT_ALLOW_HOSTS: "api.example.com",
  AGENT_TRUSTED_GATEWAYS: "https://pay.example.com",
};

describe("agentOptionsFromEnv", () => {
  it("reads a Base wallet, limits, hosts and gateways", () => {
    expect(agentOptionsFromEnv(base)).toEqual({
      base: { privateKey: "0xkey", rpcUrl: undefined },
      limits: { perPaymentUsd: 1, dailyUsd: 5, allow: ["api.example.com"] },
      spendLogPath: undefined,
      trustedGateways: ["https://pay.example.com"],
      paymentTimeoutMs: undefined,
      resourceTimeoutMs: undefined,
    });
  });

  it("reads a NEAR wallet and every optional setting, trimming values and list items", () => {
    const options = agentOptionsFromEnv({
      ...base,
      AGENT_BASE_KEY: undefined,
      AGENT_NEAR_ACCOUNT: " agent.near ",
      AGENT_NEAR_KEY: "ed25519:abc",
      AGENT_NEAR_RPC_URL: "https://rpc.example.com",
      AGENT_ALLOW_HOSTS: " api.example.com , *.data.example.com ,, ",
      AGENT_TRUSTED_GATEWAYS: "https://pay.example.com, https://pay2.example.com",
      AGENT_SPEND_LOG: " /tmp/log.json ",
      AGENT_PAYMENT_TIMEOUT_MS: "60000",
      AGENT_RESOURCE_TIMEOUT_MS: " 120000 ",
    });
    expect(options.near).toEqual({ accountId: "agent.near", privateKey: "ed25519:abc", rpcUrl: "https://rpc.example.com" });
    expect(options.base).toBeUndefined();
    expect(options.limits.allow).toEqual(["api.example.com", "*.data.example.com"]);
    expect(options.trustedGateways).toEqual(["https://pay.example.com", "https://pay2.example.com"]);
    expect(options.spendLogPath).toBe("/tmp/log.json");
    expect(options.paymentTimeoutMs).toBe(60000);
    expect(options.resourceTimeoutMs).toBe(120000);
  });

  it("reads both wallets when both are set", () => {
    const options = agentOptionsFromEnv({ ...base, AGENT_NEAR_ACCOUNT: "agent.near", AGENT_NEAR_KEY: "ed25519:abc", AGENT_BASE_RPC_URL: "https://base.example.com" });
    expect(options.near?.accountId).toBe("agent.near");
    expect(options.base).toEqual({ privateKey: "0xkey", rpcUrl: "https://base.example.com" });
  });

  it.each([
    ["no wallet", { AGENT_BASE_KEY: "  " }, "AGENT_BASE_KEY"],
    ["a NEAR account without its key", { AGENT_NEAR_ACCOUNT: "agent.near" }, "Set both AGENT_NEAR_ACCOUNT and AGENT_NEAR_KEY"],
    ["a NEAR key without its account", { AGENT_NEAR_KEY: "ed25519:abc" }, "Set both AGENT_NEAR_ACCOUNT and AGENT_NEAR_KEY"],
    ["no allowed hosts", { AGENT_ALLOW_HOSTS: " , " }, "AGENT_ALLOW_HOSTS is required"],
    ["no trusted gateways", { AGENT_TRUSTED_GATEWAYS: undefined }, "AGENT_TRUSTED_GATEWAYS is required"],
    ["no per-payment limit", { AGENT_LIMIT_PER_PAYMENT_USD: undefined }, "AGENT_LIMIT_PER_PAYMENT_USD is required"],
    ["a daily limit that is not a number", { AGENT_LIMIT_DAILY_USD: "five" }, "AGENT_LIMIT_DAILY_USD must be a USD amount"],
    ["a negative limit", { AGENT_LIMIT_DAILY_USD: "-1" }, "AGENT_LIMIT_DAILY_USD must be a USD amount"],
    ["a fractional payment timeout", { AGENT_PAYMENT_TIMEOUT_MS: "1.5" }, "AGENT_PAYMENT_TIMEOUT_MS"],
    ["a zero payment timeout", { AGENT_PAYMENT_TIMEOUT_MS: "0" }, "AGENT_PAYMENT_TIMEOUT_MS"],
    ["a resource timeout that is not a number", { AGENT_RESOURCE_TIMEOUT_MS: "2m" }, "AGENT_RESOURCE_TIMEOUT_MS"],
    ["a negative resource timeout", { AGENT_RESOURCE_TIMEOUT_MS: "-5" }, "AGENT_RESOURCE_TIMEOUT_MS"],
  ])("refuses %s", (_name, change, message) => {
    expect(() => agentOptionsFromEnv({ ...base, ...change })).toThrow(message);
  });
});
