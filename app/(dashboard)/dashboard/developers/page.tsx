import type { Metadata } from "next";
import { ApiKeysCard } from "@/components/dashboard/developers/api-keys-card";
import { DeliveryHealthCard } from "@/components/dashboard/developers/delivery-health";
import { DeliveryLog } from "@/components/dashboard/developers/delivery-log";
import { deliveryResponse } from "@/components/dashboard/developers/delivery-status";
import { McpSetup } from "@/components/dashboard/developers/mcp-setup";
import { WebhookCard } from "@/components/dashboard/developers/webhook-card";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { requireMerchant } from "@/lib/auth/session";
import { merchantApiKeys } from "@/lib/api/keys";
import { getEnv } from "@/lib/env";
import { DELIVERY_DAYS, deliveryHealth, recentDeliveries } from "@/lib/merchants/webhook-stats";
import { webhookEndpoint } from "@/lib/webhooks/endpoint";

const DELIVERY_LOG_SIZE = 50;

export const metadata: Metadata = { title: "Developers" };

export default async function DevelopersPage() {
  const { merchant, mode, role } = await requireMerchant();
  /** Keys and the webhook move real money, so only the owner manages them. */
  const canManage = role === "owner";
  const editable = role !== "viewer";
  const [keys, deliveries, health] = await Promise.all([
    merchantApiKeys(merchant.id),
    recentDeliveries(merchant.id, DELIVERY_LOG_SIZE),
    deliveryHealth(merchant.id),
  ]);

  return (
    <>
      <PageHeader title="Developers" description="API keys, webhooks and AI-editor access for your business." />

      <div className="flex flex-col gap-4 sm:gap-5">
        <div className="grid gap-4 sm:gap-5 xl:grid-cols-2">
          <ApiKeysCard canManage={canManage} keys={keys.map((key) => ({ id: key.id, last4: key.last4, createdAt: key.createdAt.toISOString(), revoked: !!key.revokedAt }))} />
          <WebhookCard canManage={canManage} canPing={editable} webhookUrl={merchant.webhookUrl ?? ""} disabled={!!merchant.webhookDisabledAt} />
        </div>

        <div className="grid gap-4 sm:gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <DeliveryHealthCard health={health} days={DELIVERY_DAYS} />
          <McpSetup appUrl={getEnv().APP_URL} />
        </div>

        <DeliveryLog
          /** The server refuses a resend while webhooks are off or no URL is saved, so the button shows only when it can work. */
          canResend={editable && webhookEndpoint(merchant, mode) !== null}
          limit={DELIVERY_LOG_SIZE}
          deliveries={deliveries.map((delivery) => ({
            id: delivery.id,
            eventType: delivery.eventType,
            status: delivery.status,
            attempts: delivery.attempts,
            response: deliveryResponse(delivery),
            createdAt: delivery.createdAt.toISOString(),
          }))}
          empty={<EmptyState title="No webhook deliveries yet">Save a webhook URL and send a ping event; every event Solverr sends appears here.</EmptyState>}
        />
      </div>
    </>
  );
}
