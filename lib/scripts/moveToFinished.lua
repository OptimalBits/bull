--[[
  Move job from active to a finished status (completed o failed)
  A job can only be moved to completed if it was active.

     Input:
      KEYS[1] active key
      KEYS[2] completed/failed key
      KEYS[3] jobId key

      ARGV[1]  jobId
      ARGV[2]  timestamp
      ARGV[3]  msg property
      ARGV[4]  return value / failed reason
      ARGV[5]  shouldRemove
      ARGV[6]  event channel
      ARGV[7]  event data (? maybe just send jobid).

     Output:
      0 OK
      1 Missing key.

     Events:
      'completed'
]]
if redis.call("EXISTS", KEYS[3]) == 1 then -- // Make sure job exists
  redis.call("LREM", KEYS[1], -1, ARGV[1])

  -- Remove job?
  if ARGV[5] == "1" then
    redis.call("DEL", KEYS[3])
  else
    redis.call("ZADD", KEYS[2], ARGV[2], ARGV[1])
    redis.call("HSET", KEYS[3], ARGV[3], ARGV[4]) -- "returnvalue" / "failedReason"
  end

  -- TODO PUBLISH EVENT, this is the most optimal way.
  --redis.call("PUBLISH", ...)
  return 0
else
  return -1
end
