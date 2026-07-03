--[[
  Function to add job considering priority.
]]

-- Score = priority * PRIORITY_COUNTER_BASE + (counter % PRIORITY_COUNTER_BASE),
-- so higher priority always sorts above any counter difference within a
-- lower priority, while jobs of equal priority stay ordered by creation
-- counter (FIFO). PRIORITY_COUNTER_BASE is 2^32 and MAX_PRIORITY is 2^21 - 1
-- so that the largest possible score stays within the 2^53 exact-integer
-- range of a double.
local PRIORITY_COUNTER_BASE = 4294967296
local MAX_PRIORITY = 2097151

-- The counter passed in here is the queue's shared job-creation counter
-- (the 'id' key), not a counter dedicated to priority ordering. Its value
-- is taken modulo PRIORITY_COUNTER_BASE (2^32), so once a queue has had
-- more than 2^32 jobs added to it over its lifetime, the counter wraps and
-- FIFO tie-break order among same-priority jobs can no longer be trusted
-- to reflect true creation order. This is an accepted, soft limitation.

local function addJobWithPriority(prioritizedKey, priority, counter, jobId)
  assert(priority <= MAX_PRIORITY, "Priority must be between 0 and " .. MAX_PRIORITY)
  local score = priority * PRIORITY_COUNTER_BASE + (counter % PRIORITY_COUNTER_BASE)
  rcall("ZADD", prioritizedKey, score, jobId)
end
