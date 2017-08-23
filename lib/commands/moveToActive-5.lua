--[[
  Move next job to be processed to active, lock it and fetch its data. The job
  may be delayed, in that case we need to move it to the delayed set instead.

  This operation guarantees that the worker owns the job during the locks
  expiration time. The worker is responsible of keeping the lock fresh
  so that no other worker picks this job again.

  Input:
      KEYS[1] wait key
      KEYS[2] active key
      KEYS[3] priority key
      KEYS[4] active event key
      KEYS[5] stalled key

      ARGV[1] key prefix
      ARGV[2] lock token
      ARGV[3] lock duration in milliseconds
      ARGV[4] timestamp
      ARGV[5] optional jobid
]]

local jobId
if(ARGV[5] ~= "") then
  jobId = ARGV[5]

  -- clean stalled key
  redis.call("SREM", KEYS[5], jobId)
else
  -- move from wait to active
  jobId = redis.call("RPOPLPUSH", KEYS[1], KEYS[2])
end

if jobId then
  local jobKey = ARGV[1] .. jobId
  local lockKey = jobKey .. ':lock'

  -- get a the lock
  redis.call("SET", lockKey, ARGV[2], "PX", ARGV[3])

  redis.call("ZREM", KEYS[3], jobId) -- remove from priority
  redis.call("PUBLISH", KEYS[4], jobId)
  redis.call("HSET", jobKey, "processedOn", ARGV[4])

  return {redis.call("HGETALL", jobKey), jobId} -- get job data
end
