-- request-create: open a request record (spec 8.1). Creating a record with an existing request ID fails:
-- a request ID can be used once (duplicate_request).
--
-- The deadline is computed by the relay from ITS OWN clock and the ttlMs the asker put on the outer
-- envelope, clamped to 10–60 s. The expiresAt inside the request is sealed and never read (8.7).
--
-- KEYS[1] = rq:<requestId>
-- ARGV    = fromDeviceId, toDeviceIds (comma-separated), deadlineMs, recordTtlMs, nowMs
-- Returns 'ok' or 'duplicate'.

-- HSETNX-style: refuse if the record already exists, whatever its state.
if redis.call('EXISTS', KEYS[1]) == 1 then return 'duplicate' end
-- 'at' is when the relay accepted the request, on its own clock: only for the answer-time metric (19.1).
redis.call('HSET', KEYS[1], 'from', ARGV[1], 'to', ARGV[2], 'deadline', ARGV[3], 'state', 'open', 'at', ARGV[5])
-- The record lives until deadline + 90 s, then disappears on its own.
redis.call('PEXPIRE', KEYS[1], ARGV[4])
return 'ok'
