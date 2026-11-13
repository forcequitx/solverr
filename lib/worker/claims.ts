/** How long a row claimed by a worker batch stays with that worker; a worker that stops mid-batch frees it after this. */
export const CLAIM_LEASE_MS = 60_000;
/** A batch stops this long into its lease and hands back the rows it did not reach, so no claim outlives its lease. */
export const BATCH_BUDGET_MS = 45_000;
