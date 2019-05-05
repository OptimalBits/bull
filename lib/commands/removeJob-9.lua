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

      ARGV[1]  jobId
      ARGV[2]  lock token

     Events:
      'removed'
]]

-- TODO PUBLISH global event 'removed'

local lockKey = KEYS[8] .. ':lock'
local lock = redis.call("GET", lockKey)
if not lock then             -- or (lock == ARGV[2])) then
  redis.call("LREM", KEYS[1], 0, ARGV[1])
  redis.call("LREM", KEYS[2], 0, ARGV[1])
  redis.call("ZREM", KEYS[3], ARGV[1])
  redis.call("LREM", KEYS[4], 0, ARGV[1])
  redis.call("ZREM", KEYS[5], ARGV[1])
  redis.call("ZREM", KEYS[6], ARGV[1])
  redis.call("ZREM", KEYS[7], ARGV[1])
  redis.call("DEL", KEYS[8])
  redis.call("DEL", KEYS[9])
  return 1
else
  return 0
end
