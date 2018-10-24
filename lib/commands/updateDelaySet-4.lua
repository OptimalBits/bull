--[[
  Updates the delay set, by picking a delayed job that should
  be processed now.

     Input:
      KEYS[1] 'delayed'
      KEYS[2] 'active'
      KEYS[3] 'wait'
      KEYS[4] 'priority'

      ARGV[1]  queue.toKey('')
      ARGV[2]  delayed timestamp
      ARGV[3]  queue token

     Events:
      'removed'
]]
local MAX_BATCH_SIZE = 100;
local rcall = redis.call;

local dequeued_jobs = 0
while true do
  local RESULT = rcall("ZRANGE", KEYS[1], 0, 0, "WITHSCORES")
  local jobId = RESULT[1]
  local score = RESULT[2]
  if (score ~= nil) then
    score = score / 0x1000
    if (dequeued_jobs == MAX_BATCH_SIZE) then
      return score
    end

    if (math.floor(score) <= tonumber(ARGV[2])) then
      rcall("ZREM", KEYS[1], jobId)
      rcall("LREM", KEYS[2], 0, jobId)

      local priority = tonumber(rcall("HGET", ARGV[1] .. jobId, "priority")) or 0

      if priority == 0 then
        -- LIFO or FIFO
        rcall("LPUSH", KEYS[3], jobId)
      else
        -- Priority add
        rcall("ZADD", KEYS[4], priority, jobId)
        local count = rcall("ZCOUNT", KEYS[4], 0, priority)

        local len = rcall("LLEN", KEYS[3])
        local id = rcall("LINDEX", KEYS[3], len - (count-1))
        if id then
          rcall("LINSERT", KEYS[3], "BEFORE", id, jobId)
        else
          rcall("RPUSH", KEYS[3], jobId)
        end
      end

      dequeued_jobs = dequeued_jobs + 1
      -- Emit waiting event (wait..ing@token)
      rcall("PUBLISH", KEYS[3] .. "ing@" .. ARGV[3], jobId)

      rcall("HSET", ARGV[1] .. jobId, "delay", 0)
    else
      -- nothing to dequeue
      return score
    end
  else
    -- the queue is empty
    break
  end
end
