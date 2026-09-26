-- Retention (spec 15.3). Run daily by the backup container right after the nightly dump, and by
-- `admin retention`. Unqualified names: it runs in whichever schema the connection's search_path selects.
--
--   devices                 active until retired, or 12 months without a login → tombstone (ID, public key,
--                           retire date; platform and version cleared), with the deletions of 6.6
--   contact_bindings        revoked rows are KEPT while the target is active (a block must persist)
--   push_subscriptions      expired rows: 30 days
--   audit_events            1 year
--   lab_attacks             90 days
-- Inbox frames and request records expire by themselves in Valkey.

begin;

-- 1. Devices unseen for 12 months become tombstones, exactly as if they had retired (6.6, 17.2).
with stale as (
  update devices
     set retired_at = now(), platform = null, app_version = null
   where retired_at is null
     and last_seen_on < current_date - interval '12 months'
  returning device_id
), grants as (
  delete from contact_grants where target_device_id in (select device_id from stale) returning 1
), subs as (
  delete from push_subscriptions where device_id in (select device_id from stale) returning 1
), as_target as (
  delete from contact_bindings where target_device_id in (select device_id from stale) returning 1
), as_sender as (
  -- Revoked rows stay: a blocked device can't erase its block by going quiet.
  delete from contact_bindings
   where sender_device_id in (select device_id from stale) and revoked_at is null
  returning 1
)
insert into audit_events (kind, subject, meta)
select 'device_retired', null, jsonb_build_object('by', 'retention', 'count', count(*))
  from stale
having count(*) > 0;

-- 2. Dead push subscriptions: 30 days after they expired.
delete from push_subscriptions where expired_at is not null and expired_at < now() - interval '30 days';

-- 3. Security events: 1 year.
delete from audit_events where at < now() - interval '1 year';

-- 4. Security Lab attack records: 90 days.
delete from lab_attacks where at < now() - interval '90 days';

commit;
