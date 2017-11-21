
--[[
  Removes a repeatable job
  Input:
    KEYS[1] repeat jobs key
    KEYS[2] delayed jobs key

    ARGV[1] repeat job id
    ARGV[2] repeat job key
]]
redis.replicate_commands()

local millis = redis.call("ZSCORE", KEYS[1], ARGV[2])

if(millis) then
  -- Delete next programmed job.
  local repeatJobId = ARGV[1] .. millis
  redis.call("ZREM", KEYS[2], repeatJobId);
end

redis.call("ZREM", KEYS[1], ARGV[2]);
