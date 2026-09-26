-- inbox-put: store one envelope in a device's inbox, atomically (spec 8.5).
-- The inbox holds undelivered envelopes until they expire, so a phone that was offline or switched gateways
-- still gets them at its next login. Both keys share the hash tag {d:<deviceId>}, so this also works on a
-- Redis Cluster.
--
-- KEYS[1] = {d:<id>}:ib          sorted set: message id -> expiry time (ms)
-- KEYS[2] = {d:<id>}:m:<msgId>   the frame JSON, expiring with the envelope
-- ARGV    = msgId, expiresAtMs, frameJson, ttlMs, nowMs, maxEntries
-- Returns 1 when stored, 0 when the inbox is full (the sender's receipt becomes `failed`).

-- Forget entries whose envelopes have already expired.
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[5])
-- An inbox holding 50 undelivered envelopes is refused: nobody legitimate needs more (16.2).
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[6]) then return 0 end
-- Index the envelope by its expiry, so the login drain delivers the soonest-expiring first.
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[1])
-- Store the frame itself; it disappears on its own when its time is up.
redis.call('SET', KEYS[2], ARGV[3], 'PX', ARGV[4])
-- The index lives at most 24 h after the last put (the longest envelope lifetime, an alert).
redis.call('PEXPIRE', KEYS[1], 86400000)
return 1
