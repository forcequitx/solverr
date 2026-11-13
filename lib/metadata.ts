import type { Metadata } from "next";

/** The preview image app/opengraph-image.tsx draws; a page that sets its own Open Graph card replaces the inherited one, so each names it. */
const PREVIEW_IMAGE = { url: "/opengraph-image", width: 1200, height: 630, alt: "Solverr: get paid in crypto straight into your own wallet" };

/** Longest description search results show without cutting it. */
const SNIPPET_MAX = 160;

/** Page title and description, repeated in the Open Graph and Twitter cards that link previews read.
    `path` makes the page's own address its canonical URL, resolved against `metadataBase`. */
export function pageMetadata(title: string, description: string, path?: string): Metadata {
  return {
    title,
    description,
    ...(path ? { alternates: { canonical: path } } : {}),
    openGraph: { type: "website", siteName: "Solverr", title, description, images: [PREVIEW_IMAGE], ...(path ? { url: path } : {}) },
    twitter: { card: "summary_large_image", title, description, images: [PREVIEW_IMAGE.url] },
  };
}

/** The first paragraph of `text` on one line, cut after the last whole sentence that fits in `max` characters,
    or after the last whole word with an ellipsis when even the first sentence is longer. */
export function snippet(text: string, max = SNIPPET_MAX): string {
  const paragraph = text.trim().split(/\n\s*\n/)[0].replace(/\s+/g, " ");
  if (paragraph.length <= max) return paragraph;
  let end = 0;
  for (const match of paragraph.matchAll(/[.!?](?=\s|$)/g)) {
    if (match.index + 1 > max) break;
    end = match.index + 1;
  }
  if (end > 0) return paragraph.slice(0, end);
  return `${paragraph.slice(0, max).replace(/\s+\S*$/, "")}…`;
}
