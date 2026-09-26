-- gcra: rate limiting with the Generic Cell Rate Algorithm (spec 16.1).
-- One key per limited thing stores its "theoretical arrival time" (TAT): when the next request would be due
-- if requests arrived at exactly the steady rate. A request is allowed if it isn't more than `burst`
-- intervals ahead of that schedule.
--
-- KEYS[1] = rl:<scope>:<key>
-- ARGV    = nowMs, intervalMs (T = window / limit), burst
-- Returns 0 when allowed, otherwise the milliseconds until the request would be allowed (retryAfterMs).

local now, T, burst = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3])
local tat = tonumber(redis.call('GET', KEYS[1]) or '0')
-- This request moves the schedule one interval forward (from now, if the schedule had fallen behind).
local newTat = math.max(tat, now) + T
-- It may run ahead of real time by at most `burst` intervals.
local allowAt = newTat - burst * T
if allowAt > now then return math.ceil(allowAt - now) end
-- Allowed: save the new schedule; the key expires once it no longer matters.
redis.call('SET', KEYS[1], newTat, 'PX', math.ceil(newTat - now))
return 0
