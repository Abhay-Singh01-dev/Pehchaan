#!/usr/bin/env bash
# Restores a backup (spec 18.10, runbooks 24.3 and 24.4):
#   restore.sh <file.dump.age> <age-identity-file> <target DATABASE_URL>
# The identity file is the backup's PRIVATE age key, kept offline by two teammates; it is never stored on a VM.
# Restore into a fresh, empty database (a throwaway postgres:16 for the monthly test), never over a live one.
set -euo pipefail

dump="${1:?the .dump.age file}"
identity="${2:?the age identity (private key) file}"
target="${3:?the target DATABASE_URL}"

age --decrypt --identity "$identity" "$dump" | pg_restore --no-owner --exit-on-error --dbname="$target"
echo "restored $(basename "$dump")"
