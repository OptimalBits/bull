--[[
  Retries a failed job by moving it back to the wait queue.
    
    Input:
      KEYS[1] 'active',
      KEYS[2] 'wait'
      KEYS[3] jobId
      KEYS[4] 'added'
    
    pushCmd,
    jobId
      ARGV[1]  pushCmd
      ARGV[2]  jobId

    Events:
      'prefix:added'
]]

if redis.call("EXISTS", KEYS[3]) == 1 then
  redis.call("LREM", KEYS[1], 0, ARGV[2])
  redis.call(ARGV[1], KEYS[2], ARGV[2])
  redis.call("PUBLISH", KEYS[4], ARGV[2])
  return 0
else
  return -1
end
