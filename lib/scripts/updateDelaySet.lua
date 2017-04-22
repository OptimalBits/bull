--[[
  Updates the delay set
  
     Input:
      KEYS[1] 'delayed'
      KEYS[2] 'active'
      KEYS[3] 'wait'
      KEYS[4] 'jobs' event channel

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
  if (score <= tonumber(ARGV[2])) then
    redis.call("ZREM", KEYS[1], jobId)
    redis.call("LREM", KEYS[2], 0, jobId)
    redis.call("LPUSH", KEYS[3], jobId)
    redis.call("PUBLISH", KEYS[4], jobId)
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
