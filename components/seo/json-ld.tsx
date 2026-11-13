import { serializeJsonLd } from "@/lib/structured-data";

/** schema.org structured data for search and answer engines, rendered into the server HTML. */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />;
}
