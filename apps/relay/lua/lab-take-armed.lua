-- lab-take-armed: the Security Lab's armed attack fires ONCE (spec 14.3, frontend J1): the first matching
-- message takes it and disarms it in the same step, so two gateways can never both fire it.
--
-- KEYS[1] = lab:armed   hash { attack, asker, answerer }
-- ARGV    = kind ("request" or "answer"), fromDeviceId, toDeviceId, unused
-- Returns the attack name when this message matches (and disarms), otherwise false.
--   change        matches the next verify.answer from the answerer to the asker
--   replay, forge match the next verify.request from the asker to the answerer

local a = redis.call('HMGET', KEYS[1], 'attack', 'asker', 'answerer')
if not a[1] then return false end
if ARGV[1] == 'answer' then
  if a[1] ~= 'change' or ARGV[2] ~= a[3] or ARGV[3] ~= a[2] then return false end
else
  if a[1] == 'change' or ARGV[2] ~= a[2] or ARGV[3] ~= a[3] then return false end
end
redis.call('DEL', KEYS[1])
return a[1]
