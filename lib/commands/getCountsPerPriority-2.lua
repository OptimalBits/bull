--[[
  Get counts per provided states

    Input:
      KEYS[1] wait key
      KEYS[2] priority key

      ARGV[1...] priorities
]]
local rcall = redis.call
local results = {}
local waitKey = KEYS[1]
local prioritizedKey = KEYS[2]

for i = 1, #ARGV do
  local priority = tonumber(ARGV[i])
  if priority == 0 then
    results[#results+1] = rcall("LLEN", waitKey) - rcall("ZCARD", prioritizedKey)
  else
    results[#results+1] = rcall("ZCOUNT", prioritizedKey,
      priority, priority)
  end
end

return results
