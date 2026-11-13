import type { LoaderPlugin } from "fumadocs-core/source";
import { createElement } from "react";
import { MethodBadge } from "@/components/docs/method-badge";

/** Gives each generated API reference page its HTTP method badge as the sidebar icon. */
export function methodBadgesPlugin(): LoaderPlugin {
  return {
    name: "solverr:method-badges",
    transformPageTree: {
      file(node, filePath) {
        if (!filePath) return node;
        const file = this.storage.read(filePath);
        if (file?.format !== "page") return node;
        const method = (file.data as { _openapi?: { method?: string } })._openapi?.method;
        if (method) node.icon = createElement(MethodBadge, { method });
        return node;
      },
    },
  };
}
