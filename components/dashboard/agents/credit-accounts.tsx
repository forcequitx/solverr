import { EmptyState } from "@/components/dashboard/empty-state";
import { ListEmpty } from "@/components/dashboard/list/list-empty";
import { LIST_TBODY } from "@/components/dashboard/list/list-styles";
import { ListTableHead } from "@/components/dashboard/list/list-table-head";
import { Card } from "@/components/ui/card";
import { formatUtcDate } from "@/lib/format";
import type { CreditAccountRow } from "@/lib/merchants/agent-stats";

function UsageChips({ account }: { account: CreditAccountRow }) {
  if (account.usage.length === 0) return <span className="text-meta text-muted">No calls charged yet</span>;
  return (
    <span className="flex min-w-0 flex-wrap gap-1">
      {account.usage.map((usage) => (
        <span
          key={usage.id}
          className={`max-w-[220px] truncate rounded-md bg-surface-2 px-1.5 py-0.5 text-xs tabular-nums text-muted ${usage.refunded ? "line-through" : ""}`}
          title={usage.refunded ? `Given back${usage.description ? ` · ${usage.description}` : ""}` : (usage.description ?? undefined)}
        >
          −{usage.amount}
          {usage.description ? ` · ${usage.description}` : ""}
          {usage.refunded ? <span className="sr-only"> (given back)</span> : null}
        </span>
      ))}
    </span>
  );
}

/** Prepaid credit accounts with their USD balance and the latest calls charged to them. */
export function CreditAccounts({ accounts, total }: { accounts: CreditAccountRow[]; total: number }) {
  return (
    <Card className="@container min-w-0 overflow-hidden">
      <div className="p-5 sm:p-6">
        <h2 className="text-base font-semibold">Credit accounts</h2>
        <p className="text-meta text-muted">{total > accounts.length ? `The newest ${accounts.length} of ${total} accounts` : `${total} ${total === 1 ? "account" : "accounts"}`}</p>
      </div>

      {accounts.length === 0 ? (
        <ListEmpty>
          <EmptyState title="No credit accounts yet">
            Your server creates a top-up with POST /api/v1/credits/topup (API key), gives the agent the invoice to pay and the credit token, and the paywall then charges that token per call.
          </EmptyState>
        </ListEmpty>
      ) : (
        <>
          <div className="hidden overflow-x-auto [scrollbar-width:none] @3xl:block">
            <table className="w-full min-w-[680px] border-collapse text-body">
              <ListTableHead labels={["Account", "Balance (USD)", "Latest calls", "Created"]} />
              <tbody className={`${LIST_TBODY} [&_tr:last-child_td]:border-0`}>
                {accounts.map((account, index) => (
                  <tr key={account.id} className="animate-row-in transition-colors hover:bg-surface-2/60" style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }}>
                    <td className="font-mono text-meta">{account.id}</td>
                    <td>
                      <span className="whitespace-nowrap rounded-md bg-surface-2 px-2 py-0.5 text-meta font-medium tabular-nums">{account.balance}</span>
                    </td>
                    <td>
                      <UsageChips account={account} />
                    </td>
                    <td className="whitespace-nowrap text-meta text-muted">{formatUtcDate(account.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="flex flex-col border-t border-line @3xl:hidden">
            {accounts.map((account, index) => (
              <li key={account.id} className="flex animate-row-in flex-col gap-2 border-b border-line px-5 py-3 last:border-0" style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }}>
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-body">{account.id}</span>
                  <span className="shrink-0 text-body font-semibold tabular-nums">{account.balance} USD</span>
                </span>
                <span className="text-meta text-muted">Created {formatUtcDate(account.createdAt)}</span>
                <UsageChips account={account} />
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
