import { createOpenAPI } from "fumadocs-openapi/server";

/** The public API spec; API reference pages under /docs/api are generated from it. */
export const openapi = createOpenAPI({ input: ["./openapi/openapi.yaml"] });
