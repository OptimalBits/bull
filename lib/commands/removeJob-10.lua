--[[
    Remove a job from all the queues it may be in as well as all its data.
    In order to be able to remove a job, it must be unlocked.

     Input:
      KEYS[1] 'active',
      KEYS[2] 'wait',
      KEYS[3] 'delayed',
      KEYS[4] 'paused',
      KEYS[5] 'completed',
      KEYS[6] 'failed',
      KEYS[7] 'priority',
      KEYS[8] jobId
      KEYS[9] job logs
      KEYS[10] rate limiter index table

      ARGV[1]  jobId
      ARGV[2]  lock token

     Events:
      'removed'
]]

-- TODO PUBLISH global event 'removed'

local rcall = redis.call
local lockKey = KEYS[8] .. ':lock'
local lock = redis.call("GET", lockKey)
if not lock then             -- or (lock == ARGV[2])) then
  local jobId = ARGV[1]
  rcall("LREM", KEYS[1], 0, jobId)
  rcall("LREM", KEYS[2], 0, jobId)
  rcall("ZREM", KEYS[3], jobId)
  rcall("LREM", KEYS[4], 0, jobId)
  rcall("ZREM", KEYS[5], jobId)
  rcall("ZREM", KEYS[6], jobId)
  rcall("ZREM", KEYS[7], jobId)
  rcall("DEL", KEYS[8])
  rcall("DEL", KEYS[9])

  -- delete keys related to rate limiter
  local limiterIndexTable = KEYS[10] .. ":index"
  local limitedSetKey = rcall("HGET", limiterIndexTable, jobId)
  if limitedSetKey then
    rcall("SREM", limitedSetKey, jobId)
    rcall("HDEL", limiterIndexTable, jobId)
  end
  return 1
else
  return 0
end
