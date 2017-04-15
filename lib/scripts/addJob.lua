--[[
  Adds a job to the queue by doing the following:
    - Increases the job counter if needed.
    - Creates a new job key with the job data.

    - if delayed:
      - computes timestamp.
      - adds to delayed zset.
      - Emits a global event 'delayed' if the job is delayed.
    - if not delayed
      - Adds the jobId to the wait/paused list in one of three ways:
         - LIFO
         - FIFO
         - prioritized.
         - Emits a global event 'waiting' if not paused.

    Input:
      KEYS[1] 'wait',
      KEYS[2] 'paused'
      KEYS[3] 'meta-paused'
      KEYS[4] 'added'
      KEYS[5] 'id'
      KEYS[6] 'delayed'
      KEYS[7] 'priority'

      ARGV[1]  key prefix,
      ARGV[2]  custom id (will not generate one automatically)
      ARGV[3]  name
      ARGV[4]  data (json stringified job data)
      ARGV[5]  opts (json stringified job opts)
      ARGV[6]  timestamp
      ARGV[7]  delay
      ARGV[8]  delayedTimestamp
      ARGV[9]  priority
      ARGV[10] LIFO

    Events:
      'waiting'
]]
local jobCounter = redis.call("INCR", KEYS[5])
local jobId
if ARGV[2] == "" then 
  jobId = jobCounter 
else
  jobId = ARGV[2]
end

local jobIdKey = ARGV[1] .. jobId
if redis.call("EXISTS", jobIdKey) == 1 then
  return jobId .. "" -- convert to string
end

-- Store the job.
redis.call("HMSET", jobIdKey, "name", ARGV[3], "data", ARGV[4], "opts", ARGV[5], "timestamp", ARGV[6], "delay", ARGV[7])

-- Check if job is delayed
if(ARGV[8] ~= "0") then
  local timestamp = tonumber(ARGV[8]) * 0x1000 + bit.band(jobCounter, 0xfff)
  redis.call("ZADD", KEYS[6], timestamp, jobId)
  redis.call("PUBLISH", KEYS[6], (timestamp / 0x1000))
  return jobId .. "" -- convert to string
else  
  local direction
  local target

  if ARGV[10] == "LIFO" then 
    direction = "RPUSH"
  else 
    direction = "LPUSH"
  end

  -- Whe check for the meta-paused key to decide if we are paused or not
  -- (since an empty list and !EXISTS are not really the same)
  if redis.call("EXISTS", KEYS[3]) ~= 1 then
    target = KEYS[1]
  else
    target = KEYS[2]
  end

  if ARGV[9] == "0" then
    -- Standard add
    redis.call(direction, target, jobId)
  else
    -- Priority add
    redis.call("ZADD", KEYS[7], ARGV[9], jobId)
    local count = redis.call("ZCOUNT", KEYS[7], 0, ARGV[9])

    local len = redis.call("LLEN", target)
    local id = redis.call("LINDEX", target, len - (count-1))
    if id then
      redis.call("LINSERT", target, "BEFORE", id, jobId)
    else
      redis.call("RPUSH", target, jobId)
    end
  end

  redis.call("PUBLISH", KEYS[4], jobId)
  return jobId .. "" -- convert to string
end
