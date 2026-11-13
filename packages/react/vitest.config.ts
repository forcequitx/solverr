import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    /** Tests run against the embed source in this repository, not its last build. */
    alias: { "solverr-embed/core": fileURLToPath(new URL("../embed/src/core.ts", import.meta.url)) },
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.tsx"],
  },
});
