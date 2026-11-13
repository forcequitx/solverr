#!/usr/bin/env bash
# Dumps the Solverr database into /var/backups/solverr (kept 7 days) and, with BACKUP_REMOTE set to an encrypted rclone
# "crypt" remote (Backblaze B2, Cloudflare R2), copies each dump off the server (kept 30 days). Daily from root's crontab, UTC clock:
#   0 3 * * * BACKUP_REMOTE=solverr-offsite: /opt/solverr/deploy/backup.sh >> /var/log/solverr-backup.log 2>&1
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/solverr}"
BACKUP_REMOTE="${BACKUP_REMOTE:-}"
RETENTION_DAYS=7
REMOTE_RETENTION_DAYS=30

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
compose_file="${script_dir}/docker-compose.yml"
target="${BACKUP_DIR}/solverr-$(date -u +%Y%m%d-%H%M%S).sql.gz"
partial="${target}.partial"

umask 077
mkdir -p "$BACKUP_DIR"

# A run that starts while the previous one is still going stops instead of competing with it.
exec 9>"${BACKUP_DIR}/.backup.lock"
if ! flock -n 9; then
  echo "$(date -u +%FT%TZ) another backup is still running; this run stops" >&2
  exit 1
fi

# Dumps hold customer data, so they leave the server only through an encrypting rclone "crypt" remote.
if [[ -n "$BACKUP_REMOTE" ]] && ! rclone config show "${BACKUP_REMOTE%%:*}" | grep -qx 'type = crypt'; then
  echo "$(date -u +%FT%TZ) BACKUP_REMOTE ${BACKUP_REMOTE} is not an rclone crypt remote; nothing was backed up" >&2
  exit 1
fi

trap 'rm -f "$partial"' EXIT

docker compose -f "$compose_file" exec -T postgres \
  pg_dump --username=solverr --dbname=solverr --no-owner --no-privileges \
  | gzip -9 > "$partial"
# A truncated or corrupt archive fails here and never replaces a good dump.
gzip -t "$partial"
mv "$partial" "$target"

find "$BACKUP_DIR" -maxdepth 1 -type f -name 'solverr-*.sql.gz' -mtime +$((RETENTION_DAYS - 1)) -delete

echo "$(date -u +%FT%TZ) backup written to ${target}"

# The local dump is already safe on disk, so a failed upload only makes this run exit non-zero.
if [[ -n "$BACKUP_REMOTE" ]]; then
  rclone copy "$target" "$BACKUP_REMOTE"
  rclone delete "$BACKUP_REMOTE" --min-age "${REMOTE_RETENTION_DAYS}d" --include 'solverr-*.sql.gz'
  echo "$(date -u +%FT%TZ) backup copied to ${BACKUP_REMOTE}"
fi
