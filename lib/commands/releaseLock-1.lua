--[[
  Release lock

     Input:
        KEYS[1] 'lock',
      
        ARGV[1]  token
        ARGV[2]  lock duration in milliseconds
      
      Output:
        "OK" if lock extented succesfully.
]]
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
