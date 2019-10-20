--[[
  Remove jobs from the specific set.

  Input:
    KEYS[1]  set key,

    ARGV[1]  jobId
    ARGV[2]  timestamp
    ARGV[3]  limit the number of jobs to be removed. 0 is unlimited
    ARGV[4]  set name, can be any of 'wait', 'active', 'paused', 'delayed', 'completed', or 'failed'
]]
local command = "ZRANGE"
local isList = false

if ARGV[4] == "wait" or ARGV[4] == "active" or ARGV[4] == "paused" then
  command = "LRANGE"
  isList = true
end

local jobs = redis.call(command, KEYS[1], 0, -1)
local deleted = {}
local deletedCount = 0
local limit = tonumber(ARGV[3])
local jobTS
for _, job in ipairs(jobs) do
  if limit > 0 and deletedCount >= limit then
    break
  end

  local jobKey = ARGV[1] .. job
  if (redis.call("EXISTS", jobKey .. ":lock") == 0) then
    jobTS = redis.call("HGET", jobKey, "timestamp")
    if (not jobTS or jobTS < ARGV[2]) then
      if isList then
        redis.call("LREM", KEYS[1], 0, job)
      else
        redis.call("ZREM", KEYS[1], job)
      end
      redis.call("DEL", jobKey)
      deletedCount = deletedCount + 1
      table.insert(deleted, job)
    end
  end
end

return deleted
