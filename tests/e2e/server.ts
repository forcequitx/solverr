/** Starts what the browser tests talk to: a fresh test database, a local stand-in for the 1Click API, the worker, and a dev server that
    builds into `.next-e2e` so a developer's own `npm run dev` keeps running. Playwright starts it (playwright.config.ts) and stops it after. */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import resetTestDatabase from "../db/global-setup";
import { testEnv } from "../test-env";
import { startMockOneClick } from "./mock-oneclick";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(path.join(ROOT, "package.json"));
/** Set by playwright.config.ts, which also points the browser at it. */
const E2E_PORT = Number(process.env.E2E_PORT);
const ONECLICK_PORT = E2E_PORT + 99;

await resetTestDatabase();
await startMockOneClick(ONECLICK_PORT);

const env = {
  ...process.env,
  ...testEnv(process.env.TEST_DATABASE_URL, {
    APP_URL: `http://localhost:${E2E_PORT}`,
    ONECLICK_BASE_URL: `http://127.0.0.1:${ONECLICK_PORT}`,
    NEXT_DIST_DIR: ".next-e2e",
    NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: "",
    NEXT_PUBLIC_SOLANA_RPC_URL: "",
    NEXT_PUBLIC_NEAR_RPC_URL: "",
    NEXT_TELEMETRY_DISABLED: "1",
  }),
};

const children: ChildProcess[] = [
  spawn(process.execPath, [require.resolve("next/dist/bin/next"), "dev", "--port", String(E2E_PORT)], { cwd: ROOT, env, stdio: "inherit" }),
  spawn(process.execPath, [require.resolve("tsx/cli"), "worker/index.ts"], { cwd: ROOT, env, stdio: "inherit" }),
];

/** Stops both servers with everything they started (`next dev` runs its own child processes). */
function stop(): void {
  for (const child of children) {
    if (child.pid === undefined || child.exitCode !== null) continue;
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else child.kill("SIGTERM");
  }
}
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => (stop(), process.exit(0)));
process.on("exit", stop);
for (const child of children) child.on("exit", (code) => code && code !== 0 && (stop(), process.exit(code)));
