import { getDb } from "@/lib/db";
import { reportError } from "@/lib/error-reports";
import { logger } from "@/lib/logger";

const log = logger.child({ module: "wal-archiving" });

/** How long archiving may fail before it is reported; a short bucket outage recovers on its own. */
const FAILING_FOR_MS = 15 * 60_000;

type ArchiverState = { mode: string; failing: boolean };

/** When this worker first saw archiving fail, or null; measured here since a quiet database's last archive can be hours old anyway. */
let failingSince: number | null = null;

/** Worker job: reports WAL archiving failing for FAILING_FOR_MS; unarchived WAL stays on disk and would fill it, stopping the database. */
export async function checkWalArchiving(): Promise<void> {
  const [state] = await getDb().$queryRaw<ArchiverState[]>`
    SELECT current_setting('archive_mode') AS mode,
           last_failed_time IS NOT NULL AND (last_archived_time IS NULL OR last_failed_time > last_archived_time) AS failing
    FROM pg_stat_archiver`;
  if (!state || state.mode === "off" || !state.failing) {
    failingSince = null;
    return;
  }
  failingSince ??= Date.now();
  if (Date.now() - failingSince < FAILING_FOR_MS) return;
  const since = new Date(failingSince).toISOString();
  log.error({ since }, "WAL archiving is failing; WAL is piling up on the database disk");
  reportError(new Error(`WAL archiving has been failing since at least ${since}; check deploy/walg.env and the bucket`));
}
