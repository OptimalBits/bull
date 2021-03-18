--[[
    Completely obliterates a queue and all of its content
     Input:

        KEYS[1] meta-paused
        KEYS[2] active
        
        ARGV[1]  cursor
        ARGV[2]  pattern
        ARGV[3]  count
        ARGV[4]  force
]]

-- This command completely destroys a queue including all of its jobs, current or past 
-- leaving no trace of its existence. Since this script needs to iterate to find all the job
-- keys, consider that this call may be slow for very large queues.

-- The queue needs to be "paused" or it will return an error
-- If the queue has currently active jobs then the script by default will return error,
-- however this behaviour can be overrided using the `force` option.

local rcall = redis.call

-- 1) Check if paused, if not return with error.
if rcall("EXISTS", KEYS[1]) ~= 1 then
    return -1 -- Error, NotPaused
end

-- 2) Check if there are active jobs, if there are and not "force" return error.
local activeKey = KEYS[2]
local active = rcall('LRANGE', activeKey, 0, -1)
if (#active > 0) then
    if(ARGV[4] == "") then 
        return -2 -- Error, ExistsActiveJobs
    end
end

local result = rcall("scan", ARGV[1], "MATCH", ARGV[2], "COUNT", ARGV[3])
local cursor = result[1]
local keys = result[2]
for i, key in ipairs(keys) do
    rcall("DEL", key)
end
