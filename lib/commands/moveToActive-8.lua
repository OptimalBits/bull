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

      -- Rate limiting
      KEYS[6] rate limiter key
      KEYS[7] delayed key

      --
      KEYS[8] drained key

      ARGV[1] key prefix
      ARGV[2] lock token
      ARGV[3] lock duration in milliseconds
      ARGV[4] timestamp
      ARGV[5] optional jobid

      ARGV[6] optional jobs per time unit (rate limiter)
      ARGV[7] optional time unit (rate limiter)
      ARGV[8] optional do not do anything with job if rate limit hit
]]

local jobId
local rcall = redis.call

if(ARGV[5] ~= "") then
  jobId = ARGV[5]

  -- clean stalled key
  rcall("SREM", KEYS[5], jobId)
else
  -- move from wait to active
  jobId = rcall("RPOPLPUSH", KEYS[1], KEYS[2])
end

if jobId then
  -- Check if we need to perform rate limiting.
  local maxJobs = tonumber(ARGV[6])

  if(maxJobs) then
    local rateLimiterKey = KEYS[6];
    -- local jobCounter = tonumber(rcall("GET", rateLimiterKey))
    local jobCounter = tonumber(rcall("INCR", rateLimiterKey))
    local bounceBack = ARGV[8]
    
    -- check if rate limit hit
    if jobCounter > maxJobs then
      if bounceBack == 'false' then
        local exceedingJobs = jobCounter - maxJobs
        local delay = tonumber(rcall("PTTL", rateLimiterKey)) + ((exceedingJobs - 1) * ARGV[7]) / maxJobs
        local timestamp = delay + tonumber(ARGV[4])
        
        -- put job into delayed queue
        rcall("ZADD", KEYS[7], timestamp * 0x1000 + bit.band(jobCounter, 0xfff), jobId)
        rcall("PUBLISH", KEYS[7], timestamp)
      end
      -- remove from active queue
      rcall("LREM", KEYS[2], 1, jobId)
      return
    else
      if jobCounter == 1 then
        rcall("PEXPIRE", rateLimiterKey, ARGV[7])
      end
    end
  end

  local jobKey = ARGV[1] .. jobId
  local lockKey = jobKey .. ':lock'

  -- get a lock
  rcall("SET", lockKey, ARGV[2], "PX", ARGV[3])

  rcall("ZREM", KEYS[3], jobId) -- remove from priority
  rcall("PUBLISH", KEYS[4], jobId)
  rcall("HSET", jobKey, "processedOn", ARGV[4])

  return {rcall("HGETALL", jobKey), jobId} -- get job data
else
  rcall("PUBLISH", KEYS[8], "")
end
