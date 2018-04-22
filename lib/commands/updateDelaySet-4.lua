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

     Events:
      'removed'
]]
local RESULT = redis.call("ZRANGE", KEYS[1], 0, 0, "WITHSCORES")
local jobId = RESULT[1]
local score = RESULT[2]
if (score ~= nil) then
  score = score / 0x1000
  if (math.floor(score) <= tonumber(ARGV[2])) then
    redis.call("ZREM", KEYS[1], jobId)
    redis.call("LREM", KEYS[2], 0, jobId)

    local priority = tonumber(redis.call("HGET", ARGV[1] .. jobId, "priority")) or 0

    if priority == 0 then
      -- LIFO or FIFO
      redis.call("LPUSH", KEYS[3], jobId)
    else
      -- Priority add
      redis.call("ZADD", KEYS[4], priority, jobId)
      local count = redis.call("ZCOUNT", KEYS[4], 0, priority)

      local len = redis.call("LLEN", KEYS[3])
      local id = redis.call("LINDEX", KEYS[3], len - (count-1))
      if id then
        redis.call("LINSERT", KEYS[3], "BEFORE", id, jobId)
      else
        redis.call("RPUSH", KEYS[3], jobId)
      end

    end

    redis.call("HSET", ARGV[1] .. jobId, "delay", 0)
    local nextTimestamp = redis.call("ZRANGE", KEYS[1], 0, 0, "WITHSCORES")[2]
    if(nextTimestamp ~= nil) then
      nextTimestamp = nextTimestamp / 0x1000
      redis.call("PUBLISH", KEYS[1], nextTimestamp)
    end
    return nextTimestamp
  end
  return score
end
