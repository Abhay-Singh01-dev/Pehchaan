#!/usr/bin/env bash
# deploy.sh <image-tag>: rolling deploy, one relay container at a time (spec 18.8, 18.9).
# On a VM it runs in /opt/pehchaan. For local tests: PEHCHAAN_DIR=… SKIP_PULL=1 ./deploy.sh <local-tag>
set -euo pipefail
cd "${PEHCHAAN_DIR:-/opt/pehchaan}"
TAG="$1"
grep -q '^RELAY_TAG=' .env || echo 'RELAY_TAG=' >>.env
sed -i "s/^RELAY_TAG=.*/RELAY_TAG=${TAG}/" .env
docker compose up -d --wait postgres valkey caddy alloy # no-op when already running; needed on first deploy
mapfile -t RELAYS < <(docker compose config --services | grep '^relay-')
[ "${SKIP_PULL:-0}" = 1 ] || docker compose pull "${RELAYS[@]}" backup
docker compose run --rm --no-deps relay-a node dist/migrate.js # expand-only migrations (15.2)
for svc in "${RELAYS[@]}"; do
  docker compose up -d --no-deps "$svc" # SIGTERM → drain (18.9) → new container starts
  for i in $(seq 1 60); do
    [ "$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q "$svc")")" = healthy ] && break
    [ "$i" -eq 60 ] && {
      echo "$svc did not become healthy"
      exit 1
    }
    sleep 2
  done
done
docker compose up -d --no-deps backup
echo "$(date -Is) $TAG" >>deploy.log # the rollback list (24.2)
docker image prune -f
