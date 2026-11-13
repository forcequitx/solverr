import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { USDC_ON_BASE } from "@/lib/oneclick/constants";

/** Fixed ids so the demo store is created once and reused. Its payment links are test mode, so no real money moves. */
const DEMO_MERCHANT_ID = "mer_SolverrDemoStore01";

export const DEMO_PRODUCTS = [
  { linkId: "lnk_DemoFlatWhite000001", title: "Flat white", amount: "4.50", note: "Oat milk, double shot" },
  { linkId: "lnk_DemoBeans000000001", title: "House beans, 1 kg", amount: "32.00", note: "Washed Ethiopia, medium roast" },
  { linkId: "lnk_DemoTipJar00000001", title: "Tip the baristas", amount: null, note: "You choose the amount" },
] as const;

/** The demo store's creation in this worker process, kept so later runs of the worker job do not write to the database again. */
let ensured: Promise<void> | undefined;

/** Creates the demo store once per worker process (its `demo-store` job); a failed attempt is forgotten, so the next run tries again. */
export function ensureDemoStore(): Promise<void> {
  ensured ??= createDemoStore().catch((error: unknown) => {
    ensured = undefined;
    throw error;
  });
  return ensured;
}

async function createDemoStore(): Promise<void> {
  const db = getDb();
  /** The demo store page is the business website, so "Back to" on a finished demo payment returns there. */
  const website = new URL("/demo", getEnv().APP_URL).toString();
  await db.merchant.upsert({
    where: { id: DEMO_MERCHANT_ID },
    create: { id: DEMO_MERCHANT_ID, name: "Northwind Coffee (demo)", website, settlementAsset: USDC_ON_BASE },
    update: { website },
  });
  for (const product of DEMO_PRODUCTS) {
    await db.paymentLink.upsert({
      where: { id: product.linkId },
      create: { id: product.linkId, merchantId: DEMO_MERCHANT_ID, mode: "test", title: product.title, amount: product.amount, currency: "USD" },
      update: {},
    });
  }
}
