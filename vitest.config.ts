import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";
import { testEnv } from "./tests/test-env";

const ROOT = dirname(fileURLToPath(import.meta.url));

/** `vitest run` runs the unit tests (no network, no database); `vitest run --mode db` runs `tests/db` against TEST_DATABASE_URL. */
export default defineConfig(({ mode }) => {
  const db = mode === "db";
  return {
    resolve: { alias: [{ find: /^@\//, replacement: `${ROOT}/` }] },
    test: {
      environment: "node",
      include: db ? ["tests/db/**/*.test.ts"] : ["tests/**/*.test.ts"],
      exclude: db ? configDefaults.exclude : [...configDefaults.exclude, "tests/db/**", "tests/e2e/**"],
      env: testEnv(db ? process.env.TEST_DATABASE_URL : "postgresql://unit:unit@127.0.0.1:9/unit_tests_have_no_database"),
      restoreMocks: true,
      unstubEnvs: true,
      unstubGlobals: true,
      ...(db
        ? {
            globalSetup: ["tests/db/global-setup.ts"],
            setupFiles: ["tests/db/setup.ts"],
            /** Every file shares one database and the worker claims rows across businesses, so files run one at a time. */
            fileParallelism: false,
            testTimeout: 30_000,
            hookTimeout: 30_000,
          }
        : {}),
    },
  };
});
