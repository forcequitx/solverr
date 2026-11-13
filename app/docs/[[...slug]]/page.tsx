import { getBreadcrumbItems } from "fumadocs-core/breadcrumb";
import { findNeighbour } from "fumadocs-core/page-tree";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createRelativeLink } from "fumadocs-ui/mdx";
import { OpenAPIPage } from "@/components/docs/api-page-lazy";
import { BracketLabel } from "@/components/docs/bracket-label";
import { DocsPager } from "@/components/docs/docs-page-nav";
import { DocsToc, DocsTocMenu } from "@/components/docs/docs-toc";
import { plainText, TextWithCode } from "@/components/docs/inline-code";
import { getMDXComponents } from "@/components/docs/mdx";
import { JsonLd } from "@/components/seo/json-ld";
import { source } from "@/lib/docs/source";
import { getEnv } from "@/lib/env";
import { pageMetadata, snippet } from "@/lib/metadata";
import { breadcrumbList, jsonLdGraph, techArticle } from "@/lib/structured-data";

/** Link preview text for a docs page whose frontmatter or OpenAPI operation has no description. */
const DOCS_DESCRIPTION = "Guides and API reference for accepting crypto payments with Solverr.";

/** Guide text: muted body, light section headings and accent list numbers. API endpoint content keeps the Fumadocs styles. */
const GUIDE_PROSE =
  "[--tw-prose-body:var(--muted)] [&_h2]:mb-3.5 [&_h2]:mt-12 [&_h2]:text-[27px] [&_h2]:font-light [&_h2]:leading-tight [&_h2]:tracking-[-0.03em] [&_h3]:text-[21px] [&_h3]:font-normal [&_h3]:tracking-[-0.02em] [&_ol]:marker:font-semibold [&_ol]:marker:text-accent-text";

export default async function Page(props: PageProps<"/docs/[[...slug]]">) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const tree = source.getPageTree();
  /** The nearest group (sidebar separator or folder) names the page's section in the label above the title. */
  const section = getBreadcrumbItems(page.url, tree, { includeSeparator: true }).at(-1)?.name ?? "Docs";
  const neighbours = findNeighbour(tree, page.url);
  const isApi = page.type === "openapi";
  const toc = isApi ? [] : page.data.toc;
  const full = isApi || page.data.full;
  const MDX = isApi ? null : page.data.body;
  const appUrl = getEnv().APP_URL;
  /** Linked folders on the way to the page; the API reference counts as one even though its sidebar replaces the docs sidebar. */
  const trail = getBreadcrumbItems(page.url, tree, { includeRoot: true }).flatMap((item) => (item.url && typeof item.name === "string" ? [{ name: item.name, path: item.url }] : []));
  const title = page.data.title ?? "Solverr docs";
  const structuredData = jsonLdGraph([
    techArticle(appUrl, { title, description: describe(page.data.description), path: page.url }),
    breadcrumbList(appUrl, [{ name: "Docs", path: "/docs" }, ...trail, { name: title, path: page.url }]),
  ]);

  return (
    <div className="flex min-w-0 flex-1 gap-12">
      <main className="min-w-0 flex-1 pb-16 pt-10">
        <article className={`flex min-w-0 flex-col ${full ? "max-w-[68rem]" : "max-w-[660px]"}`}>
          <JsonLd data={structuredData} />
          <header>
            <BracketLabel>{section}</BracketLabel>
            <h1 className="mt-3.5 text-[38px] font-light leading-[1.08] tracking-[-0.045em] sm:text-[48px]">{page.data.title}</h1>
            {page.data.description && (
              <p className="mt-4 text-[17px] leading-7 text-fg">
                <TextWithCode text={page.data.description} />
              </p>
            )}
          </header>
          {toc.length > 0 && !full && <DocsTocMenu toc={toc} />}
          <div className={`prose mt-8 max-w-none [&_:not(pre)>code]:text-sm ${isApi ? "" : GUIDE_PROSE}`}>
            {isApi ? <OpenAPIPage {...page.data.getOpenAPIPageProps()} /> : MDX && <MDX components={getMDXComponents({ a: createRelativeLink(source, page) })} />}
          </div>
          <DocsPager previous={neighbours.previous} next={neighbours.next} />
        </article>
      </main>
      {toc.length > 0 && !full && (
        <aside className="hidden w-[200px] shrink-0 xl:block">
          <DocsToc toc={toc} />
        </aside>
      )}
    </div>
  );
}

export function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: PageProps<"/docs/[[...slug]]">): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();
  return pageMetadata(`${page.data.title} · Solverr docs`, describe(page.data.description), page.url);
}

/** Search snippet for a page: its description without code marks, cut to fit; API operations can run several paragraphs. */
function describe(description: string | undefined): string {
  return description ? snippet(plainText(description)) : DOCS_DESCRIPTION;
}
