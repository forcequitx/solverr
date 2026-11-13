/** Every object an API key reaches is live; test mode exists only for demo store invoices. */
export type Mode = "live";

export type Currency = "USD" | "EUR" | "INR";

export type InvoiceStatus =
  | "created"
  | "awaiting_payment"
  | "detected"
  | "processing"
  | "paid"
  | "underpaid"
  | "refunded"
  | "failed"
  | "expired";

/** The coin and amount the business receives for an invoice. */
export interface Settlement {
  asset_id: string;
  symbol: string;
  blockchain: string;
  /** Decimal amount in the settlement coin. */
  amount: string;
  /** Integer amount in the coin's base units. */
  amount_base: string;
}

export interface Invoice {
  id: string;
  object: "invoice";
  mode: Mode;
  status: InvoiceStatus;
  /** Decimal string with two decimals, such as "25.00". */
  amount: string;
  currency: Currency;
  order_id: string | null;
  description: string | null;
  customer_email: string | null;
  redirect_url: string | null;
  metadata: Record<string, string>;
  settlement: Settlement;
  /** True when the payment arrived after the invoice's quote was replaced or expired. */
  late: boolean;
  /** True when the customer paid more than once. */
  extra_payment: boolean;
  checkout_url: string;
  receipt_url: string | null;
  /** When a paywall used this payment; null until it is redeemed. */
  redeemed_at: string | null;
  expires_at: string;
  created_at: string;
}

export interface PaymentCoin {
  asset_id: string;
  symbol: string;
  blockchain: string;
  chain_name: string;
  decimals: number;
}

export interface PaymentTransaction {
  hash: string;
  url: string | null;
}

/** One payment attempt on an invoice: a quote and its latest network status. */
export interface Payment {
  id: string;
  object: "payment";
  status: string;
  coin: PaymentCoin;
  amount_in: string;
  amount_in_base: string;
  min_amount_in_base: string;
  amount_in_usd: string | null;
  deposit_address: string;
  deposit_memo: string | null;
  refund_address: string;
  /** True when NEAR Intents quoted this attempt as a confidential intent (private payments). */
  confidential: boolean;
  deadline: string;
  time_estimate_seconds: number;
  deposited_amount: string | null;
  refunded_amount: string | null;
  refund_fee: string | null;
  refund_reason: string | null;
  origin_transactions: PaymentTransaction[];
  destination_transactions: PaymentTransaction[];
  correlation_id: string;
  quote_signature: string;
  created_at: string;
}

export interface PaymentLink {
  id: string;
  object: "payment_link";
  mode: Mode;
  url: string;
  title: string;
  /** Fixed amount, or null when the customer chooses the amount. */
  amount: string | null;
  currency: Currency;
  /** Where the checkout sends the customer after paying; null uses the business website. */
  redirect_url: string | null;
  active: boolean;
  created_at: string;
}

export type RefundStatus = "pending" | "processing" | "completed" | "failed" | "canceled";

export interface Refund {
  id: string;
  object: "refund";
  status: RefundStatus;
  invoice_id: string;
  batch_id: string | null;
  /** Amount of the settlement coin to send back. */
  amount: string;
  /** The business's settlement coin. */
  source_asset: string;
  /** The coin the payer receives. */
  asset_id: string;
  /** The payer's refund address. */
  recipient: string;
  tx_hash: string | null;
  failure_reason: string | null;
  /** Page where the business signs the refund transfer with its payout wallet. */
  sign_url: string;
  created_at: string;
}

export type PayoutStatus = "pending" | "processing" | "completed" | "failed" | "canceled";

export interface Payout {
  id: string;
  object: "payout";
  status: PayoutStatus;
  invoice_id: string | null;
  /** Shared by the payouts created together in one batch. */
  batch_id: string | null;
  /** Amount of the settlement coin to send. */
  amount: string;
  /** The business's settlement coin. */
  source_asset: string;
  /** The coin the recipient receives. */
  asset_id: string;
  recipient: string;
  tx_hash: string | null;
  failure_reason: string | null;
  /** Page where the business signs the payout transfer with its payout wallet. */
  sign_url: string;
  created_at: string;
}

export interface PayoutBatch {
  object: "payout_batch";
  /** The `batch_id` of every payout in `data`. */
  id: string;
  data: Payout[];
}

export type SubscriptionInterval = "week" | "month";

export type SubscriptionStatus = "active" | "canceled";

export interface Subscription {
  id: string;
  object: "subscription";
  status: SubscriptionStatus;
  customer_email: string;
  amount: string;
  currency: Currency;
  interval: SubscriptionInterval;
  description: string | null;
  next_invoice_at: string;
  created_at: string;
}

export interface CreditAccount {
  id: string;
  object: "credit_account";
  /** Bearer token an agent sends to pay per call, returned only when the account is created. Store it like a password. */
  token?: string;
  balance: string;
  currency: "USD";
}

export interface CreditTopup {
  credit_account: CreditAccount;
  invoice: Invoice;
}

export interface CreditCharge {
  /** Charge id (`cru_…`); pass it to `credits.refundCharge` to give the charge back. */
  id: string;
  object: "credit_charge";
  /** Amount charged, with 6 decimals. */
  amount: string;
  /** `true` on the answer of `credits.refundCharge`. */
  refunded?: boolean;
  /** Balance after the charge or refund, with 6 decimals. */
  balance: string;
  currency: "USD";
}

/** A coin the checkout accepts; a payout's `asset_id` is one of these. */
export interface Token {
  asset_id: string;
  symbol: string;
  blockchain: string;
  /** Display name of the chain, such as "Base". */
  chain_name: string;
  decimals: number;
  price_usd: number;
  /** Token contract, or null for a chain's native coin. */
  contract_address: string | null;
}

/** Every coin at once; unlike other lists it has no pages and no `has_more`. */
export interface TokenList {
  object: "list";
  data: Token[];
}

export interface WebhookTest {
  queued: true;
}

export interface InvoiceRedemption {
  id: string;
  redeemed_at: string;
  /** The payment that paid the invoice. */
  payment: Payment | null;
}

export interface List<T> {
  object: "list";
  data: T[];
  has_more: boolean;
}

export interface ListParams {
  /** Number of items per page, 1 to 100. */
  limit?: number;
  /** Id of the last item of the previous page. */
  starting_after?: string;
}

export interface InvoiceListParams extends ListParams {
  status?: InvoiceStatus;
}

export interface InvoiceCreateParams {
  /** Decimal string with up to two decimals, such as "25.00". */
  amount: string;
  currency: Currency;
  order_id?: string;
  description?: string;
  redirect_url?: string;
  customer_email?: string;
  metadata?: Record<string, string>;
  /** Invoice lifetime in seconds, 900 to 86400. */
  expires_in?: number;
}

export interface PaymentLinkCreateParams {
  title: string;
  /** Fixed amount; omit to let the customer choose. */
  amount?: string;
  currency: Currency;
  /** An http or https URL the checkout sends the customer to after paying; omit to use the business website. */
  redirect_url?: string;
}

export interface RefundCreateParams {
  invoice_id: string;
  /** The payment to refund; defaults to the one that paid the invoice. Use it to refund an extra payment. */
  payment_id?: string;
  /** Amount in the settlement coin; omit to refund what is left of the payment. */
  amount?: string;
}

export interface PayoutCreateParams {
  recipient: string;
  /** The coin the recipient receives: an `asset_id` from `tokens.list()`. */
  asset_id: string;
  amount: string;
}

export interface PayoutBatchCreateParams {
  /** 1 to 200 payouts. */
  payouts: PayoutCreateParams[];
}

export interface SubscriptionCreateParams {
  customer_email: string;
  amount: string;
  currency: Currency;
  interval: SubscriptionInterval;
  description?: string;
}

export interface CreditTopupParams {
  amount: string;
  /** Credit balances are kept in USD. */
  currency: "USD";
  /** Adds to an existing credit account instead of creating a new one (and a new token). */
  credit_account_id?: string;
}

export interface CreditChargeParams {
  token: string;
  amount: string;
  /** Credit balances are kept in USD; other currencies are rejected. */
  currency?: "USD";
  description?: string;
}

export interface RequestOptions {
  /** Makes a POST safe to retry; one is generated when omitted. */
  idempotencyKey?: string;
}

export type InvoiceEventType =
  | "invoice.detected"
  | "invoice.paid"
  | "invoice.underpaid"
  | "invoice.refunded"
  | "invoice.failed"
  | "invoice.expired"
  | "invoice.extra_payment"
  | "subscription.invoice_created";

type RefundEventType = "refund.completed" | "refund.failed" | "refund.canceled";
type PayoutEventType = "payout.completed" | "payout.failed" | "payout.canceled";

export type WebhookEventType = InvoiceEventType | RefundEventType | PayoutEventType | "support_case.created" | "test.ping";

interface WebhookEventBase<Type extends WebhookEventType, Payload> {
  id: string;
  type: Type;
  mode: Mode;
  created_at: string;
  data: Payload;
}

export type InvoiceEvent = WebhookEventBase<InvoiceEventType, { invoice: Invoice; payment?: Payment }>;
export type RefundEvent = WebhookEventBase<RefundEventType, { refund: Refund }>;
export type PayoutEvent = WebhookEventBase<PayoutEventType, { payout: Payout }>;
/** A support case a customer opened; `report` holds the fields the customer sends to NEAR Intents support. */
export type SupportCase = { id: string; kind: string; report: Record<string, unknown> };
export type SupportCaseEvent = WebhookEventBase<"support_case.created", { support_case: SupportCase; invoice: Invoice }>;
export type TestEvent = WebhookEventBase<"test.ping", { message: string }>;

export type WebhookEvent = InvoiceEvent | RefundEvent | PayoutEvent | SupportCaseEvent | TestEvent;
