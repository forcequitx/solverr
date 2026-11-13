import type { Metadata } from "next";
import { ButtonGenerator } from "@/components/dashboard/button/button-generator";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { requireMerchant } from "@/lib/auth/session";
import { getEnv } from "@/lib/env";
import { activeLinkOptions } from "@/lib/merchants/link-stats";

export const metadata: Metadata = { title: "Pay button" };

export default async function ButtonPage() {
  const { merchant, mode, role } = await requireMerchant();
  const links = await activeLinkOptions(merchant.id, mode);
  return (
    <>
      <PageHeader title="Pay button" description="One snippet on any website. The button opens the full checkout page, and amounts are never set in the browser, so customers cannot change fixed prices." />
      {links.length === 0 ? (
        <Card className="flex min-h-[420px] flex-col p-5 sm:p-6 [&>*]:flex-1 [&>*]:justify-center">
          {role === "viewer" ? (
            <EmptyState title="No active payment links yet">
              <p>The button opens the full checkout page for one of the business&apos;s active payment links. A teammate who can edit creates them in Payment links.</p>
            </EmptyState>
          ) : (
            <EmptyState title="Create a payment link first">
              <p>The button opens the full checkout page for one of your active payment links. Create a link, then come back here.</p>
              <ButtonLink href="/dashboard/links" size="sm" className="mt-4">
                <Icon name="links" className="size-4" />
                Go to payment links
              </ButtonLink>
            </EmptyState>
          )}
        </Card>
      ) : (
        <ButtonGenerator links={links} appUrl={getEnv().APP_URL} />
      )}
    </>
  );
}
