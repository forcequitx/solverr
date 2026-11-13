import { afterEach, describe, expect, it, vi } from "vitest";

const PEM_CERT = "-----BEGIN CERTIFICATE-----\nMIIBtest\n-----END CERTIFICATE-----\n";
const PEM_CA = "-----BEGIN CERTIFICATE-----\nMIIBca\n-----END CERTIFICATE-----\n";
const PEM_KEY = "-----BEGIN PRIVATE KEY-----\nMIIEtest\n-----END PRIVATE KEY-----\n";

/** `lib/env.ts` caches the settings on first read, so each case loads `databaseTls` fresh with its own database settings. */
async function databaseTlsWith(settings: Record<string, string>) {
  vi.resetModules();
  for (const name of ["DATABASE_CA_CERT", "DATABASE_CLIENT_CERT", "DATABASE_CLIENT_KEY"]) vi.stubEnv(name, settings[name] ?? "");
  const { databaseTls } = await import("@/lib/db");
  return databaseTls();
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("databaseTls", () => {
  it("is plain without DATABASE_CA_CERT, as on the server's own network", async () => {
    expect(await databaseTlsWith({})).toBeUndefined();
  });

  it("verifies the database certificate against DATABASE_CA_CERT", async () => {
    expect(await databaseTlsWith({ DATABASE_CA_CERT: PEM_CA })).toEqual({ ca: PEM_CA, rejectUnauthorized: true });
  });

  it("shows the client certificate and key when both are set", async () => {
    const tls = await databaseTlsWith({ DATABASE_CA_CERT: PEM_CA, DATABASE_CLIENT_CERT: PEM_CERT, DATABASE_CLIENT_KEY: PEM_KEY });
    expect(tls).toEqual({ ca: PEM_CA, rejectUnauthorized: true, cert: PEM_CERT, key: PEM_KEY });
  });

  it("refuses a client certificate without its key, and a key without its certificate", async () => {
    await expect(databaseTlsWith({ DATABASE_CA_CERT: PEM_CA, DATABASE_CLIENT_CERT: PEM_CERT })).rejects.toThrow(/DATABASE_CLIENT_KEY/);
    await expect(databaseTlsWith({ DATABASE_CA_CERT: PEM_CA, DATABASE_CLIENT_KEY: PEM_KEY })).rejects.toThrow(/DATABASE_CLIENT_CERT/);
  });

  it("refuses a client certificate without DATABASE_CA_CERT, since it is only sent over verified TLS", async () => {
    await expect(databaseTlsWith({ DATABASE_CLIENT_CERT: PEM_CERT, DATABASE_CLIENT_KEY: PEM_KEY })).rejects.toThrow(/DATABASE_CA_CERT/);
  });

  it("refuses settings that are not PEM", async () => {
    await expect(databaseTlsWith({ DATABASE_CA_CERT: PEM_CA, DATABASE_CLIENT_CERT: "not a cert", DATABASE_CLIENT_KEY: PEM_KEY })).rejects.toThrow(
      /DATABASE_CLIENT_CERT/,
    );
    await expect(databaseTlsWith({ DATABASE_CA_CERT: PEM_CA, DATABASE_CLIENT_CERT: PEM_CERT, DATABASE_CLIENT_KEY: "not a key" })).rejects.toThrow(
      /DATABASE_CLIENT_KEY/,
    );
  });
});
