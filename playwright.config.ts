import os from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

/** The browser tests' own server (tests/e2e/server.ts), away from the 3002 of `npm run dev`; its 1Click stand-in listens on PORT + 99. */
const PORT = 3100;

/** `npm run test:e2e`: needs TEST_DATABASE_URL (a throwaway database, reset on start) and Chromium (`npx playwright install chromium`). */
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  outputDir: path.join(os.tmpdir(), "solverr-e2e"),
  /** One database and one demo store serve every test, so files run one at a time. */
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } }, grepInvert: /@phone/ },
    { name: "phone", use: { ...devices["Pixel 7"] }, grep: /@phone/ },
  ],
  webServer: {
    command: "npx tsx tests/e2e/server.ts",
    url: `http://localhost:${PORT}/robots.txt`,
    env: { E2E_PORT: String(PORT) },
    timeout: 300_000,
    reuseExistingServer: false,
    stdout: "ignore",
    stderr: "pipe",
  },
});
