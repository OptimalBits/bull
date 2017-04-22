--[[
  Takes a lock

     Input:
        KEYS[1] 'lock',
      
        ARGV[1]  token
        ARGV[2]  lock duration in milliseconds
      
      Output:
        "OK" if lock extented succesfully.
]]
if redis.call("SET", KEYS[1], ARGV[1], "NX", "PX", ARGV[2]) then
  return 1
else
  return 0
end
