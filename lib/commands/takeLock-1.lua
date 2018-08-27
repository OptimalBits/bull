--[[
  Takes a lock

     Input:
        KEYS[1] 'lock',

        ARGV[1]  token
        ARGV[2]  lock duration in milliseconds
        ARGV[3]  force

      Output:
        "OK" if lock extented succesfully.
]]
if ARGV[3] == "1" then
    if redis.call("SET", KEYS[1], ARGV[1], "PX", ARGV[2]) then
        return 1
    else
      return 0
    end
end

if redis.call("SET", KEYS[1], ARGV[1], "NX", "PX", ARGV[2]) then
  return 1
else
  return 0
end
