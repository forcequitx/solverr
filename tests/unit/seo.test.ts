import type * as PageTree from "fumadocs-core/page-tree";
import { describe, expect, it } from "vitest";
import { docsSections, llmsFullPage, llmsIndex, type LlmsPage } from "@/lib/docs/llms";
import { pageMetadata, snippet } from "@/lib/metadata";
import { breadcrumbList, faqPage, jsonLdGraph, organization, serializeJsonLd, techArticle } from "@/lib/structured-data";

const APP_URL = "https://pay.example";

describe("pageMetadata", () => {
  it("sets the canonical and Open Graph URL only for a page that names its path", () => {
    const page = pageMetadata("Help · Solverr", "Find a payment.", "/help");
    expect(page.alternates).toEqual({ canonical: "/help" });
    expect(page.openGraph).toMatchObject({ url: "/help", title: "Help · Solverr", images: [{ url: "/opengraph-image" }] });
    const layout = pageMetadata("Solverr", "Default text.");
    expect(layout.alternates).toBeUndefined();
    expect(layout.openGraph).not.toHaveProperty("url");
  });
});

describe("snippet", () => {
  it("keeps a short first paragraph on one line", () => {
    expect(snippet("Returns one invoice\nwith its status.\n\nSecond paragraph.")).toBe("Returns one invoice with its status.");
  });

  it("cuts after the last whole sentence that fits, ignoring decimal points", () => {
    const text = `Charges about 0.2% per swap. ${"A long sentence that keeps going ".repeat(6)}until it ends.`;
    expect(snippet(text)).toBe("Charges about 0.2% per swap.");
  });

  it("cuts at a word with an ellipsis when the first sentence is too long", () => {
    const result = snippet("word ".repeat(60).trim(), 30);
    expect(result).toBe("word word word word word word…");
    expect(result.length).toBeLessThanOrEqual(30);
  });
});

describe("structured data", () => {
  it("escapes < so text cannot close the script element", () => {
    const json = serializeJsonLd(faqPage([["Is </script> safe?", "Yes."]]));
    expect(json).not.toContain("<");
    expect(JSON.parse(json).mainEntity[0].name).toBe("Is </script> safe?");
  });

  it("builds a graph whose nodes reference one organization", () => {
    const graph = jsonLdGraph([organization(APP_URL), techArticle(APP_URL, { title: "Refunds", description: "Return money.", path: "/docs/payments/refunds" }), null]);
    expect(graph["@context"]).toBe("https://schema.org");
    const [org, article] = graph["@graph"] as Record<string, unknown>[];
    expect(org).toMatchObject({ "@id": "https://pay.example/#organization", url: "https://pay.example/", logo: "https://pay.example/icon.svg" });
    expect(article).toMatchObject({ "@type": "TechArticle", url: "https://pay.example/docs/payments/refunds", publisher: { "@id": "https://pay.example/#organization" } });
    expect(graph["@graph"]).toHaveLength(2);
  });

  it("drops repeated breadcrumb URLs and gives null for a single page", () => {
    const list = breadcrumbList(APP_URL, [
      { name: "Docs", path: "/docs" },
      { name: "API reference", path: "/docs/api" },
      { name: "Overview", path: "/docs/api" },
    ]);
    expect(list?.itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "Docs", item: "https://pay.example/docs" },
      { "@type": "ListItem", position: 2, name: "API reference", item: "https://pay.example/docs/api" },
    ]);
    expect(breadcrumbList(APP_URL, [{ name: "Docs", path: "/docs" }, { name: "What Solverr is", path: "/docs" }])).toBeNull();
  });
});

describe("llms.txt", () => {
  const page = (url: string, name: string): PageTree.Item => ({ type: "page", url, name });
  const tree: PageTree.Root = {
    name: "Solverr docs",
    children: [
      { type: "separator", name: "Get started" },
      page("/docs", "What Solverr is"),
      page("/docs/quickstart", "Quickstart"),
      { type: "separator" },
      { type: "folder", name: "Webhooks", children: [page("/docs/webhooks/events", "Events"), page("/docs/missing", "Not a page")] },
      {
        type: "folder",
        name: "API reference",
        root: true,
        index: page("/docs/api", "Overview"),
        children: [page("/docs/api", "Overview"), { type: "separator", name: "Invoices" }, page("/docs/api/createInvoice", "Create an invoice")],
      },
    ],
  };
  const known: Record<string, LlmsPage> = {
    "/docs": { title: "What Solverr is", url: `${APP_URL}/docs`, description: "What Solverr does" },
    "/docs/quickstart": { title: "Quickstart", url: `${APP_URL}/docs/quickstart` },
    "/docs/webhooks/events": { title: "Events and payload", url: `${APP_URL}/docs/webhooks/events` },
    "/docs/api": { title: "Overview", url: `${APP_URL}/docs/api` },
    "/docs/api/createInvoice": { title: "Create an invoice", url: `${APP_URL}/docs/api/createInvoice` },
  };

  it("groups pages like the sidebar, once each, skipping unknown pages", () => {
    const sections = docsSections(tree, (url) => known[url]);
    expect(sections.map((section) => [section.title, section.pages.map((entry) => entry.title)])).toEqual([
      ["Get started", ["What Solverr is", "Quickstart"]],
      ["Webhooks", ["Events and payload"]],
      ["API reference", ["Overview"]],
      ["API reference: Invoices", ["Create an invoice"]],
    ]);
  });

  it("writes the index in the llms.txt layout", () => {
    const text = llmsIndex({ name: "Solverr", summary: "A checkout.", details: "Details.", sections: docsSections(tree, (url) => known[url]).slice(0, 1) });
    expect(text).toBe(
      "# Solverr\n\n> A checkout.\n\nDetails.\n\n## Get started\n\n- [What Solverr is](https://pay.example/docs): What Solverr does\n- [Quickstart](https://pay.example/docs/quickstart)\n",
    );
  });

  it("writes one full page with its address and text", () => {
    expect(llmsFullPage(known["/docs"], "\nBody text.\n")).toBe("# What Solverr is\n\nURL: https://pay.example/docs\n\n> What Solverr does\n\nBody text.");
  });
});
