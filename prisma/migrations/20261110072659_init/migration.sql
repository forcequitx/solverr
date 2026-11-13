-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Mode" AS ENUM ('live', 'test');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('created', 'awaiting_payment', 'detected', 'processing', 'paid', 'underpaid', 'refunded', 'failed', 'expired');

-- CreateEnum
CREATE TYPE "QuoteState" AS ENUM ('active', 'retired', 'final');

-- CreateEnum
CREATE TYPE "OneClickStatus" AS ENUM ('PENDING_DEPOSIT', 'KNOWN_DEPOSIT_TX', 'INCOMPLETE_DEPOSIT', 'PROCESSING', 'SUCCESS', 'REFUNDED', 'FAILED');

-- CreateEnum
CREATE TYPE "SimulatedOutcome" AS ENUM ('paid', 'underpaid', 'refunded', 'failed');

-- CreateEnum
CREATE TYPE "TeamRole" AS ENUM ('owner', 'developer', 'viewer');

-- CreateEnum
CREATE TYPE "TransferKind" AS ENUM ('refund', 'payout', 'withdrawal');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('pending', 'processing', 'completed', 'failed', 'canceled');

-- CreateEnum
CREATE TYPE "SubscriptionInterval" AS ENUM ('week', 'month');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('active', 'canceled');

-- CreateEnum
CREATE TYPE "WalletKind" AS ENUM ('evm', 'solana', 'near');

-- CreateEnum
CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('pending', 'delivered', 'failed');

-- CreateEnum
CREATE TYPE "SupportCaseKind" AS ENUM ('wrong_chain', 'wrong_coin', 'missing_memo', 'stuck', 'swap_failed', 'not_found');

-- CreateEnum
CREATE TYPE "SupportCaseStatus" AS ENUM ('open', 'resolved');

-- CreateEnum
CREATE TYPE "RouteStatus" AS ENUM ('available', 'minimum', 'unavailable');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verifications" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_rate_limits" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "lastRequest" BIGINT NOT NULL,

    CONSTRAINT "auth_rate_limits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit_windows" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "window_end" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_limit_windows_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "wallet_identities" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" "WalletKind" NOT NULL,
    "address" TEXT NOT NULL,
    "smart_wallet" BOOLEAN NOT NULL DEFAULT false,
    "chain_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_members" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "TeamRole" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "website" TEXT,
    "payout_chain" TEXT,
    "payout_address" TEXT,
    "payout_verified_at" TIMESTAMP(3),
    "settlement_asset" TEXT NOT NULL,
    "private_payments" BOOLEAN NOT NULL DEFAULT false,
    "setup_completed_at" TIMESTAMP(3),
    "webhook_url" TEXT,
    "webhook_secret_enc" TEXT,
    "webhook_previous_secret_enc" TEXT,
    "webhook_previous_secret_until" TIMESTAMP(3),
    "webhook_disabled_at" TIMESTAMP(3),
    "webhook_paused_until" TIMESTAMP(3),
    "logo_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_logos" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "image" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchant_logos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "mode" "Mode" NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'created',
    "amount" DECIMAL(20,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "destination_asset" TEXT NOT NULL,
    "destination_symbol" TEXT NOT NULL,
    "destination_chain" TEXT NOT NULL,
    "destination_decimals" INTEGER NOT NULL,
    "amount_out_base" TEXT NOT NULL,
    "order_id" TEXT,
    "description" TEXT,
    "customer_email" TEXT,
    "redirect_url" TEXT,
    "metadata" JSONB,
    "late" BOOLEAN NOT NULL DEFAULT false,
    "extra_payment" BOOLEAN NOT NULL DEFAULT false,
    "paid_quote_id" TEXT,
    "paid_at" TIMESTAMP(3),
    "redeemed_at" TIMESTAMP(3),
    "payment_link_id" TEXT,
    "credit_account_id" TEXT,
    "credited_at" TIMESTAMP(3),
    "subscription_id" TEXT,
    "pay_link_sent_at" TIMESTAMP(3),
    "receipt_sent_at" TIMESTAMP(3),
    "telegram_notified_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "origin_asset" TEXT NOT NULL,
    "origin_symbol" TEXT NOT NULL,
    "origin_chain" TEXT NOT NULL,
    "origin_decimals" INTEGER NOT NULL,
    "deposit_address" TEXT NOT NULL,
    "deposit_memo" TEXT,
    "amount_in" TEXT NOT NULL,
    "amount_in_formatted" TEXT NOT NULL,
    "min_amount_in" TEXT NOT NULL,
    "amount_in_usd" TEXT,
    "refund_to" TEXT NOT NULL,
    "deadline" TIMESTAMP(3) NOT NULL,
    "time_estimate" INTEGER NOT NULL,
    "state" "QuoteState" NOT NULL DEFAULT 'active',
    "oneclick_status" "OneClickStatus" NOT NULL DEFAULT 'PENDING_DEPOSIT',
    "oneclick_updated_at" TIMESTAMP(3),
    "deposit_tx_hash" TEXT,
    "wallet_sent_at" TIMESTAMP(3),
    "watch_until" TIMESTAMP(3),
    "next_poll_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkout_seen_at" TIMESTAMP(3),
    "simulated_outcome" "SimulatedOutcome",
    "simulated_at" TIMESTAMP(3),
    "correlation_id" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "raw_response" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_events" (
    "id" TEXT NOT NULL,
    "quote_id" TEXT NOT NULL,
    "oneclick_status" "OneClickStatus" NOT NULL,
    "deposited_amount" TEXT,
    "refunded_amount" TEXT,
    "refund_fee" TEXT,
    "refund_reason" TEXT,
    "amount_out" TEXT,
    "origin_txs" JSONB NOT NULL,
    "destination_txs" JSONB NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "response_code" INTEGER,
    "last_error" TEXT,
    "next_retry_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_cases" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT,
    "quote_id" TEXT,
    "tx_hash" TEXT,
    "chain" TEXT,
    "kind" "SupportCaseKind" NOT NULL,
    "status" "SupportCaseStatus" NOT NULL DEFAULT 'open',
    "report" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_links" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "mode" "Mode" NOT NULL,
    "title" TEXT NOT NULL,
    "amount" DECIMAL(20,2),
    "currency" TEXT NOT NULL,
    "redirect_url" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_accounts" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "balance" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_usage" (
    "id" TEXT NOT NULL,
    "credit_account_id" TEXT NOT NULL,
    "amount" DECIMAL(20,6) NOT NULL,
    "description" TEXT,
    "refunded_at" TIMESTAMP(3),
    "refund_transfer_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfers" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "kind" "TransferKind" NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'pending',
    "invoice_id" TEXT,
    "quote_id" TEXT,
    "batch_id" TEXT,
    "split_share_bps" INTEGER,
    "amount" TEXT NOT NULL,
    "source_asset" TEXT NOT NULL,
    "destination_asset" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "deposit_address" TEXT,
    "deposit_memo" TEXT,
    "amount_in_base" TEXT,
    "tx_hash" TEXT,
    "tx_reported_at" TIMESTAMP(3),
    "tx_sender" TEXT,
    "correlation_id" TEXT,
    "oneclick_status" "OneClickStatus",
    "next_poll_at" TIMESTAMP(3),
    "failure_reason" TEXT,
    "raw_quote" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "customer_email" TEXT NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "interval" "SubscriptionInterval" NOT NULL,
    "description" TEXT,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'active',
    "next_invoice_at" TIMESTAMP(3) NOT NULL,
    "invoice_retry_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "split_rules" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "share_bps" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "split_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_chats" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_chats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_health" (
    "id" TEXT NOT NULL,
    "healthy" BOOLEAN NOT NULL DEFAULT true,
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_health_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_limits" (
    "origin_asset" TEXT NOT NULL,
    "destination_asset" TEXT NOT NULL,
    "status" "RouteStatus" NOT NULL,
    "minimum_usd" DECIMAL(20,2),
    "fee_usd" DECIMAL(20,6),
    "message" TEXT,
    "checked_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "route_limits_pkey" PRIMARY KEY ("origin_asset","destination_asset")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status_code" INTEGER NOT NULL,
    "response_body" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "accounts_userId_idx" ON "accounts"("userId");

-- CreateIndex
CREATE INDEX "verifications_identifier_idx" ON "verifications"("identifier");

-- CreateIndex
CREATE INDEX "verifications_expiresAt_idx" ON "verifications"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "auth_rate_limits_key_key" ON "auth_rate_limits"("key");

-- CreateIndex
CREATE INDEX "rate_limit_windows_window_end_idx" ON "rate_limit_windows"("window_end");

-- CreateIndex
CREATE INDEX "wallet_identities_user_id_idx" ON "wallet_identities"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_identities_kind_address_key" ON "wallet_identities"("kind", "address");

-- CreateIndex
CREATE INDEX "team_members_user_id_idx" ON "team_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "team_members_merchant_id_user_id_key" ON "team_members"("merchant_id", "user_id");

-- CreateIndex
CREATE INDEX "merchant_logos_merchant_id_idx" ON "merchant_logos"("merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "api_keys_merchant_id_idx" ON "api_keys"("merchant_id");

-- CreateIndex
CREATE INDEX "invoices_merchant_id_created_at_idx" ON "invoices"("merchant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "invoices_status_expires_at_idx" ON "invoices"("status", "expires_at");

-- CreateIndex
CREATE INDEX "invoices_status_paid_at_idx" ON "invoices"("status", "paid_at");

-- CreateIndex
CREATE INDEX "invoices_pay_link_sent_at_idx" ON "invoices"("pay_link_sent_at");

-- CreateIndex
CREATE INDEX "quotes_invoice_id_idx" ON "quotes"("invoice_id");

-- CreateIndex
CREATE INDEX "quotes_state_next_poll_at_idx" ON "quotes"("state", "next_poll_at");

-- CreateIndex
CREATE INDEX "quotes_deposit_tx_hash_idx" ON "quotes"("deposit_tx_hash");

-- CreateIndex
CREATE INDEX "payment_events_quote_id_received_at_idx" ON "payment_events"("quote_id", "received_at");

-- CreateIndex
CREATE INDEX "payment_events_origin_txs_idx" ON "payment_events" USING GIN ("origin_txs" jsonb_path_ops);

-- CreateIndex
CREATE INDEX "webhook_deliveries_status_next_retry_at_idx" ON "webhook_deliveries"("status", "next_retry_at");

-- CreateIndex
CREATE INDEX "webhook_deliveries_merchant_id_created_at_idx" ON "webhook_deliveries"("merchant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "webhook_deliveries_created_at_idx" ON "webhook_deliveries"("created_at");

-- CreateIndex
CREATE INDEX "alerts_merchant_id_created_at_idx" ON "alerts"("merchant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "alerts_created_at_idx" ON "alerts"("created_at");

-- CreateIndex
CREATE INDEX "support_cases_invoice_id_idx" ON "support_cases"("invoice_id");

-- CreateIndex
CREATE INDEX "payment_links_merchant_id_created_at_idx" ON "payment_links"("merchant_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "credit_accounts_token_hash_key" ON "credit_accounts"("token_hash");

-- CreateIndex
CREATE INDEX "credit_accounts_merchant_id_idx" ON "credit_accounts"("merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "credit_usage_refund_transfer_id_key" ON "credit_usage"("refund_transfer_id");

-- CreateIndex
CREATE INDEX "credit_usage_credit_account_id_created_at_idx" ON "credit_usage"("credit_account_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "transfers_tx_hash_key" ON "transfers"("tx_hash");

-- CreateIndex
CREATE INDEX "transfers_merchant_id_kind_created_at_idx" ON "transfers"("merchant_id", "kind", "created_at" DESC);

-- CreateIndex
CREATE INDEX "transfers_status_next_poll_at_idx" ON "transfers"("status", "next_poll_at");

-- CreateIndex
CREATE INDEX "transfers_invoice_id_idx" ON "transfers"("invoice_id");

-- CreateIndex
CREATE INDEX "transfers_quote_id_idx" ON "transfers"("quote_id");

-- CreateIndex
CREATE INDEX "subscriptions_status_next_invoice_at_idx" ON "subscriptions"("status", "next_invoice_at");

-- CreateIndex
CREATE INDEX "subscriptions_merchant_id_created_at_idx" ON "subscriptions"("merchant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "split_rules_merchant_id_idx" ON "split_rules"("merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_chats_chat_id_key" ON "telegram_chats"("chat_id");

-- CreateIndex
CREATE INDEX "telegram_chats_merchant_id_idx" ON "telegram_chats"("merchant_id");

-- CreateIndex
CREATE INDEX "telegram_chats_user_id_idx" ON "telegram_chats"("user_id");

-- CreateIndex
CREATE INDEX "route_limits_destination_asset_idx" ON "route_limits"("destination_asset");

-- CreateIndex
CREATE INDEX "idempotency_records_created_at_idx" ON "idempotency_records"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_merchant_id_key_key" ON "idempotency_records"("merchant_id", "key");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_identities" ADD CONSTRAINT "wallet_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_logos" ADD CONSTRAINT "merchant_logos_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_accounts" ADD CONSTRAINT "credit_accounts_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_usage" ADD CONSTRAINT "credit_usage_credit_account_id_fkey" FOREIGN KEY ("credit_account_id") REFERENCES "credit_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "split_rules" ADD CONSTRAINT "split_rules_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_chats" ADD CONSTRAINT "telegram_chats_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_chats" ADD CONSTRAINT "telegram_chats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

