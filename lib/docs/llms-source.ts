import { plainText } from "@/components/docs/inline-code";
import { CHAINS } from "@/lib/chains/registry";
import { docsSections, llmsFullPage, llmsIndex, type LlmsSection } from "@/lib/docs/llms";
import { source } from "@/lib/docs/source";
import { snippet } from "@/lib/metadata";

const SUMMARY = `Solverr is a non-custodial crypto checkout built on NEAR Intents. Customers and AI agents pay with coins on ${CHAINS.length} chains, and the business receives the coin it chooses in its own wallet.`;

const DETAILS = [
  "Solverr charges no gateway fee: the payer covers the NEAR Intents swap fee and the network fee of their own transfer.",
  "A business integrates through payment links, a script button, a React component, Node, PHP and Python SDKs, WooCommerce, a Telegram bot, the REST API with webhooks, an MCP server, and HTTP 402 paywalls for AI agents.",
  "In the docs, `your-solverr-host` stands for the address of the Solverr app.",
].join(" ");

/** Docs pages by URL path, with the absolute URL and a one-line description llms.txt lists. */
function docsPages(appUrl: string) {
  return new Map(
    source.getPages().map((page) => [
      page.url,
      {
        page,
        entry: { title: page.data.title ?? page.url, url: new URL(page.url, appUrl).toString(), description: page.data.description ? snippet(plainText(page.data.description)) : undefined },
      },
    ]),
  );
}

/** The docs pages grouped like the sidebar. */
function sections(pages: ReturnType<typeof docsPages>): LlmsSection[] {
  return docsSections(source.getPageTree(), (url) => pages.get(url)?.entry);
}

/** /llms.txt: every docs page grouped like the sidebar, then the pages an answer engine may skip. */
export function llmsIndexText(appUrl: string): string {
  const link = (path: string) => new URL(path, appUrl).toString();
  const optional: LlmsSection = {
    title: "Optional",
    pages: [
      { title: "Full docs text", url: link("/llms-full.txt"), description: "Every docs page above in one Markdown file" },
      { title: "Demo store", url: link("/demo"), description: "A pretend coffee shop that opens the checkout in test mode, where no real money moves" },
      { title: "Payment help", url: link("/help"), description: "Where customers find a payment by its ID or transaction hash and open a support case" },
    ],
  };
  return llmsIndex({ name: "Solverr", summary: SUMMARY, details: DETAILS, sections: [...sections(docsPages(appUrl)), optional] });
}

/** /llms-full.txt: the text of every docs page in sidebar order; API reference pages give their operation description. */
export async function llmsFullText(appUrl: string): Promise<string> {
  const pages = docsPages(appUrl);
  const ordered = sections(pages).flatMap((section) => section.pages);
  const byUrl = new Map([...pages.values()].map((item) => [item.entry.url, item.page]));
  const parts = await Promise.all(
    ordered.map(async (entry) => {
      const page = byUrl.get(entry.url);
      if (!page) return "";
      const markdown = page.type === "openapi" ? (page.data.description ?? "") : await page.data.getText("processed");
      return llmsFullPage(entry, markdown);
    }),
  );
  return `${[`# Solverr docs`, `> ${SUMMARY}`, DETAILS, ...parts.filter(Boolean)].join("\n\n")}\n`;
}
