-- answer-check: FIRST ANSWER WINS (spec 8.6). Runs atomically on the request record, so when two answers
-- race (a double tap, two devices) exactly one can ever be accepted.
--
-- The relay doesn't judge the answer (only Maa's phone does, with the 7 checks). It only checks that this
-- device may answer this request now: it was asked, it answers the device that asked, the request is still
-- open, and the deadline (plus 30 s of grace for late answers) hasn't passed.
--
-- KEYS[1] = rq:<requestId>
-- ARGV    = answererId, recipientId, nowMs, graceMs
-- Returns { status, deadline, to } where status is one of
--   ok, ok_late, expired, not_allowed, already_answered, cancelled

local r = redis.call('HMGET', KEYS[1], 'from', 'to', 'state', 'deadline')
-- 1. The record must exist; records disappear 90 s after their deadline.
if not r[1] then return { 'expired', '0', '' } end
-- 2. The answer must go back to the device that asked.
if r[1] ~= ARGV[2] then return { 'not_allowed', r[4], r[2] } end
-- 3. The answerer must be one of the request's targets (plain substring search on ",id,").
if not string.find(',' .. r[2] .. ',', ',' .. ARGV[1] .. ',', 1, true) then return { 'not_allowed', r[4], r[2] } end
-- 4. Only an open request can be answered.
if r[3] == 'answered' then return { 'already_answered', r[4], r[2] } end
if r[3] == 'cancelled' then return { 'cancelled', r[4], r[2] } end
-- 5. Within the deadline plus the grace period, on the RELAY's clock.
local now, deadline = tonumber(ARGV[3]), tonumber(r[4])
if now > deadline + tonumber(ARGV[4]) then return { 'expired', r[4], r[2] } end
-- Accepted: record who answered, so every later answer is refused.
redis.call('HSET', KEYS[1], 'state', 'answered', 'by', ARGV[1])
if now > deadline then return { 'ok_late', r[4], r[2] } end
return { 'ok', r[4], r[2] }
