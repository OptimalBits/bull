--[[
  Moves job from active to delayed set.

  Input: 
    KEYS[1] active key
    KEYS[2] delayed key
    KEYS[3] job key

    ARGV[1] delayedTimestamp
    ARGV[2] the id of the job
    ARGV[3] queue token

  Output:
    0 - OK
   -1 - Missing job.
   -2 - Job is locked.

  Events:
    - delayed key.
]]
if redis.call("EXISTS", KEYS[3]) == 1 then

  -- Check for job lock
  if ARGV[3] ~= "0" then
    local lockKey = KEYS[3] .. ':lock'
    local lock = redis.call("GET", lockKey)
    if redis.call("GET", lockKey) ~= ARGV[3] then
      return -2
    end
  end
  
  local score = tonumber(ARGV[1])
  redis.call("ZADD", KEYS[2], score, ARGV[2])
  redis.call("PUBLISH", KEYS[2], (score / 0x1000))
  redis.call("LREM", KEYS[1], 0, ARGV[2])

  return 0
else
  return -1
end
