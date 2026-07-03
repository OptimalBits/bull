--[[
  Attempts to retry all failed jobs

  Input:
    KEYS[1] base key
    KEYS[2] failed state key
    KEYS[3] wait state key
    KEYS[4] 'meta-paused'
    KEYS[5] 'paused'
    KEYS[6] 'marker'
    KEYS[7] 'prioritized'

    ARGV[1]  count

  Output:
    1  means the operation is not completed
    0  means the operation is completed
]]
local baseKey = KEYS[1]
local maxCount = tonumber(ARGV[1])

local rcall = redis.call;

-- Includes
--- @include "includes/addBaseMarkerIfNeeded"
--- @include "includes/addJobWithPriority"
--- @include "includes/batches"

local function getZSetItems(keyName, max)
    return rcall('ZRANGE', keyName, 0, max - 1)
end

local jobs = getZSetItems(KEYS[2], maxCount)

if (#jobs > 0) then
    for i, key in ipairs(jobs) do
        local jobKey = baseKey .. key
        rcall("HDEL", jobKey, "finishedOn", "processedOn", "failedReason")
    end

    local target
    local paused = rcall("EXISTS", KEYS[4]) == 1
    if not paused then
        target = KEYS[3]
    else
        target = KEYS[5]
    end

    for from, to in batches(#jobs, 7000) do
        rcall("ZREM", KEYS[2], unpack(jobs, from, to))
        for i = from, to do
            local jobId = jobs[i]
            local jobKey = baseKey .. jobId
            local priority = tonumber(rcall("HGET", jobKey, "priority")) or 0
            if priority == 0 then
                rcall("LPUSH", target, jobId)
            else
                local counter = tonumber(rcall("HGET", jobKey, "pc")) or 0
                addJobWithPriority(KEYS[7], priority, counter, jobId)
            end
            addBaseMarkerIfNeeded(KEYS[6], paused)
        end
    end
end

maxCount = maxCount - #jobs

if (maxCount <= 0) then return 1 end

return 0
