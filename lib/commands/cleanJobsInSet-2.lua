--[[
  Remove jobs from the specific set.

  Input:
    KEYS[1]  set key,
    KEYS[2]  rate limiter key

    ARGV[1]  jobId
    ARGV[2]  timestamp
    ARGV[3]  limit the number of jobs to be removed. 0 is unlimited
    ARGV[4]  set name, can be any of 'wait', 'active', 'paused', 'delayed', 'completed', or 'failed'
]]
local command = "ZRANGE"
local isList = false
local rcall = redis.call

if ARGV[4] == "wait" or ARGV[4] == "active" or ARGV[4] == "paused" then
  command = "LRANGE"
  isList = true
end

local jobIds = rcall(command, KEYS[1], 0, -1)
local deleted = {}
local deletedCount = 0
local limit = tonumber(ARGV[3])
local jobTS
for _, jobId in ipairs(jobIds) do
  if limit > 0 and deletedCount >= limit then
    break
  end

  local jobKey = ARGV[1] .. jobId
  if (rcall("EXISTS", jobKey .. ":lock") == 0) then
    jobTS = rcall("HGET", jobKey, "timestamp")
    if (not jobTS or jobTS < ARGV[2]) then
      if isList then
        rcall("LREM", KEYS[1], 0, jobId)
      else
        rcall("ZREM", KEYS[1], jobId)
      end
      rcall("DEL", jobKey)
      rcall("DEL", jobKey .. ":logs")

      -- delete keys related to rate limiter
      -- NOTE: this code is unncessary for other sets than wait, paused and delayed.
      local limiterIndexTable = KEYS[2] .. ":index"
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

return deleted
