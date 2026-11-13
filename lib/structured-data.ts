/** schema.org nodes for JSON-LD, built from what each page shows. URLs are absolute on the public APP_URL. */
type JsonLdNode = Record<string, unknown>;

const SITE_NAME = "Solverr";

/** Absolute URL of `path` on the app. */
function absolute(path: string, appUrl: string): string {
  return new URL(path, appUrl).toString();
}

/** Reference to the Organization node, so other nodes on any page point at the same entity. */
function organizationRef(appUrl: string): JsonLdNode {
  return { "@id": absolute("/#organization", appUrl) };
}

/** Reference to the WebSite node. */
function webSiteRef(appUrl: string): JsonLdNode {
  return { "@id": absolute("/#website", appUrl) };
}

export function organization(appUrl: string): JsonLdNode {
  return { "@type": "Organization", ...organizationRef(appUrl), name: SITE_NAME, url: absolute("/", appUrl), logo: absolute("/icon.svg", appUrl) };
}

export function webSite(appUrl: string, description: string): JsonLdNode {
  return { "@type": "WebSite", ...webSiteRef(appUrl), name: SITE_NAME, url: absolute("/", appUrl), description, inLanguage: "en", publisher: organizationRef(appUrl) };
}

/** The product itself. It carries no `offers`: Solverr has no price list, and the swap and network fees vary per payment. */
export function softwareApplication(appUrl: string, description: string): JsonLdNode {
  return {
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    url: absolute("/", appUrl),
    description,
    applicationCategory: "FinanceApplication",
    operatingSystem: "Web",
    publisher: organizationRef(appUrl),
  };
}

export function faqPage(items: readonly (readonly [question: string, answer: string])[]): JsonLdNode {
  return {
    "@type": "FAQPage",
    mainEntity: items.map(([question, answer]) => ({ "@type": "Question", name: question, acceptedAnswer: { "@type": "Answer", text: answer } })),
  };
}

/** A web page of the site, such as a tool page with no article text. */
export function webPage(appUrl: string, { title, description, path }: { title: string; description: string; path: string }): JsonLdNode {
  return { "@type": "WebPage", "@id": absolute(path, appUrl), url: absolute(path, appUrl), name: title, description, inLanguage: "en", isPartOf: webSiteRef(appUrl) };
}

/** A docs page; dates are left out because the docs keep no reliable edit date. */
export function techArticle(appUrl: string, { title, description, path }: { title: string; description: string; path: string }): JsonLdNode {
  return {
    "@type": "TechArticle",
    "@id": absolute(path, appUrl),
    url: absolute(path, appUrl),
    headline: title,
    description,
    inLanguage: "en",
    isPartOf: webSiteRef(appUrl),
    author: organizationRef(appUrl),
    publisher: organizationRef(appUrl),
  };
}

/** Trail of named pages, outermost first; repeated URLs are dropped, and a trail shorter than two pages gives null. */
export function breadcrumbList(appUrl: string, items: readonly { name: string; path: string }[]): JsonLdNode | null {
  const seen = new Set<string>();
  const trail = items.filter((item) => !seen.has(item.path) && seen.add(item.path));
  if (trail.length < 2) return null;
  return {
    "@type": "BreadcrumbList",
    itemListElement: trail.map((item, index) => ({ "@type": "ListItem", position: index + 1, name: item.name, item: absolute(item.path, appUrl) })),
  };
}

/** One JSON-LD document holding several nodes; null nodes are left out. */
export function jsonLdGraph(nodes: readonly (JsonLdNode | null)[]): JsonLdNode {
  return { "@context": "https://schema.org", "@graph": nodes.filter((node) => node !== null) };
}

/** JSON for a `<script type="application/ld+json">`; `<` is escaped so no text in it can close the script element. */
export function serializeJsonLd(data: JsonLdNode): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
