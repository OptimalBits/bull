--[[
  Retries a failed job by moving it back to the wait queue.

    Input:
      KEYS[1] 'active',
      KEYS[2] 'wait'
      KEYS[3] jobId
      KEYS[4] 'meta-paused'
      KEYS[5] 'paused'

      ARGV[1]  pushCmd
      ARGV[2]  jobId
      ARGV[3]  token

    Events:
      'prefix:added'

    Output:
     0  - OK
     -1 - Missing key
     -2 - Job Not locked
]]
local rcall = redis.call
if rcall("EXISTS", KEYS[3]) == 1 then

  -- Check for job lock
  if ARGV[3] ~= "0" then
    local lockKey = KEYS[3] .. ':lock'
    local lock = rcall("GET", lockKey)
    if lock ~= ARGV[3] then
      return -2
    end
  end

  rcall("LREM", KEYS[1], 0, ARGV[2])

  local target
  if rcall("EXISTS", KEYS[4]) ~= 1 then
    target = KEYS[2]
  else
    target = KEYS[5]
  end

  rcall(ARGV[1], target, ARGV[2])

  return 0
else
  return -1
end
