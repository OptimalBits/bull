--[[
  Pauses or resumes a queue globably.

  Note: This code is unnecessary complex, since it was used when we used BRPOPLPUSH. Currently
  only a meta-paused key is necessary.


]]
if redis.call("EXISTS", KEYS[1]) == 1 then
  redis.call("RENAME", KEYS[1], KEYS[2])
end

if ARGV[1] == "paused" then
  redis.call("SET", KEYS[3], 1)
else
  redis.call("DEL", KEYS[3])
end
redis.call("PUBLISH", KEYS[4], ARGV[1])
