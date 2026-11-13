import type * as PageTree from "fumadocs-core/page-tree";

/** A docs page as llms.txt lists it; `url` is absolute. */
export interface LlmsPage {
  title: string;
  url: string;
  description?: string;
}

/** One `##` section of llms.txt: a docs sidebar group and its pages in sidebar order. */
export interface LlmsSection {
  title: string;
  pages: LlmsPage[];
}

function textOf(name: unknown): string {
  return typeof name === "string" ? name.trim() : "";
}

/** Groups the docs pages like the sidebar: each folder and each named separator starts a section,
    and a separator inside a folder is named "Folder: Separator". Pages `pageFor` does not know are skipped. */
export function docsSections(tree: PageTree.Root, pageFor: (url: string) => LlmsPage | undefined): LlmsSection[] {
  const sections: LlmsSection[] = [];
  const listed = new Set<string>();
  let current: LlmsSection | null = null;

  const open = (title: string): LlmsSection => {
    const section = { title, pages: [] };
    sections.push(section);
    current = section;
    return section;
  };
  const add = (url: string, fallbackTitle: string) => {
    const page = pageFor(url);
    if (!page || listed.has(url)) return;
    listed.add(url);
    (current ?? open(fallbackTitle)).pages.push(page);
  };
  const walk = (nodes: PageTree.Node[], folder: string) => {
    for (const node of nodes) {
      if (node.type === "page") add(node.url, folder || textOf(tree.name));
      else if (node.type === "separator") {
        const name = textOf(node.name);
        if (name) open(folder ? `${folder}: ${name}` : name);
        else current = null;
      } else {
        const name = textOf(node.name);
        open(name);
        if (node.index) add(node.index.url, name);
        walk(node.children, name);
        current = null;
      }
    }
  };

  walk(tree.children, "");
  return sections.filter((section) => section.pages.length > 0);
}

/** The llms.txt index (https://llmstxt.org): name, summary, details, then one link list per section. */
export function llmsIndex({ name, summary, details, sections }: { name: string; summary: string; details: string; sections: readonly LlmsSection[] }): string {
  const lists = sections.map(
    (section) => `## ${section.title}\n\n${section.pages.map((page) => `- [${page.title}](${page.url})${page.description ? `: ${page.description}` : ""}`).join("\n")}`,
  );
  return `${[`# ${name}`, `> ${summary}`, details, ...lists].join("\n\n")}\n`;
}

/** One page of llms-full.txt: title, address, description and the page's Markdown text. */
export function llmsFullPage({ title, url, description }: LlmsPage, markdown: string): string {
  return [`# ${title}`, `URL: ${url}`, description ? `> ${description}` : "", markdown.trim()].filter(Boolean).join("\n\n");
}
