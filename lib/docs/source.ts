import { loader } from "fumadocs-core/source";
import { defineDocs } from "fumadocs-mdx/macro";
import { methodBadgesPlugin } from "@/lib/docs/method-badges";
import { openapi } from "@/lib/docs/openapi";

/** `includeProcessedMarkdown` keeps each page's Markdown for `getText("processed")`, which /llms-full.txt serves. */
const docs = defineDocs({ dir: "content/docs", docs: { postprocess: { includeProcessedMarkdown: true } } });

/** Docs pages from content/docs plus generated API reference pages from openapi/openapi.yaml. The `icon` resolver keeps page icons out of
    the navigation, where only API pages show a method badge; a page's `icon` frontmatter is used by the cards that link to it. */
export const source = loader(
  {
    docs: docs.toFumadocsSource(),
    openapi: await openapi.staticSource({ baseDir: "api" }),
  },
  { baseUrl: "/docs", icon: () => undefined, plugins: [methodBadgesPlugin()] },
);
