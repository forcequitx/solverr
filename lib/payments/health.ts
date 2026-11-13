import { getDb } from "@/lib/db";
import { errorMessage, logger } from "@/lib/logger";
import { isRefusal, OneClickError, oneClickMessage, OneClickSlotTimeout, requestEstimate } from "@/lib/oneclick/client";
import { REFERRAL, USDC_ON_ARBITRUM, USDC_ON_BASE } from "@/lib/oneclick/constants";

const log = logger.child({ module: "health" });

const SERVICE_ID = "oneclick";
const FAILURES_BEFORE_BANNER = 2;

/** A $1 USDC Arbitrum → USDC Base dry quote (moves no funds); 1Click rejects burn and token-contract recipients,
    so the public Hardhat test account stands in. */
const PROBE = {
  originAsset: USDC_ON_ARBITRUM,
  destinationAsset: USDC_ON_BASE,
  address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
};

/** A 4xx answer other than a rejected key (401, 403): 1Click is up and refused only the probe's route, whose availability
    and minimums change without notice. A rejected key, a timeout, throttling and 5xx stop every payment, so they count as down. */
const routeRefused = (error: unknown) => isRefusal(error) && error.status !== 401 && error.status !== 403;

/** Sends one dry quote and records whether 1Click answered; skipped (no banner) when the worker's own traffic left no rate-limit slot. */
export async function checkHealth(): Promise<boolean> {
  let ok = true;
  try {
    await requestEstimate({
      dry: true,
      depositMode: "SIMPLE",
      swapType: "EXACT_OUTPUT",
      slippageTolerance: 10,
      originAsset: PROBE.originAsset,
      depositType: "ORIGIN_CHAIN",
      destinationAsset: PROBE.destinationAsset,
      amount: "1000000",
      refundTo: PROBE.address,
      refundType: "ORIGIN_CHAIN",
      recipient: PROBE.address,
      recipientType: "DESTINATION_CHAIN",
      deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
      referral: REFERRAL,
    });
  } catch (error) {
    if (error instanceof OneClickSlotTimeout) {
      log.warn("1Click check skipped: no rate-limit slot was free");
      return true;
    }
    const reason = error instanceof OneClickError ? oneClickMessage(error) : undefined;
    if (routeRefused(error)) {
      log.warn({ error: errorMessage(error), reason }, "1Click answered but refused the check's route");
    } else {
      ok = false;
      log.error({ error: errorMessage(error), reason }, "1Click check failed");
    }
  }

  const db = getDb();
  const current = await db.serviceHealth.findUnique({ where: { id: SERVICE_ID } });
  const failures = ok ? 0 : (current?.consecutiveFailures ?? 0) + 1;
  await db.serviceHealth.upsert({
    where: { id: SERVICE_ID },
    create: { id: SERVICE_ID, healthy: failures < FAILURES_BEFORE_BANNER, consecutiveFailures: failures, checkedAt: new Date() },
    update: { healthy: failures < FAILURES_BEFORE_BANNER, consecutiveFailures: failures, checkedAt: new Date() },
  });
  return ok;
}

/** True when the last FAILURES_BEFORE_BANNER health checks failed, so the dashboard and live checkouts show the payments-delayed notice. */
export async function paymentsDelayed(): Promise<boolean> {
  const health = await getDb().serviceHealth.findUnique({ where: { id: SERVICE_ID } });
  return health ? !health.healthy : false;
}
