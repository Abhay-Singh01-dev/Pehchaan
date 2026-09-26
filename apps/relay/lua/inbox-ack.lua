-- inbox-ack: a device says "I received it" (spec 8.4). Removes the envelope from ITS OWN inbox and returns
-- the frame, so the relay can tell the sender `delivered`. Atomic, so with several sockets for one device
-- only the first ack counts (7.1): later acks find nothing and return false.
--
-- KEYS[1] = {d:<id>}:ib          the acking device's inbox index
-- KEYS[2] = {d:<id>}:m:<msgId>   the envelope
-- ARGV    = msgId
-- Returns the frame JSON, or false if it was already acked or has expired.

local frame = redis.call('GET', KEYS[2])
if not frame then
  -- Nothing to remove (already acked, or expired): keep the index tidy anyway.
  redis.call('ZREM', KEYS[1], ARGV[1])
  return false
end
redis.call('DEL', KEYS[2])
redis.call('ZREM', KEYS[1], ARGV[1])
return frame
