import type { Metadata } from "next";
import { HelpCenter } from "@/components/help/help-center";
import { JsonLd } from "@/components/seo/json-ld";
import { CHAINS } from "@/lib/chains/registry";
import { getEnv } from "@/lib/env";
import { en } from "@/lib/i18n/messages/en";
import { pageMetadata } from "@/lib/metadata";
import { jsonLdGraph, webPage } from "@/lib/structured-data";

const DESCRIPTION = "Find a payment, check its status, and open a support case if something went wrong.";

export const metadata: Metadata = pageMetadata(en.meta.helpTitle, DESCRIPTION, "/help");

export default async function HelpPage({ searchParams }: PageProps<"/help">) {
  const { invoice } = await searchParams;
  return (
    <>
      <JsonLd data={jsonLdGraph([webPage(getEnv().APP_URL, { title: en.help.title, description: DESCRIPTION, path: "/help" })])} />
      <HelpCenter initialInvoice={typeof invoice === "string" ? invoice : ""} chains={CHAINS} />
    </>
  );
}
