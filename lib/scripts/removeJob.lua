--[[
  Move job from active to a finished status (completed o failed)
  A job can only be moved to completed if it was active.

     Input:
      KEYS[1] 'active',
      KEYS[2] 'wait',
      KEYS[3] 'delayed',
      KEYS[4] 'paused',
      KEYS[5] 'completed',
      KEYS[6] 'failed',
      KEYS[7] jobId

      ARGV[1]  jobId
    
     Events:
      'removed'
]]

redis.call("LREM", KEYS[1], 0, ARGV[1])
redis.call("LREM", KEYS[2], 0, ARGV[1])
redis.call("ZREM", KEYS[3], ARGV[1])
redis.call("LREM", KEYS[4], 0, ARGV[1])
redis.call("ZREM", KEYS[5], ARGV[1])
redis.call("ZREM", KEYS[6], ARGV[1])
redis.call("DEL", KEYS[7])
