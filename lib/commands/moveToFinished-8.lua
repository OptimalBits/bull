--[[
  Move job from active to a finished status (completed o failed)
  A job can only be moved to completed if it was active.
  The job must be locked before it can be moved to a finished status,
  and the lock must be released in this script.

     Input:
      KEYS[1] active key
      KEYS[2] completed/failed key
      KEYS[3] jobId key
      KEYS[4] wait key
      KEYS[5] priority key
      KEYS[6] active event key
      KEYS[7] delayed key
      KEYS[8] rateLimiterKey

      ARGV[1]  jobId
      ARGV[2]  timestamp
      ARGV[3]  msg property
      ARGV[4]  return value / failed reason
      ARGV[5]  token
      ARGV[6]  shouldRemove
      ARGV[7]  event data (? maybe just send jobid).
      ARGV[8]  should fetch next job
      ARGV[9]  base key

      ARGV[10] lock duration
      ARGV[11] token

      ARGV[12] optional jobs per time unit (rate limiter)
      ARGV[13] optional time unit (rate limiter)
      ARGV[14] optional do not do anything with job if rate limit hit
      ARGV[15] optional rate limit by key

     Output:
      0 OK
      -1 Missing key.
      -2 Missing lock.

     Events:
      'completed/failed'
]]
local rcall = redis.call

-- This is copy/paste from moveToActive since we cannot call functions from other scripts.
local rateLimit = function(activeKey, rateLimiterKey, delayedKey, jobId, timestamp, maxJobs, timeUnit, bounceBack, groupLimit)
  local limiterIndexTable = rateLimiterKey .. ":index"

  -- Rate limit by group?
  if(groupLimit) then
    local group = string.match(jobId, "[^:]+$")
    if group ~= nil then
      rateLimiterKey = rateLimiterKey .. ":" .. group
    end
  end

  -- key for storing rate limited jobs
  -- When a job has been previously rate limited it should be part of this set
  -- if the job is back here means that the delay time for this job has passed and now we should
  -- be able to process it again.
  local limitedSetKey = rateLimiterKey .. ":limited"
  local delay = 0

  -- -- Check if job was already limited
  local isLimited = rcall("SISMEMBER", limitedSetKey, jobId);

  if isLimited == 1 then
     -- Remove from limited zset since we are going to try to process it
     rcall("SREM", limitedSetKey, jobId)
     rcall("HDEL", limiterIndexTable, jobId)
  else
    -- If not, check if there are any limited jobs
    -- If the job has not been rate limited, we should check if there are any other rate limited jobs, because if that
    -- is the case we do not want to process this job, just calculate a delay for it and put it to "sleep".
    local numLimitedJobs = rcall("SCARD", limitedSetKey)

    if numLimitedJobs > 0 then
      -- Note, add some slack to compensate for drift.
      delay = ((numLimitedJobs * timeUnit * 1.1) /  maxJobs) + tonumber(rcall("PTTL", rateLimiterKey))
    end
  end

  local jobCounter = tonumber(rcall("GET", rateLimiterKey))
  if(jobCounter == nil) then
    jobCounter = 0
  end
  -- check if rate limit hit
  if (delay == 0) and (jobCounter >= maxJobs) then
    -- Seems like there are no current rated limited jobs, but the jobCounter has exceeded the number of jobs for
    -- this unit of time so we need to rate limit this job.
    local exceedingJobs = jobCounter - maxJobs
    delay = tonumber(rcall("PTTL", rateLimiterKey)) + ((exceedingJobs) * timeUnit) / maxJobs
  end

  if delay > 0 then
    if bounceBack == 'false' then
      local timestamp = delay + tonumber(timestamp)
      -- put job into delayed queue
      rcall("ZADD", delayedKey, timestamp * 0x1000 + bit.band(jobCounter, 0xfff), jobId)
      rcall("PUBLISH", delayedKey, timestamp)
      rcall("SADD", limitedSetKey, jobId)

      -- store index so that we can delete rate limited data
      rcall("HSET", limiterIndexTable, jobId, limitedSetKey)
    end

    -- remove from active queue
    rcall("LREM", activeKey, 1, jobId)
    return true
  else
    -- false indicates not rate limited
    -- increment jobCounter only when a job is not rate limited
    if (jobCounter == 0) then
      rcall("PSETEX", rateLimiterKey, timeUnit, 1)
    else
      rcall("INCR", rateLimiterKey)
    end
    return false
  end
end


if rcall("EXISTS", KEYS[3]) == 1 then -- // Make sure job exists
  if ARGV[5] ~= "0" then
    local lockKey = KEYS[3] .. ':lock'
    if rcall("GET", lockKey) == ARGV[5] then
      rcall("DEL", lockKey)
    else
      return -2
    end
  end

  -- Remove from active list
  rcall("LREM", KEYS[1], -1, ARGV[1])

  -- Remove job?
  local removeJobs = tonumber(ARGV[6])
  if removeJobs ~= 1 then
    -- Add to complete/failed set
    rcall("ZADD", KEYS[2], ARGV[2], ARGV[1])
    rcall("HMSET", KEYS[3], ARGV[3], ARGV[4], "finishedOn", ARGV[2]) -- "returnvalue" / "failedReason" and "finishedOn"

    -- Remove old jobs?
    if removeJobs and removeJobs > 1 then
      local start = removeJobs - 1
      local jobIds = rcall("ZREVRANGE", KEYS[2], start, -1)
      for i, jobId in ipairs(jobIds) do
        local jobKey = ARGV[9] .. jobId
        local jobLogKey = jobKey .. ':logs'
        rcall("DEL", jobKey, jobLogKey)
      end
      rcall("ZREMRANGEBYRANK", KEYS[2], 0, -removeJobs);
    end
  else
    local jobLogKey = KEYS[3] .. ':logs'
    rcall("DEL", KEYS[3], jobLogKey)
  end

  rcall("PUBLISH", KEYS[2], ARGV[7])

  -- Try to get next job to avoid an extra roundtrip if the queue is not closing, 
  -- and not rate limited.
  if(ARGV[8] == "1") then
    local jobId
    -- Check if there are delayed jobs that can be picked up next.
    jobId = rcall("ZRANGEBYSCORE", KEYS[7], 0, tonumber(ARGV[2]) * 0x1000, "LIMIT", 0, 1)[1]
    if jobId then
      -- move from delayed to active
      rcall("ZREM", KEYS[7], jobId)
      rcall("LPUSH", KEYS[1], jobId)
    else
      -- move from wait to active 
      jobId = rcall("RPOPLPUSH", KEYS[4], KEYS[1])
    end

    if jobId then

      -- Check if we need to perform rate limiting.
      -- local maxJobs = tonumber(ARGV[12])

      -- if maxJobs then
      --   local rateLimit = function(activeKey, rateLimiterKey, delayedKey, jobId, timestamp, maxJobs, timeUnit, bounceBack, groupLimit)

      --   if rateLimit(KEYS[1], KEYS[8], KEYS[7], jobId, ARGV[2], maxJobs, ARGV[13], ARGV[14], ARGV[15]) then
      --     return 0
      --   end
      -- end

      local jobKey = ARGV[9] .. jobId
      local lockKey = jobKey .. ':lock'

      -- get a lock
      rcall("SET", lockKey, ARGV[11], "PX", ARGV[10])

      rcall("ZREM", KEYS[5], jobId) -- remove from priority
      rcall("PUBLISH", KEYS[6], jobId)
      rcall("HSET", jobKey, "processedOn", ARGV[2]) 

      return {rcall("HGETALL", jobKey), jobId} -- get job data
    end
  end

  return 0
else
  return -1
end
