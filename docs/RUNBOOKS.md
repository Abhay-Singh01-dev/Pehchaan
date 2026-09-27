# Pehchaan runbooks

What to do when something needs doing or something goes wrong (backend spec section 24, with 18.4–18.10 and 19.5).
Every alert in `infra/grafana/alerts.json` links to a section here. The commands are the real ones: `pnpm test:ops`
runs `deploy.sh`, the rollback, `backup.sh`, `restore.sh`, the admin CLI and `infra/grafana/import.mjs` against a
full local copy of the production stack, and `tests/unit/runbooks.test.ts` checks that every service, admin command
and file named below exists.

**Golden rules**

- If a change made things worse, **roll back first** (see [Rollback](#rollback)), then investigate.
- The relay fails closed. When it is down, people see "Not confirmed yet", never a false "Confirmed". A false green is
  the only emergency that outranks everything else ([Security Lab false green](#false-green)).
- Never publish Valkey (6379) or Postgres (5432). For database access use an SSH tunnel:
  `ssh -L 5432:localhost:5432 …` does **not** work (the port isn't on the VM's host); use
  `docker compose exec postgres psql -U pehchaan -d pehchaan` on the VM instead.
- Never paste secrets, device IDs, push endpoints or phone numbers into the team chat.

## Contents

- [Getting onto a VM](#getting-onto-a-vm)
- [One-time setup](#one-time-setup): [Oracle Cloud](#oracle-cloud), [secrets](#secrets), [backups key and bucket](#backup-key-and-bucket), [Grafana setup](#grafana-setup)
- [Normal deploy](#normal-deploy) · [Rollback](#rollback)
- [Relay down](#relay-down) · [Server errors](#server-errors) · [Standby switch](#standby-switch)
- [Valkey or Postgres errors](#store-errors) · [Event-loop lag](#event-loop-lag) · [Push failures](#push-failures) · [Connections dropped](#connections-drop)
- [Security Lab false green](#false-green) · [Suspected security incident](#security-incident)
- [Disk](#disk) · [Backups](#backups) · [Monthly restore test](#restore-test) · [Certificates](#certificates)
- [Judging day](#judging-day) · [Deletion request by email](#deletion-request) · [Abusive device](#abusive-device)

---

<a id="getting-onto-a-vm"></a>

## Getting onto a VM

```bash
ssh ubuntu@<vm-ip>            # the default user, for system work (sudo)
ssh deploy@<vm-ip>            # the deploy user, for everything in /opt/pehchaan (it is in the docker group)
cd /opt/pehchaan
docker compose ps             # every service, its state and health
```

`<vm-ip>` is the reserved public IP of the production or staging VM (Oracle console → Compute → Instances). The
stack's files are `compose.yml`, `Caddyfile`, `config.alloy`, `deploy.sh`, `.env` (secrets, mode 600) and
`deploy.log` (the tags deployed, newest last).

---

<a id="one-time-setup"></a>

## One-time setup

<a id="oracle-cloud"></a>

### Oracle Cloud (spec 18.4)

Do this in week 1: card checks and Arm capacity can take days.

1. **Sign up at cloud.oracle.com.** Use a Visa or Mastercard with international transactions enabled. **Home region:
   Mumbai (`ap-mumbai-1`) or Hyderabad.** It can never be changed, and Always Free resources exist only there.
2. **Upgrade to Pay As You Go, then Budgets → a US$1 monthly budget with an alert at any spend.** Always Free resources
   stay free; Pay As You Go stops Oracle reclaiming "idle" instances. Only create resources marked
   **"Always Free-eligible"**.
3. **Network:** Networking → Virtual Cloud Networks → "Start VCN Wizard" → "VCN with Internet Connectivity". In its
   default security list add ingress rules: TCP 80 and TCP 443 from `0.0.0.0/0` (TCP 22 is already there).
4. **Two instances** (production and staging): shape `VM.Standard.A1.Flex`, image Ubuntu 24.04 (aarch64), **1 OCPU and
   6 GB each**. Networking → Reserved Public IPs → reserve one per VM and attach it. "Out of capacity": try another
   availability domain or retry later. The AMD `VM.Standard.E2.1.Micro` is the emergency fallback.
5. **First boot:** in "Advanced options → Management → cloud-init script", paste `infra/vm/cloud-init.yaml` after
   replacing the placeholder with the **public** half of the CI deploy key (made in [Secrets](#secrets), step 1).
6. **On each VM, as `deploy`, in `/opt/pehchaan`:**
   ```bash
   # from the laptop, in the repository:
   scp infra/vm/compose.yml infra/vm/Caddyfile infra/vm/config.alloy infra/vm/deploy.sh deploy@<vm-ip>:/opt/pehchaan/
   scp infra/vm/env.example deploy@<vm-ip>:/opt/pehchaan/.env
   # then on the VM:
   chmod +x deploy.sh && chmod 600 .env
   nano .env                     # fill in every value (Secrets, step 3); `openssl rand -hex 32` for each password and key
   docker login ghcr.io -u <github-user>   # once, with a read-only token (Secrets, step 4)
   ```
7. **DNS (Cloudflare):** an A record `relay` → the production VM's reserved IP and `relay-staging` → the staging VM's,
   both "DNS only" and TTL 60 s; CAA `0 issue "letsencrypt.org"`. Caddy gets its certificates by itself on the first
   deploy.
8. The first deploy comes from CI: merge to `main` ([Normal deploy](#normal-deploy)).

<a id="secrets"></a>

### Secrets (spec 16.4, 18.7, 18.8)

Nothing below is ever committed. `env.example` holds the names only.

1. **CI deploy key:** `ssh-keygen -t ed25519 -C pehchaan-ci-deploy -f pehchaan-ci-deploy -N ""`. The `.pub` half goes
   into `cloud-init.yaml` (step 5 above); the private half becomes the `DEPLOY_SSH_KEY` secret.
2. **GitHub → Settings → Environments.** Create `staging` and `production` (add required reviewers to `production`: it
   is the approval step of `deploy-relay.yml`). In each:

   | Kind | Name | Value |
   |---|---|---|
   | variable | `VM_IP` | that VM's reserved IP |
   | variable | `CANARY_RELAY_URL` | `wss://relay.yourdomain.in/v1/ws` (staging: `wss://relay-staging.yourdomain.in/v1/ws`) |
   | variable | `CANARY_ORIGIN` | `https://app.yourdomain.in` (staging: `https://staging.yourdomain.in`) |
   | secret | `DEPLOY_SSH_KEY` | the private key from step 1 |
   | secret | `VM_KNOWN_HOSTS` | the output of `ssh-keyscan -t ed25519 <vm-ip>` (pins the VM's host key) |
   | secret | `CANARY_IDENTITIES` | the output of `pnpm --filter @pehchaan/canary exec tsx src/cli.ts keys` (a new one per environment) |
   | secret | `ALERT_WEBHOOK_URL` | (production) the team chat's incoming webhook: the canary pages here after 3 failures |

   The images are pushed to `ghcr.io/<owner>` with the workflow's own `GITHUB_TOKEN`; nothing to create.
3. **Each VM's `.env`** (fill every value in `env.example`; secrets marked):

   | Name | How |
   |---|---|
   | `VALKEY_PASSWORD`, `POSTGRES_PASSWORD` (secret) | `openssl rand -hex 32` each; then put them into `REDIS_URL` and `DATABASE_URL` |
   | `AUDIT_KEY`, `IP_HASH_KEY` (secret) | `openssl rand -hex 32` each |
   | `VAPID_KEY_ID`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (private: secret) | `pnpm tsx infra/scripts/vapid-keys.ts <key-id>`; one pair per environment, and the public key and ID also go into Vercel (`VITE_VAPID_PUBLIC_KEY`, `VITE_VAPID_KEY_ID`) |
   | `LAB_PASSWORD_HASH` (secret) | `pnpm tsx infra/scripts/lab-password-hash.ts`; in single quotes; only when `LAB_ENABLED=true` |
   | `IMAGE_REGISTRY` | `ghcr.io/<owner>` in lower case |
   | `SENTRY_DSN` | from Sentry (project → Client Keys); may stay empty |
   | `BACKUP_AGE_RECIPIENT`, `RCLONE_CONFIG_BACKUP_*` (bucket keys: secret) | [Backup key and bucket](#backup-key-and-bucket) |
   | `GRAFANA_CLOUD_*` (token: secret) | Grafana Cloud → your stack → "Prometheus" and "Loki" details: the push URLs and user numbers, and an access policy token with `metrics:write` and `logs:write` |

4. **Registry read token for the VMs:** GitHub → Settings → Developer settings → a classic token with only
   `read:packages`, used once by `docker login ghcr.io` on each VM.
5. **Kept offline, never on a server:** the backup `age` private key (two teammates), the Security Lab password, the
   Grafana import token.
6. **Turn on 2FA** for GitHub, Vercel, Oracle Cloud, Cloudflare and the domain registrar.

<a id="backup-key-and-bucket"></a>

### Backup key and bucket (spec 18.10)

1. On a teammate's laptop: `age-keygen -o pehchaan-backup.key`. It prints the public key (`age1…`): that is
   `BACKUP_AGE_RECIPIENT` on both VMs. Give `pehchaan-backup.key` to a second teammate (a password manager); it never goes
   to a VM or the repository.
2. Create a bucket `pehchaan-backups` at a **different provider** (Cloudflare R2 or Backblaze B2) with an access key
   limited to that bucket, and fill in `RCLONE_CONFIG_BACKUP_*` (for R2: `TYPE=s3`, `PROVIDER=Cloudflare`, the key ID,
   the secret and the account endpoint).
3. After the first deploy, run the backup once by hand and check it arrived ([Backups](#backups)).

<a id="grafana-setup"></a>

### Grafana setup (spec 19.3, 19.5)

Alloy on each VM pushes metrics and logs to Grafana Cloud. The dashboards and alert rules live in `infra/grafana/` and
are loaded with one command, which is idempotent (run it again after any change):

1. Grafana Cloud → Administration → Service accounts → "Add service account" (role **Editor**) → "Add token".
2. Connections → Data sources → the Prometheus source Alloy writes to → copy its UID from the URL.
3. From the repository:
   ```bash
   GRAFANA_URL=https://<stack>.grafana.net GRAFANA_TOKEN=<token> GRAFANA_PROM_UID=<uid> node infra/grafana/import.mjs
   ```
   It creates the "Pehchaan" folder, the five dashboards and every alert rule.
4. Alerting → Contact points: add the team email and chat, and route `severity=page` and `severity=notice` to them.
5. Add an external uptime check (for example UptimeRobot) on `https://relay.yourdomain.in/healthz` every 5 minutes.

---

<a id="normal-deploy"></a>

## Normal deploy (24.1)

1. Merge to `main`. `ci` runs; when it passes, `deploy-relay` builds the images once (arm64 + amd64), scans them,
   deploys to staging, runs the smoke test, then waits for a reviewer's approval of the `production` environment.
2. Approve in GitHub → Actions → the run → "Review deployments". Production deploys with the same images; the canary
   runs against it.
3. Watch the Overview dashboard for 15 minutes: error rate, connections, the delivery funnel.
4. If anything looks worse than before, [roll back](#rollback) first and investigate afterwards.

`deploy.sh` replaces one relay container at a time. Each old container drains (18.9): Caddy stops sending it new
connections, it asks every phone to reconnect, and the phones move to the other container. A check in progress
survives, because its request record and inbox are in Valkey.

<a id="rollback"></a>

## Rollback (24.2)

- **Relay:** find the previous tag, then deploy it:
  ```bash
  ssh deploy@<vm-ip> tail -n 5 /opt/pehchaan/deploy.log
  ssh deploy@<vm-ip> /opt/pehchaan/deploy.sh <previous tag>
  ```
  Migrations are expand-only (`pnpm check-migrations` enforces it), so a relay rollback never needs a database
  rollback.
- **App:** Vercel → Deployments → the previous production deployment → "Promote to Production". The service worker
  picks it up at the next launch.

---

<a id="relay-down"></a>

## Relay down (24.3)

Alert "Relay down" (a relay process isn't answering), the external uptime monitor, or the canary failing.

1. Check the uptime monitor and Oracle Cloud's status page (Mumbai).
2. On the VM:
   ```bash
   docker compose ps
   docker compose logs --tail 200 relay-a relay-b caddy
   ```
   Check the VM's CPU, memory and disk on the Infrastructure dashboard.
3. One container unhealthy: `docker compose restart relay-a` (or `relay-b`). While one restarts, the other serves
   everyone.
4. Both relays unhealthy: usually Valkey or Postgres; see [Valkey or Postgres errors](#store-errors).
5. The VM itself unresponsive: Oracle console → the instance → Reboot. Every container starts again by itself
   (`restart: unless-stopped`); `pnpm test:ops` checks the whole stack is healthy within 60 s of starting.
6. The VM or the region gone: [Standby switch](#standby-switch).
7. Post a status note (a pinned message in the team chat).

<a id="server-errors"></a>

## Server errors (alert "Server error rate above 2%")

1. Was there a deploy in the last hour? If yes, [roll back](#rollback) now.
2. Otherwise, on the VM: `docker compose logs --tail 200 relay-a relay-b` and look at `"level":50` (error) lines;
   Sentry groups the same errors with stack traces.
3. A dependency behind it (Valkey, Postgres, a push service)? Follow that section.
4. Fix, add a test that reproduces it, deploy.

<a id="standby-switch"></a>

## Standby switch: turn the staging VM into production (24.3 step 3, target 30 minutes)

Practise this once before judging. Staging is sacrificed while it lasts: both stacks can't share one project name,
ports or volumes.

1. On the staging VM, as `deploy`:
   ```bash
   cd /opt/pehchaan
   docker compose down
   mv .env .env.staging
   # copy the production .env into place (from the password manager), mode 600
   docker volume rm pehchaan_pgdata
   docker compose up -d --wait postgres valkey
   docker compose up -d --no-deps backup
   ```
2. Restore the latest production dump into the new database (the backup container has the bucket credentials from
   the production `.env`):
   ```bash
   docker compose exec backup rclone lsf backup:pehchaan-backups | tail -n 1
   docker compose exec backup rclone copyto backup:pehchaan-backups/<file> /tmp/<file>
   # from the laptop that holds the age key:
   ssh deploy@<staging-ip> 'cd /opt/pehchaan && docker compose exec -T backup sh -c "umask 077; cat > /tmp/restore.key"' < pehchaan-backup.key
   # back on the VM (POSTGRES_PASSWORD is the production one, from .env):
   docker compose exec backup /opt/backup/restore.sh /tmp/<file> /tmp/restore.key "postgres://pehchaan:<POSTGRES_PASSWORD>@postgres:5432/pehchaan"
   docker compose exec backup sh -c 'rm -f /tmp/restore.key /tmp/*.dump.age'
   ```
3. `./deploy.sh <current production tag>` (the last line of production's `deploy.log`, or the last successful
   `deploy-relay` run).
4. Cloudflare → DNS → the `relay` A record → the staging VM's IP (TTL 60 s). Check `https://relay.yourdomain.in/healthz`
   and run the canary: GitHub → Actions → canary → "Run workflow".
5. If Oracle itself is unusable, do the same on an Azure for Students VM (Central India) set up with
   `infra/vm/cloud-init.yaml`.
6. **Afterwards:** rebuild a fresh staging VM, restore `.env.staging` there, and point `relay` back when production is
   repaired.

---

<a id="store-errors"></a>

## Valkey or Postgres errors (24.4)

**Valkey** (alert "Redis or Postgres errors", `op` label shows Redis commands):

```bash
docker compose logs --tail 200 valkey
docker compose restart valkey
```

The relay fails closed while Valkey is away (`unavailable`): new checks end "Not confirmed yet". Valkey keeps nothing
on disk by design; routes rebuild themselves as phones reconnect (15.4) and in-flight checks end "Not confirmed yet".
If it is full (`maxmemory 768mb`, `noeviction`), writes are refused rather than anything being evicted: look at the
connection count and the inbox metrics before raising the limit.

**Postgres:**

```bash
docker compose logs --tail 200 postgres
docker compose restart postgres
```

Warm caches keep existing families working for up to 10 minutes; a brand-new contact fails once, then works. If the
data is damaged, restore the latest dump into a fresh volume (as in the [Standby switch](#standby-switch), step 2),
then `docker compose restart relay-a relay-b`. Afterwards check the blocks survived:

```bash
docker compose exec postgres psql -U pehchaan -d pehchaan -c "select count(*) from contact_bindings where revoked_at is not null"
```

<a id="event-loop-lag"></a>

## Event-loop lag (alert "Event-loop lag p99 above 200 ms")

The relay's single thread is busy: every message waits.

1. Infrastructure dashboard: is the VM's CPU at 100%? Which container? `docker stats --no-stream`.
2. Connections far above normal (Overview)? A reconnect storm after an outage settles by itself within a minute.
3. One container only: `docker compose restart relay-a` (or `relay-b`).
4. Sustained under normal traffic: lower `MAX_SOCKETS` in `.env` (so `/readyz` sends extra connections to the other
   container) and redeploy the same tag with `./deploy.sh <current tag>`; then plan capacity (spec 20.2).

<a id="push-failures"></a>

## Push failures (alert "Push failures above 10%")

Push dashboard, by service (`fcm`, `apple`, `mozilla`, `wns`) and result:

- **404/410** rising alone: expired subscriptions. The relay deletes them and the phone re-subscribes at its next
  login. Normal churn unless it spikes after a VAPID change.
- **403** everywhere: the VAPID keys don't match. The relay's `VAPID_PUBLIC_KEY`/`VAPID_KEY_ID` must equal the app's
  `VITE_VAPID_PUBLIC_KEY`/`VITE_VAPID_KEY_ID`. Rotation keeps the previous pair for 30 days (`VAPID_PREVIOUS_*`, 11.9).
- **5xx or timeouts** for one service: that push service is having an outage. Open apps are unaffected; closed apps
  get alerts late. Nothing to do but watch its status page.
- Check the VM can reach the internet: `docker compose exec relay-a node -e "fetch('https://fcm.googleapis.com').then(r=>console.log(r.status))"`.

<a id="connections-drop"></a>

## Connections dropped (alert "Connections dropped by more than 50%")

1. A deploy running? Connections dip while containers drain and come back within seconds. If they don't come back,
   [roll back](#rollback).
2. `docker compose ps`: a relay or Caddy restarting? `docker compose logs --tail 200 caddy`.
3. From outside: `curl -sI https://relay.yourdomain.in/healthz`. DNS or certificate trouble shows here
   ([Certificates](#certificates)).
4. Oracle network issue: check Oracle's status page; if it lasts, the [Standby switch](#standby-switch).

---

<a id="false-green"></a>

## Security Lab false green (alert "Security Lab false green")

A Lab attack produced a green "Confirmed". This must never happen (`pehchaan_lab_false_greens_total` must stay 0).
It is a security incident: follow [Suspected security incident](#security-incident), starting now.

1. Switch the Lab off at once: `docker compose exec relay-a node dist/admin.js lab off`.
2. **Freeze deploys** (nothing but this fix ships).
3. Keep the evidence: export the Lab log from the Security Lab page, and the attack rows:
   ```bash
   docker compose exec postgres psql -U pehchaan -d pehchaan -c "select * from lab_attacks where false_green order by at desc limit 20"
   ```
4. Find which of the 7 checks let it through (`failed_checks` is empty on a false green) and reproduce it as a failing
   test in `packages/crypto/test` before touching `verifier.ts`.

<a id="security-incident"></a>

## Suspected security incident (24.5)

1. **Contain:** rotate the affected secrets (a new value in `.env`, then `./deploy.sh <current tag>`), block suspicious
   devices ([Abusive device](#abusive-device)), and switch the Lab off:
   `docker compose exec relay-a node dist/admin.js lab off`.
2. **Assess:** `audit_events`, the logs in Grafana (Loki) and the provider access logs. What could have been exposed?
   Pseudonymous device IDs, bindings and push endpoints. Names, numbers and message contents are not on the servers.
3. **Notify:** if personal data was affected, inform the Data Protection Board and the affected users on the timeline
   the DPDP Rules require (17.2). Draft the notice in English and Hindi.
4. **Fix, write a blameless post-mortem in `docs/incidents/`, and add a test that would have caught it.**

---

<a id="disk"></a>

## Disk (notice "VM disk above 70%")

```bash
df -h /
docker system df
docker image prune -f          # old relay images (deploy.sh also does this after every deploy)
sudo journalctl --vacuum-time=7d
```

Container logs are capped (20 MB × 5 files per container, `compose.yml`), so they can't fill the disk. Postgres grows
slowly; retention (15.3) runs nightly after the backup, and can be run at once with
`docker compose exec relay-a node dist/admin.js retention`. If the boot volume is simply too small, grow it in the
Oracle console (up to 200 GB in total is Always Free), then `sudo growpart /dev/sda 1 && sudo resize2fs /dev/sda1`.

<a id="backups"></a>

## Backups (notice "Nightly backup missing for more than 26 h")

The `backup` container runs `/opt/backup/backup.sh` at 20:45 UTC (02:15 IST): `pg_dump`, encryption to the `age`
public key, upload with `rclone`, deletion of copies older than 30 days, the retention SQL, then the heartbeat metric.

```bash
docker compose ps backup
docker compose logs --tail 100 backup
docker compose exec backup cat /metrics/backup.prom       # the last success, in Unix time
docker compose exec backup /opt/backup/backup.sh          # run it now; it prints "backup ok: pehchaan-<time>.dump.age"
docker compose exec backup rclone lsf backup:pehchaan-backups
```

Usual causes: the bucket key expired or was revoked (`RCLONE_CONFIG_BACKUP_*`), the bucket's free quota, or the
`backup` container not running (it starts with every deploy).

<a id="restore-test"></a>

## Monthly restore test (18.10)

On the **staging** VM, into a throwaway Postgres (never staging's own database). `pnpm test:ops` (OPS-05) runs
exactly these steps on a local stack.

```bash
cd /opt/pehchaan
docker run -d --name restore-test --network pehchaan_internal -e POSTGRES_USER=pehchaan -e POSTGRES_DB=pehchaan -e POSTGRES_PASSWORD=restore-test postgres:16
docker compose exec backup rclone lsf backup:pehchaan-backups | tail -n 1
docker compose exec backup rclone copyto backup:pehchaan-backups/<file> /tmp/<file>
# from the laptop that holds the age key:
ssh deploy@<staging-ip> 'cd /opt/pehchaan && docker compose exec -T backup sh -c "umask 077; cat > /tmp/restore.key"' < pehchaan-backup.key
# on the VM:
docker compose exec backup /opt/backup/restore.sh /tmp/<file> /tmp/restore.key postgres://pehchaan:restore-test@restore-test:5432/pehchaan
docker exec restore-test psql -U pehchaan -d pehchaan -c "select count(*) from devices" -c "select count(*) from contact_bindings where revoked_at is not null"
docker rm -f restore-test
docker compose exec backup sh -c 'rm -f /tmp/restore.key /tmp/*.dump.age'
```

The counts should match production's at the time of the dump. Record the date in the team's judging checklist.

<a id="certificates"></a>

## Certificates (notice "Certificate expires within 20 days")

Caddy renews Let's Encrypt certificates about 30 days before expiry by itself, so this notice means renewal is
failing.

```bash
docker compose logs --tail 300 caddy | grep -i -e acme -e certificate -e error
curl -vI https://relay.yourdomain.in/healthz 2>&1 | grep -i -e expire -e issuer
```

Usual causes: the `relay` DNS record no longer points at this VM; ports 80/443 closed (Oracle security list, or the
VM firewall that `cloud-init.yaml` opens); the CAA record doesn't allow `letsencrypt.org`; Let's Encrypt rate limits
after many rebuilds (wait, or use the staging CA while testing). After fixing: `docker compose restart caddy`.

---

<a id="judging-day"></a>

## Judging day (24.6: finals 31 Oct – 1 Nov)

**T − 7 days**

- Feature freeze. Deploy the final version, then raise `MIN_CLIENT_VERSION` in both `.env` files and
  `./deploy.sh <current tag>`, so every phone runs it.
- Run the full real-phone matrix (spec 21.6) and 50 or more Lab attacks on the real phones; export the log (target:
  0 false greens).
- Confirm last night's backup exists and a restore works ([Monthly restore test](#restore-test)). Check the disk and
  that no Oracle budget alert has fired.
- Set a fresh Lab password (`pnpm tsx infra/scripts/lab-password-hash.ts`), and deploy the event build with
  `LAB_ENABLED=true` (the Lab stays off until switched on).
- **From T − 48 h: deploy freeze** (rollbacks only).

**T − 1 day**

- Both phones: installed from `app.yourdomain.in`; alerts on; storage protected; Chrome battery set to
  **Unrestricted**; Lab opt-in on. Put them on two different carriers (for example Jio and Airtel), on mobile data.
- "Send test alert" with both screens locked: it should arrive within 5 s.
- `docker compose exec relay-a node dist/admin.js lab on`. Laptop: Security Lab and Call Guard open and logged in;
  dashboards open; the canary green.
- Keep the backup screen recording and chargers ready (run sheet).

**T − 2 hours**

- `curl -s https://relay.yourdomain.in/healthz` and `docker compose ps` (both relays healthy). VM CPU below 30%.
- Oracle Cloud's status page for Mumbai.
- Three genuine checks (YES, NOT ME, no answer) and one of each attack.
- Confirm nobody has deployed since the freeze (`tail -n 3 deploy.log`).

**During judging:** one teammate watches the dashboards. If the relay fails, switch to the backup recording and say
plainly what happened. Do not live-debug in front of judges.

**After judging**

- `docker compose exec relay-a node dist/admin.js lab off` immediately; opt the phones out; rotate the Lab password.
  After the freeze, deploy with `LAB_ENABLED=false`.
- Export the Lab log and the `lab_attacks` rows.
- Check the standby is still ready (the latest dump restored cleanly this week).

<a id="deletion-request"></a>

## Deletion request by email (24.7)

- Ask the person to use Settings → Delete my data, which is instant and self-service.
- If they can't (a lost phone), ask for the device ID shown in the app's Diagnostics on any remaining device. The relay
  holds no names or numbers to search by. When it is identified:
  `docker compose exec relay-a node dist/admin.js retire <deviceId>`.

<a id="abusive-device"></a>

## Abusive device (24.8)

```bash
docker compose exec relay-a node dist/admin.js block <deviceId> --reason "<why>"
docker compose exec relay-a node dist/admin.js unblock <deviceId>      # if it was a mistake
docker compose exec relay-a node dist/admin.js stats                   # counts only, canaries excluded
```

Each action is written to `audit_events`. Review blocks weekly.
