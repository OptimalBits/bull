--[[
  Move next job to be processed to active, lock it and fetch its data. The job
  may be delayed, in that case we need to move it to the delayed set instead.

  This operation guarantees that the worker owns the job during the locks
  expiration time. The worker is responsible of keeping the lock fresh
  so that no other worker picks this job again.

  Note: This command only works in non-distributed redis deployments.

  Input:
      KEYS[1] wait key
      KEYS[2] active key
      KEYS[3] priority key
      
      ARGV[1] key prefix
      ARGV[2] lock token
      ARGV[3] lock duration in milliseconds
]]

local jobId = redis.call("LINDEX", KEYS[1], -1)

if jobId then
  local jobKey = ARGV[1] .. jobId
  local lockKey = jobKey .. ':lock'
  
  -- get a the lock
  redis.call("SET", lockKey, ARGV[2], "PX", ARGV[3])
  redis.call("LREM", KEYS[1], 1, jobId) -- remove from wait
  redis.call("ZREM", KEYS[3], jobId) -- remove from priority
  redis.call("LPUSH", KEYS[2], jobId) -- push in active
  
  return {redis.call("HGETALL", jobKey), jobId} -- get job data
end

