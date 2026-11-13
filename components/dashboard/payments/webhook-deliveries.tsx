import type { WebhookDelivery } from "@/generated/prisma/client";
import { DeliveryStatusBadge, deliveryResponse } from "@/components/dashboard/developers/delivery-status";
import { ListTableHead } from "@/components/dashboard/list/list-table-head";
import { Card } from "@/components/ui/card";
import { CardHeading } from "@/components/ui/card-heading";
import { formatUtcDateTime } from "@/lib/format";

/** Webhooks sent for one payment: a table in a wide card, stacked items in a narrow one. */
export function WebhookDeliveries({ deliveries }: { deliveries: WebhookDelivery[] }) {
  return (
    <Card className="@container min-w-0 overflow-hidden">
      <div className="p-5 sm:p-6">
        <CardHeading
          icon="webhook"
          tint="blue"
          title="Webhook deliveries"
          description={deliveries.length === 1 ? "1 event sent to your webhook URL." : `${deliveries.length} events sent to your webhook URL.`}
        />
      </div>
      {deliveries.length === 0 ? (
        <p className="mx-5 mb-5 rounded-[16px] border border-dashed border-line px-6 py-8 text-center text-meta text-muted sm:mx-6 sm:mb-6">
          No webhook deliveries are stored for this payment. Deliveries appear here when a webhook URL is set in Developers, and their log is kept
          for 30 days.
        </p>
      ) : (
        <>
          <div className="hidden overflow-x-auto [scrollbar-width:none] @2xl:block">
            <table className="w-full min-w-[640px] border-collapse text-body">
              <ListTableHead labels={["Event", "Status", "Attempts", "Response", "Created"]} />
              <tbody className="[&_td]:border-t [&_td]:border-line [&_td]:px-4 [&_td]:py-3 [&_td:first-child]:pl-6 [&_td:last-child]:pr-6">
                {deliveries.map((delivery) => (
                  <tr key={delivery.id} className="transition-colors hover:bg-surface-2/60">
                    <td className="font-mono text-meta">{delivery.eventType}</td>
                    <td>
                      <DeliveryStatusBadge status={delivery.status} />
                    </td>
                    <td className="tabular-nums">{delivery.attempts}</td>
                    <td className="max-w-56 truncate font-mono text-meta" title={deliveryResponse(delivery)}>
                      {deliveryResponse(delivery)}
                    </td>
                    <td className="whitespace-nowrap text-meta text-muted">{formatUtcDateTime(delivery.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="flex flex-col border-t border-line @2xl:hidden">
            {deliveries.map((delivery) => (
              <li key={delivery.id} className="flex flex-col gap-1 border-b border-line px-5 py-3 last:border-b-0">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-body">{delivery.eventType}</span>
                  <DeliveryStatusBadge status={delivery.status} />
                </span>
                <span className="truncate text-meta text-muted">
                  {delivery.attempts} {delivery.attempts === 1 ? "attempt" : "attempts"} · {deliveryResponse(delivery)} · {formatUtcDateTime(delivery.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
