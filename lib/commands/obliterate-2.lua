--[[
    Completely obliterates a queue and all of its contents
     Input:

        KEYS[1] meta-paused
        KEYS[2] base
        
        ARGV[1]  count
        ARGV[2]  force
]]

-- This command completely destroys a queue including all of its jobs, current or past 
-- leaving no trace of its existence. Since this script needs to iterate to find all the job
-- keys, consider that this call may be slow for very large queues.

-- The queue needs to be "paused" or it will return an error
-- If the queue has currently active jobs then the script by default will return error,
-- however this behaviour can be overrided using the `force` option.
local maxCount = tonumber(ARGV[1])
local count = 0
local baseKey = KEYS[2]

local rcall = redis.call
local function getListItems(keyName)
    return rcall('LRANGE', keyName, 0, -1)
end

local function getZSetItems(keyName)
    return rcall('ZRANGE', keyName, 0, -1)
end

local function getSetItems(keyName)
    return rcall('SMEMBERS', keyName, 0, -1)
end

local function removeKeys(parentKey, keys)
    for i, key in ipairs(keys) do
        if(count > maxCount) then
            return true
        end
        rcall("DEL", baseKey .. key)
        count = count + 1
    end
    rcall("DEL", parentKey)
    return false
end

local function removeLockKeys(keys)
    for i, key in ipairs(keys) do
        if(count > maxCount) then
            return true
        end
        rcall("DEL", baseKey .. key .. ':lock')
        count = count + 1
    end
    return false
end

-- 1) Check if paused, if not return with error.
if rcall("EXISTS", KEYS[1]) ~= 1 then
    return -1 -- Error, NotPaused
end

-- 2) Check if there are active jobs, if there are and not "force" return error.
local activeKey = baseKey .. 'active'
local activeKeys = getListItems(activeKey)
if (#activeKeys > 0) then
    if(ARGV[2] == "") then 
        return -2 -- Error, ExistsActiveJobs
    end
end

if(removeLockKeys(activeKeys)) then
    return 1
end

if(removeKeys(activeKey, activeKeys)) then
    return 1
end

local waitKey = baseKey .. 'paused'
if(removeKeys(waitKey, getListItems(waitKey))) then
    return 1
end

local delayedKey = baseKey .. 'delayed'
if(removeKeys(delayedKey, getZSetItems(delayedKey))) then
    return 1
end

local completedKey = baseKey .. 'completed'
if(removeKeys(completedKey, getZSetItems(completedKey))) then
    return 1
end

local failedKey = baseKey .. 'failed'
if(removeKeys(failedKey, getZSetItems(failedKey))) then
    return 1
end

local waitKey = baseKey .. 'wait'
if(removeKeys(waitKey, getListItems(waitKey))) then
    return 1
end

local waitKey = baseKey .. 'wait'
if(removeKeys(waitKey, getListItems(waitKey))) then
    return 1
end

rcall("DEL", baseKey .. 'priority')
rcall("DEL", baseKey .. 'stalled-check')
rcall("DEL", baseKey .. 'stalled')
rcall("DEL", baseKey .. 'meta-paused')
rcall("DEL", baseKey .. 'meta')
rcall("DEL", baseKey .. 'id')

return 0
