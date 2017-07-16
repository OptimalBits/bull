--[[
  Gets or sets, if none defined, the repeat key next iteration.
  Input: 
    KEYS[1] repeat global key
    
    ARGV[1] repeat job key
    ARGV[2] Date.now()

  Output:
    Milliseconds for next iteration.
]]
local millis = redis.call("ZSCORE", KEYS[1], ARGV[1])

if(millis) then
  return millis;
end

redis.call("ZADD", KEYS[1], ARGV[2], ARGV[1])
return ARGV[2]
