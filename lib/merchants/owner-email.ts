import type { Merchant } from "@/generated/prisma/client";
import { isPlaceholderEmail } from "@/lib/auth/wallet-email";
import { getDb } from "@/lib/db";
import { emailEnabled, sendEmail } from "@/lib/email/send";
import { alertEmail } from "@/lib/email/templates";
import { getEnv } from "@/lib/env";
import { errorMessage, logger } from "@/lib/logger";

const log = logger.child({ module: "alerts" });

/** Emails an alert to the merchant's owner when email is configured and the owner signed up with a real address. */
export async function emailOwner(merchant: Pick<Merchant, "id" | "name">, message: string, dashboardPath: string): Promise<void> {
  if (!emailEnabled()) return;
  const owner = await getDb().teamMember.findFirst({ where: { merchantId: merchant.id, role: "owner" }, include: { user: { select: { email: true } } } });
  if (!owner || isPlaceholderEmail(owner.user.email)) return;
  const dashboardUrl = new URL(dashboardPath, getEnv().APP_URL).toString();
  await sendEmail({ to: owner.user.email, ...(await alertEmail({ merchantName: merchant.name, message, dashboardUrl })) }).catch((error: Error) =>
    log.error({ merchant: merchant.id, error: errorMessage(error) }, "Owner email failed"),
  );
}
