-- cancel: the asker stops waiting (spec 8.6). Allowed only for the device that asked, and only while the
-- request is open; its targets then get verify.cancel { asker_cancelled }.
--
-- KEYS[1] = rq:<requestId>
-- ARGV    = senderId
-- Returns { status, to } where status is one of ok, expired, not_allowed, already_answered, cancelled.

local r = redis.call('HMGET', KEYS[1], 'from', 'to', 'state')
if not r[1] then return { 'expired', '' } end
-- Only the asker may cancel its own request.
if r[1] ~= ARGV[1] then return { 'not_allowed', '' } end
if r[3] == 'answered' then return { 'already_answered', r[2] } end
if r[3] == 'cancelled' then return { 'cancelled', r[2] } end
redis.call('HSET', KEYS[1], 'state', 'cancelled')
return { 'ok', r[2] }
