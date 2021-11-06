--[[
  Remove jobs from the specific set.

  Input:
    KEYS[1]  set key,
    KEYS[2]  priority key
    KEYS[3]  rate limiter key

    ARGV[1]  jobId
    ARGV[2]  timestamp
    ARGV[3]  limit the number of jobs to be removed. 0 is unlimited
    ARGV[4]  set name, can be any of 'wait', 'active', 'paused', 'delayed', 'completed', or 'failed'
]]

local setKey = KEYS[1]
local priorityKey = KEYS[2]
local rateLimiterKey = KEYS[3]

local jobKeyPrefix = ARGV[1]
local maxTimestamp = ARGV[2]
local limitStr = ARGV[3]
local setName = ARGV[4]

local command = "ZRANGE"
local isList = false
local rcall = redis.call

if setName == "wait" or setName == "active" or setName == "paused" then
  command = "LRANGE"
  isList = true
end

local limit = tonumber(limitStr)
local rangeStart = 0
local rangeEnd = -1

-- If we're only deleting _n_ items, avoid retrieving all items
-- for faster performance
--
-- Start from the tail of the list, since that's where oldest elements
-- are generally added for FIFO lists
if limit > 0 then
  rangeStart = -1 - limit + 1
  rangeEnd = -1
end

local jobIds = rcall(command, setKey, rangeStart, rangeEnd)
local deleted = {}
local deletedCount = 0
local jobTS

-- Run this loop:
-- - Once, if limit is -1 or 0
-- - As many times as needed if limit is positive
while ((limit <= 0 or deletedCount < limit) and next(jobIds, nil) ~= nil) do
  for _, jobId in ipairs(jobIds) do
    if limit > 0 and deletedCount >= limit then
      break
    end

    local jobKey = jobKeyPrefix .. jobId
    if (rcall("EXISTS", jobKey .. ":lock") == 0) then
      jobTS = rcall("HGET", jobKey, "timestamp")
      if (not jobTS or jobTS < maxTimestamp) then
        if isList then
          rcall("LREM", setKey, 0, jobId)
        else
          rcall("ZREM", setKey, jobId)
        end
        rcall("ZREM", priorityKey, jobId)
        rcall("DEL", jobKey)
        rcall("DEL", jobKey .. ":logs")

        -- delete keys related to rate limiter
        -- NOTE: this code is unncessary for other sets than wait, paused and delayed.
        local limiterIndexTable = rateLimiterKey .. ":index"
        local limitedSetKey = rcall("HGET", limiterIndexTable, jobId)

        if limitedSetKey then
          rcall("SREM", limitedSetKey, jobId)
          rcall("HDEL", limiterIndexTable, jobId)
        end

        deletedCount = deletedCount + 1
        table.insert(deleted, jobId)
      end
    end
  end

  -- If we didn't have a limit, return immediately. We should have deleted
  -- all the jobs we can
  if limit <= 0 then
    break
  end

  if deletedCount < limit then
    -- We didn't delete enough. Look for more to delete
    rangeStart = rangeStart - limit
    rangeEnd = rangeEnd - limit
    jobIds = rcall(command, setKey, rangeStart, rangeEnd)
  end
end

return deleted
