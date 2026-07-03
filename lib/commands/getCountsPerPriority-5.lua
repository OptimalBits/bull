--[[
  Get counts per provided states

    Input:
      KEYS[1] wait key
      KEYS[2] paused key
      KEYS[3] meta-paused key
      KEYS[4] priority key (legacy; jobs added before the prioritized zset
        existed are still counted from here, so this stays load-bearing
        until such jobs have fully drained)
      KEYS[5] prioritized key

      ARGV[1...] priorities
]]
local rcall = redis.call
local results = {}
local legacyPriorityKey = KEYS[4]
local prioritizedKey = KEYS[5]

-- Score = priority * PRIORITY_COUNTER_BASE + counter (see addJobWithPriority.lua)
local PRIORITY_COUNTER_BASE = 4294967296

-- Includes
--- @include "includes/getTargetQueueList"

for i = 1, #ARGV do
  local priority = tonumber(ARGV[i])
  if priority == 0 then
    local target = getTargetQueueList(KEYS[3], KEYS[1], KEYS[2])
    local count = rcall("LLEN", target) - rcall("ZCARD", legacyPriorityKey)
    if count < 0 then
      -- considering when last waiting job is moved to active before
      -- removing priority reference
      results[#results+1] = 0
    else
      results[#results+1] = count
    end
  else
    local scoreStart = priority * PRIORITY_COUNTER_BASE
    local scoreEnd = scoreStart + PRIORITY_COUNTER_BASE - 1
    results[#results+1] = rcall("ZCOUNT", legacyPriorityKey, priority, priority) +
      rcall("ZCOUNT", prioritizedKey, scoreStart, scoreEnd)
  end
end

return results
