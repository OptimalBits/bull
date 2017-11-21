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
redis.replicate_commands()

local rcall = redis.call

if rcall("EXISTS", KEYS[1]) == 1 then
  rcall("RENAME", KEYS[1], KEYS[2])
end

if ARGV[1] == "paused" then
  rcall("SET", KEYS[3], 1)
else
  rcall("DEL", KEYS[3])
end

rcall("PUBLISH", KEYS[4], ARGV[1])
