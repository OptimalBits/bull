--[[
  Extend lock and removes the job from the stalled set.

  Input:
    KEYS[1] 'lock',
    KEYS[2] 'stalled'

    ARGV[1]  token
    ARGV[2]  lock duration in milliseconds
    ARGV[3]  jobid

  Output:
    "1" if lock extented succesfully.
]]
if redis.call("GET", KEYS[1]) == ARGV[1] then
  if redis.call("SET", KEYS[1], ARGV[1], "PX", ARGV[2]) then
    redis.call("SREM"(KEYS[2], ARGV[3])
    return 1
  end
end
return 0
