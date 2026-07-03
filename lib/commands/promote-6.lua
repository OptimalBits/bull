--[[
  Promotes a job that is currently "delayed" to the "waiting" state

     Input:
      KEYS[1] 'delayed'
      KEYS[2] 'wait'
      KEYS[3] 'paused'
      KEYS[4] 'meta-paused'
      KEYS[5] 'prioritized'
      KEYS[6] 'marker'

      ARGV[1]  queue.toKey('')
      ARGV[2]  jobId
      ARGV[3]  queue token

     Events:
      'waiting'
]]
local rcall = redis.call;
local jobId = ARGV[2]

-- Includes
--- @include "includes/addBaseMarkerIfNeeded"
--- @include "includes/addJobWithPriority"
--- @include "includes/getTargetQueueList"

if rcall("ZREM", KEYS[1], jobId) == 1 then
  local jobKey = ARGV[1] .. jobId
  local priority = tonumber(rcall("HGET", jobKey, "priority")) or 0

  local target, paused = getTargetQueueList(KEYS[4], KEYS[2], KEYS[3])

  if priority == 0 then
    -- LIFO or FIFO
    rcall("LPUSH", target, jobId)
  else
    local counter = tonumber(rcall("HGET", jobKey, "pc")) or 0
    addJobWithPriority(KEYS[5], priority, counter, jobId)
  end

  addBaseMarkerIfNeeded(KEYS[6], paused)

  -- Emit waiting event (wait..ing@token)
  rcall("PUBLISH", KEYS[2] .. "ing@" .. ARGV[3], jobId)

  rcall("HSET", ARGV[1] .. jobId, "delay", 0)

  return 0
else
  return -1
end
