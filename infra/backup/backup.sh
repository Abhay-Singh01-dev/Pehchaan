#!/usr/bin/env bash
# The nightly backup (spec 18.10, 15.3), run by supercronic in the backup container:
#   1. pg_dump (custom format) of the relay's database;
#   2. encrypt it with age to the backup PUBLIC key (the private key is never on the VM: two teammates keep it);
#   3. upload it with rclone to the bucket at a different provider, then delete copies older than 30 days;
#   4. run the retention SQL (15.3);
#   5. write the heartbeat metric the "backup missing for more than 26 h" notice watches (19.5).
# Settings (the VM's .env): DATABASE_URL, BACKUP_AGE_RECIPIENT, BACKUP_REMOTE (default backup:pehchaan-backups),
# RCLONE_CONFIG_BACKUP_* (the bucket), METRICS_DIR (default /metrics).
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT (the age public key) is required}"
REMOTE="${BACKUP_REMOTE:-backup:pehchaan-backups}"
METRICS="${METRICS_DIR:-/metrics}"
HERE="$(cd "$(dirname "$0")" && pwd)"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# 1–2. The plain dump exists only inside this temporary directory, and only until it is encrypted.
pg_dump --format=custom --no-owner --dbname="$DATABASE_URL" --file="$work/pehchaan.dump"
age --recipient "$BACKUP_AGE_RECIPIENT" --output "$work/pehchaan-$stamp.dump.age" "$work/pehchaan.dump"
rm -f "$work/pehchaan.dump"

# 3. Off-provider copy; keep 30 days.
rclone copyto "$work/pehchaan-$stamp.dump.age" "$REMOTE/pehchaan-$stamp.dump.age"
rclone delete --min-age 30d "$REMOTE"

# 4. Retention, right after the dump (so the dump still holds what retention removes today).
psql "$DATABASE_URL" --quiet -v ON_ERROR_STOP=1 --file="$HERE/retention.sql"

# 5. Heartbeat for Grafana Alloy's textfile collector (written atomically).
mkdir -p "$METRICS"
printf '# HELP pehchaan_backup_last_success_timestamp_seconds Unix time of the last successful backup.\n# TYPE pehchaan_backup_last_success_timestamp_seconds gauge\npehchaan_backup_last_success_timestamp_seconds %s\n' \
  "$(date +%s)" >"$METRICS/backup.prom.tmp"
mv "$METRICS/backup.prom.tmp" "$METRICS/backup.prom"

echo "backup ok: pehchaan-$stamp.dump.age"
