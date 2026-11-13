"use client";

import Link from "next/link";
import { useId, useRef, useState, type ReactNode } from "react";
import { Logo } from "@/components/brand/logo";
import { apiErrorText } from "@/components/checkout/api-error-text";
import { checkoutApi, CheckoutApiError, type PaymentLookup, type SupportCase } from "@/components/checkout/checkout-api";
import { CopyButton } from "@/components/checkout/copy-button";
import { DeckIcon, StackedCards, type DeckTone } from "@/components/checkout/stacked-cards";
import { ActionButton } from "@/components/ui/action-button";
import { ActionError } from "@/components/ui/action-error";
import { InvoiceStatusBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { FOCUS_RING } from "@/components/ui/focus-ring";
import { Icon, type IconName } from "@/components/ui/icon";
import { NetworkSelect } from "@/components/ui/network-select";
import { OutcomeBanner } from "@/components/ui/outcome-banner";
import { SearchSelect } from "@/components/ui/search-select";
import { Segmented } from "@/components/ui/segmented";
import type { ChainInfo } from "@/lib/chains/registry";
import { formatCurrencyAmount } from "@/lib/format";
import { format } from "@/lib/i18n/interpolate";
import { en as messages } from "@/lib/i18n/messages/en";
import type { CheckoutState } from "@/lib/payments/checkout-state";

const PROBLEMS = ["stuck", "wrong_chain", "wrong_coin", "missing_memo", "not_found"] as const;
type Tab = "find" | "report";

/** A malformed ID or hash (400) and no match (404) both mean nothing was found for what was entered. */
function lookupErrorText(cause: unknown): string {
  if (cause instanceof CheckoutApiError && (cause.status === 400 || cause.status === 404)) return messages.help.noMatch;
  return apiErrorText(cause, messages);
}

/** The per-payment case limit carries code `too_many_attempts`; the per-IP and per-network limits carry none. */
function caseErrorText(cause: unknown): string {
  if (cause instanceof CheckoutApiError && cause.status === 429 && cause.code === "too_many_attempts") return messages.help.tooManyCases;
  return apiErrorText(cause, messages, { fallback: messages.help.caseFailed });
}

/** One label and value line of a found payment's details. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5 border-b border-line py-[11px] text-body last:border-0">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="ml-auto min-w-0 text-right font-medium [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

/** Tab panel of `tab` in the tab list `tabsId`, as stacked cards: round icon, title and one sentence in front, the form in the tray. */
function HelpDeck({ tabsId, tab, tone, icon, title, lead, children }: { tabsId: string; tab: Tab; tone: DeckTone; icon: IconName; title: string; lead: string; children: ReactNode }) {
  return (
    <div role="tabpanel" id={`${tabsId}-panel-${tab}`} aria-labelledby={`${tabsId}-tab-${tab}`}>
      <StackedCards
        tone={tone}
        fullWidth
        front={
          <>
            <DeckIcon icon={icon} />
            <h2 className="font-heading text-[23px] leading-tight font-bold tracking-[-0.025em] text-balance @[25rem]:text-[26px]">{title}</h2>
            <p className="text-meta text-muted">{lead}</p>
          </>
        }
      >
        {children}
      </StackedCards>
    </div>
  );
}

/** Help in two tabs, one task at a time: finding a payment and reporting a problem. Both keep their input when switching. */
export function HelpCenter({ initialInvoice, chains }: { initialInvoice: string; chains: readonly ChainInfo[] }) {
  const [tab, setTab] = useState<Tab>("find");
  const tabsId = useId();
  const [lookup, setLookup] = useState(initialInvoice);
  const [found, setFound] = useState<CheckoutState | PaymentLookup | null>(null);
  /** The text the running lookup searched for; null once the text changes. */
  const searched = useRef<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState("");
  /** No network is preselected, so the customer names the one the payment was really sent on. */
  const [chain, setChain] = useState("");
  const [problem, setProblem] = useState<string>("stuck");
  const [details, setDetails] = useState("");
  const [result, setResult] = useState<SupportCase | null>(null);
  const [caseError, setCaseError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const m = messages.help;
  const plainStatus: Record<string, string | undefined> = m.plainStatus;
  const statusLabels: Record<string, string | undefined> = messages.receipt.status;

  async function search() {
    setSearching(true);
    setLookupError(null);
    setFound(null);
    const value = lookup.trim();
    searched.current = value;
    try {
      const result = await checkoutApi.lookupPayment(value.startsWith("inv_") ? { invoice_id: value } : { tx_hash: value });
      /** An answer for text that was edited meanwhile is dropped, so a report never goes to the earlier payment. */
      if (searched.current === value) setFound(result);
    } catch (cause) {
      if (searched.current === value) setLookupError(lookupErrorText(cause));
    } finally {
      setSearching(false);
    }
  }

  async function report() {
    setBusy(true);
    setCaseError(null);
    const invoiceId = found && "id" in found ? found.id : lookup.trim().startsWith("inv_") ? lookup.trim() : undefined;
    try {
      setResult(await checkoutApi.openSupportCase({ invoice_id: invoiceId, tx_hash: txHash.trim(), chain, kind: problem, ...(details.trim() ? { details: details.trim() } : {}) }));
    } catch (cause) {
      setCaseError(caseErrorText(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-1 flex-col">
      <main className="flex-1 bg-surface-2 px-3 pt-5 pb-8 sm:px-6 sm:py-12">
        <div className="mx-auto flex max-w-[560px] flex-col gap-5">
          <Link href="/" className="flex items-center self-start pointer-coarse:min-h-11">
            <Logo />
          </Link>
          <div>
            <h1 className="font-heading text-[28px] leading-tight font-semibold tracking-[-0.02em]">{m.title}</h1>
            <p className="mt-2 text-muted">{m.intro}</p>
          </div>

          <Segmented
            role="tablist"
            look="strong"
            idPrefix={tabsId}
            label={m.tabsLabel}
            value={tab}
            onChange={setTab}
            options={[
              { value: "find", label: m.tabFind },
              { value: "report", label: m.reportHeading },
            ]}
            className="w-full"
          />

          {tab === "find" ? (
            <HelpDeck tabsId={tabsId} tab="find" tone="accent" icon="search" title={m.findHeading} lead={m.findLead}>
              <form
                className="flex flex-col gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void search();
                }}
              >
                <Field label={m.lookupLabel} htmlFor="lookup" hint={m.lookupHint}>
                  <Input
                    id="lookup"
                    value={lookup}
                    onChange={(event) => {
                      setLookup(event.target.value);
                      /** The shown payment belongs to the earlier text, so a report never goes to it after the text changed. */
                      setFound(null);
                      searched.current = null;
                    }}
                    placeholder={m.lookupPlaceholder}
                    spellCheck={false}
                  />
                </Field>
                <div className="flex flex-col gap-2">
                  <ActionButton
                    type="submit"
                    variant="secondary"
                    disabled={!lookup.trim()}
                    pending={searching}
                    pendingLabel={m.lookingUp}
                    failed={lookupError !== null}
                    failedLabel={messages.results.tryAgain}
                  >
                    {m.lookUp}
                  </ActionButton>
                  <ActionError message={lookupError} />
                </div>
              </form>
              {found && !("id" in found) ? (
                <div className="flex flex-col gap-3 rounded-[14px] border border-line bg-surface p-4">
                  <InvoiceStatusBadge status={found.status} label={statusLabels[found.status]} />
                  <p className="text-body">{plainStatus[found.status] ?? found.status}</p>
                </div>
              ) : found ? (
                <div className="flex flex-col gap-3 rounded-[14px] border border-line bg-surface p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 font-heading text-[17px] font-semibold break-words">{found.merchant.name}</p>
                    <InvoiceStatusBadge status={found.status} label={statusLabels[found.status]} />
                  </div>
                  <p className="text-body">{plainStatus[found.status] ?? found.status}</p>
                  <dl>
                    <Row label={messages.receipt.amount}>{formatCurrencyAmount(found.amount, found.currency)}</Row>
                    <Row label={messages.receipt.paymentId}>
                      <span className="font-mono">{found.id}</span>
                    </Row>
                  </dl>
                  <Link
                    href={`/pay/${found.id}`}
                    className={`inline-flex items-center gap-1 self-start text-sm font-medium text-accent-text hover:underline ${FOCUS_RING}`}
                  >
                    {messages.common.openPaymentPage}
                    <Icon name="arrowUpRight" className="size-4" />
                  </Link>
                </div>
              ) : null}
            </HelpDeck>
          ) : (
            <HelpDeck tabsId={tabsId} tab="report" tone="danger" icon="lifebuoy" title={m.reportHeading} lead={m.reportLead}>
              {result ? (
                <div className="flex flex-col gap-3">
                  <OutcomeBanner tone="success" title={format(result.kind === "not_found" ? m.caseOpenNoInvoice : m.caseOpen, { id: result.id })} />
                  <p className="text-meta text-muted">{m.sendReport}</p>
                  <pre className="whitespace-pre-wrap break-all rounded-[14px] border border-line bg-surface p-4 font-mono text-meta leading-relaxed">{result.report_text}</pre>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <CopyButton value={result.report_text} label={m.copyReport} className="h-11 justify-center sm:flex-1" />
                    <ButtonLink href={result.support_url} target="_blank" rel="noreferrer" className="sm:flex-1">
                      {m.openSupport}
                    </ButtonLink>
                  </div>
                </div>
              ) : (
                <form
                  className="flex flex-col gap-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void report();
                  }}
                >
                  <Field label={m.whatHappened} htmlFor="problem">
                    <SearchSelect
                      id="problem"
                      value={problem}
                      options={PROBLEMS.map((value) => ({ value, label: m.problems[value] }))}
                      onChange={setProblem}
                    />
                  </Field>
                  <Field label={m.txLabel} htmlFor="tx" hint={m.txHint}>
                    <Input id="tx" value={txHash} onChange={(event) => setTxHash(event.target.value)} spellCheck={false} />
                  </Field>
                  <Field label={m.chainLabel} htmlFor="chain">
                    <NetworkSelect id="chain" value={chain} onChange={setChain} chains={chains} allLabel={m.chooseNetwork} />
                  </Field>
                  <Field label={m.detailsLabel} htmlFor="details">
                    <Input id="details" value={details} onChange={(event) => setDetails(event.target.value)} />
                  </Field>
                  <div className="flex flex-col gap-2">
                    <ActionButton
                      type="submit"
                      pending={busy}
                      pendingLabel={m.openingCase}
                      failed={caseError !== null}
                      failedLabel={messages.results.tryAgain}
                      disabled={txHash.trim().length < 8 || !chain}
                    >
                      {m.openCase}
                    </ActionButton>
                    <ActionError message={caseError} />
                  </div>
                </form>
              )}
            </HelpDeck>
          )}
        </div>
      </main>
    </div>
  );
}
