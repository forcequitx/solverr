import type { Metadata } from "next";
import { PageHeader } from "@/components/dashboard/page-header";
import { SectionCard } from "@/components/dashboard/section-card";
import { EarnHoldings } from "@/components/dashboard/settings/earn-holdings";
import { LogoForm } from "@/components/dashboard/settings/logo-form";
import { PayoutWalletForm } from "@/components/dashboard/settings/payout-wallet-form";
import { ProfileForm } from "@/components/dashboard/settings/profile-form";
import { SettingsNav, type SettingsSection } from "@/components/dashboard/settings/settings-nav";
import { SettlementForm } from "@/components/dashboard/settings/settlement-form";
import { SignInMethods } from "@/components/dashboard/settings/sign-in-methods";
import { SplitRules } from "@/components/dashboard/settings/split-rules";
import { TeamMembers } from "@/components/dashboard/settings/team-members";
import { TelegramSettings } from "@/components/dashboard/settings/telegram-settings";
import { Badge } from "@/components/ui/badge";
import { requireMerchant } from "@/lib/auth/session";
import { isPlaceholderEmail } from "@/lib/auth/wallet-email";
import { getChain } from "@/lib/chains/registry";
import { logoUrl } from "@/lib/merchants/logo";
import { payoutChainOptions, payoutFormKey, verifiedPayout } from "@/lib/merchants/payout-wallet";
import { settingsPageData } from "@/lib/merchants/settings-data";
import { privatePaymentsUnavailable } from "@/lib/oneclick/confidentiality";
import { isEarnAsset } from "@/lib/payments/earn";
import { telegramEnabled } from "@/lib/telegram/api";

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { merchant, user, role } = await requireMerchant();
  const { members, wallets, sessions, options, recommendedChain, recommendedCoin, splits, telegramChats, earn } = await settingsPageData(merchant, user.id);
  const editable = role !== "viewer";
  /** Where money goes and who can move it are owner-only settings. */
  const isOwner = role === "owner";
  const payout = verifiedPayout(merchant);
  const showEarn = earn.holdings.length > 0 || isEarnAsset(merchant.settlementAsset);
  const telegram = telegramEnabled();
  const privateUnavailable = privatePaymentsUnavailable();

  const sections: SettingsSection[] = [
    { id: "profile", title: "Business profile" },
    { id: "payout", title: "Payout wallet" },
    { id: "settlement", title: "Coin you receive" },
    ...(showEarn ? [{ id: "earn", title: "Earn holdings" }] : []),
    { id: "splits", title: "Revenue splits" },
    { id: "team", title: "Team" },
    { id: "telegram", title: "Telegram" },
    { id: "sign-in", title: "Sign-in methods" },
  ];

  return (
    <>
      <PageHeader title="Settings" description="Your business, where payments go, who can work on this business, and how you sign in." />

      <div className="grid gap-4 sm:gap-5 lg:grid-cols-[200px_minmax(0,1fr)] lg:items-start">
        <SettingsNav sections={sections} />

        <div className="flex min-w-0 flex-col gap-4 sm:gap-5">
          <SectionCard id="profile" icon="store" title="Business profile" description="The business name, website and logo on this account.">
            <div className="flex flex-col gap-5">
              <LogoForm name={merchant.name} logoUrl={logoUrl(merchant.logoId)} editable={editable} />
              {editable ? (
                <ProfileForm name={merchant.name} website={merchant.website ?? ""} />
              ) : (
                <dl className="grid gap-3 text-body sm:grid-cols-2">
                  <div>
                    <dt className="text-meta text-muted">Business name</dt>
                    <dd className="font-medium">{merchant.name}</dd>
                  </div>
                  <div>
                    <dt className="text-meta text-muted">Website</dt>
                    <dd className="break-all font-medium">{merchant.website ?? "Not set"}</dd>
                  </div>
                </dl>
              )}
            </div>
          </SectionCard>

          <SectionCard
            id="payout"
            icon="wallet"
            tint="blue"
            title="Payout wallet"
            description="Payments go straight into this wallet. Only a wallet you have proved you own (the one you signed in with, or another you sign for) can replace it, and every change raises an alert."
            action={payout ? <Badge tone="success">Verified</Badge> : <Badge tone="warn">Not verified</Badge>}
          >
            {isOwner ? (
              <PayoutWalletForm
                key={payoutFormKey(payout)}
                merchantId={merchant.id}
                chains={payoutChainOptions()}
                current={payout}
                signInWallets={wallets.filter((wallet) => !wallet.smartWallet).map((wallet) => ({ kind: wallet.kind, address: wallet.address }))}
                recommendedChain={recommendedChain}
              />
            ) : (
              <div className="flex flex-col gap-1">
                <p className="break-all font-mono text-body">{merchant.payoutAddress ?? "Not set"}</p>
                <p className="text-meta text-muted">Only the owner of this business can change the payout wallet.</p>
              </div>
            )}
          </SectionCard>

          <SectionCard
            id="settlement"
            icon="coins"
            title="Coin you receive"
            description="Customers pay in any coin; NEAR Intents converts it into this coin on your payout network."
            action={
              !merchant.privatePayments ? null : privateUnavailable ? <Badge tone="warn">Private payments blocked</Badge> : <Badge tone="info">Private payments on</Badge>
            }
          >
            {!merchant.payoutChain ? (
              <p className="text-sm text-muted">Verify a payout wallet first.</p>
            ) : isOwner ? (
              <SettlementForm
                key={merchant.payoutChain}
                merchantId={merchant.id}
                options={options} current={merchant.settlementAsset} recommended={recommendedCoin} privatePayments={merchant.privatePayments} privateUnavailable={privateUnavailable} />
            ) : (
              <div className="flex flex-col gap-1">
                <p className="text-body font-medium">{options.find((option) => option.assetId === merchant.settlementAsset)?.label ?? merchant.settlementAsset}</p>
                <p className="text-meta text-muted">Only the owner of this business can change the coin you receive.</p>
              </div>
            )}
          </SectionCard>

          {showEarn ? (
            <SectionCard id="earn" icon="trendUp" tint="blue" title="Earn holdings" description="Vault shares in your payout wallet from payments received into Earn.">
              <EarnHoldings holdings={earn.holdings} unreadable={earn.unreadable} editable={isOwner} />
            </SectionCard>
          ) : null}

          <SectionCard
            id="splits"
            icon="split"
            title="Revenue splits"
            description="Share every paid payment with partners. Each split becomes a pending payout in the coin you receive that you approve from your wallet; nothing is sent automatically."
            action={<Badge tone="muted">{plural(splits.length, "split", "splits")}</Badge>}
          >
            <SplitRules
              editable={isOwner}
              rules={splits.map((rule) => ({
                id: rule.id,
                label: rule.label,
                recipient: rule.recipient,
                percent: String(rule.shareBps / 100),
                network: getChain(rule.chain)?.name ?? rule.chain,
                active: rule.chain === merchant.payoutChain,
              }))}
            />
          </SectionCard>

          <SectionCard
            id="team"
            icon="users"
            tint="blue"
            title="Team"
            description="The owner manages everything. Developers can manage links, subscriptions, refunds, payouts and support cases, but not the payout wallet, the coin you receive, revenue splits, Earn holdings, the team, API keys or the webhook endpoint. Viewers can only look."
            action={<Badge tone="muted">{plural(members.length, "member", "members")}</Badge>}
          >
            <TeamMembers
              isOwner={isOwner}
              members={members.map((member) => ({
                id: member.id,
                role: member.role,
                name: isPlaceholderEmail(member.user.email) ? (member.user.walletIdentities[0]?.address ?? member.user.name) : member.user.email,
              }))}
            />
          </SectionCard>

          <SectionCard
            id="telegram"
            icon="send"
            title="Telegram"
            description="Create invoices and payment links from a Telegram chat, and get a message whenever a payment completes."
            action={telegram ? <Badge tone="muted">{plural(telegramChats.length, "chat", "chats")}</Badge> : <Badge tone="muted">Off</Badge>}
          >
            <TelegramSettings enabled={telegram} editable={editable} chats={telegramChats.map((chat) => ({ id: chat.id, chatId: chat.chatId }))} />
          </SectionCard>

          <SectionCard id="sign-in" icon="signIn" tint="blue" title="Sign-in methods" description="Any of these wallets signs you in to this account.">
            <SignInMethods
              wallets={wallets.map((wallet) => ({ id: wallet.id, kind: wallet.kind, address: wallet.address }))}
              email={isPlaceholderEmail(user.email) ? null : user.email}
              otherDevices={Math.max(0, sessions - 1)}
            />
          </SectionCard>
        </div>
      </div>
    </>
  );
}
