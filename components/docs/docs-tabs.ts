import type * as PageTree from "fumadocs-core/page-tree";

type DocsTab = { value: string; title: PageTree.Folder["name"]; url: string; nodes: PageTree.Node[] };

function firstUrl(nodes: PageTree.Node[]): string | undefined {
  for (const node of nodes) {
    if (node.type === "page") return node.url;
    if (node.type === "folder") {
      const url = node.index?.url ?? firstUrl(node.children);
      if (url) return url;
    }
  }
  return undefined;
}

function hasUrl(nodes: PageTree.Node[], url: string): boolean {
  return nodes.some((node) => (node.type === "page" ? node.url === url : node.type === "folder" && (node.index?.url === url || hasUrl(node.children, url))));
}

/** Docs sections shown as tabs: the main docs, then each root folder (`"root": true` in its meta.json), such as the API reference. */
export function docsTabs(tree: PageTree.Root): DocsTab[] {
  const roots = tree.children.filter((node): node is PageTree.Folder => node.type === "folder" && Boolean(node.root));
  const main = tree.children.filter((node) => !roots.includes(node as PageTree.Folder));
  return [
    { value: "docs", title: "Documentation", url: firstUrl(main) ?? "/docs", nodes: main },
    ...roots.map((folder, index) => {
      const nodes = folder.index && !folder.children.includes(folder.index) ? [folder.index, ...folder.children] : folder.children;
      return { value: folder.$id ?? `root-${index}`, title: folder.name, url: firstUrl(nodes) ?? "/docs", nodes };
    }),
  ];
}

export function activeDocsTab(tabs: DocsTab[], pathname: string): DocsTab {
  return tabs.find((tab) => hasUrl(tab.nodes, pathname)) ?? tabs[0];
}
