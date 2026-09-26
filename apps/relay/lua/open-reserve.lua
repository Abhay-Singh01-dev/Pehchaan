-- open-reserve: at most 3 open requests per asker at once (spec 16.1, REL-17).
-- A separate single-key script (not part of request-create) so every script touches one hash slot.
--
-- KEYS[1] = oq:<askerId>   sorted set: requestId -> deadline
-- ARGV    = requestId, deadlineMs, nowMs, maxOpen, keyTtlMs
-- Returns 1 when reserved, 0 when the asker already has maxOpen open requests.

-- Requests whose deadline has passed no longer count.
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[3])
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[4]) then return 0 end
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[1])
redis.call('PEXPIRE', KEYS[1], ARGV[5])
return 1
