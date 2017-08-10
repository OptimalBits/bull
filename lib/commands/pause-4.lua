--[[
  Pauses or resumes a queue globably.

   Input:
      KEYS[1] 'wait' or 'paused''
      KEYS[2] 'paused' or 'wait'
      KEYS[3] 'meta-paused'
      KEYS[4] 'paused' o 'resumed' event.

      ARGV[1] 'paused' or 'resumed'

    Event:
      publish paused or resumed event.
]]
if redis.call("EXISTS", KEYS[1]) == 1 then
  redis.call("RENAME", KEYS[1], KEYS[2])
  redis.call("RENAME", KEYS[1] .. ":added", KEYS[2] .. ":added")
end

if ARGV[1] == "paused" then
  redis.call("SET", KEYS[3], 1)
else
  redis.call("DEL", KEYS[3])
end

redis.call("PUBLISH", KEYS[4], ARGV[1])
