--[[
  Move job from active to a finished status (completed o failed)
  A job can only be moved to completed if it was active.
  The job must be locked before it can be moved to a finished status,
  and the lock must be released in this script.

     Input:
      KEYS[1] active key
      KEYS[2] completed/failed key
      KEYS[3] jobId key

      ARGV[1]  jobId
      ARGV[2]  timestamp
      ARGV[3]  msg property
      ARGV[4]  return value / failed reason
      ARGV[5]  token
      ARGV[6]  shouldRemove
      ARGV[7]  event channel
      ARGV[8]  event data (? maybe just send jobid).

     Output:
      0 OK
      -1 Missing key.

     Events:
      'completed'
]]

if redis.call("EXISTS", KEYS[3]) == 1 then -- // Make sure job exists  
  if ARGV[5] ~= "0" then
    local lockKey = KEYS[3] .. ':lock'
    if redis.call("GET", lockKey) == ARGV[5] then
      redis.call("DEL", lockKey)
    else
      return -1
    end
  end

  -- Remove from active list
  redis.call("LREM", KEYS[1], -1, ARGV[1])

  -- Remove job?
  if ARGV[6] == "1" then
    redis.call("DEL", KEYS[3])
  else
    -- Add to complete/failed set
    redis.call("ZADD", KEYS[2], ARGV[2], ARGV[1])
    redis.call("HSET", KEYS[3], ARGV[3], ARGV[4]) -- "returnvalue" / "failedReason"
  end

  -- TODO PUBLISH EVENT, this is the most optimal way.
  --redis.call("PUBLISH", ...)
  return 0
else
  return -1
end
