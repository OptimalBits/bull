--[[
    Looks for unlocked jobs in the active queue. This happens when if the job was being worked on,
    but the worker process died and it failed to renew the lock.
    We call these jobs 'stalled'. We resolve these by moving them back to wait to be re-processed.
    To prevent jobs from cycling endlessly between active and wait,
    (e.g. if the job handler keeps crashing), we limit the number stalled job recoveries to MAX_STALLED_JOB_COUNT.

    Input:
      KEYS[1] 'active',
      KEYS[2] 'wait',
      KEYS[3] 'failed'
      KEYS[4] 'meta-paused'
      KEYS[5] 'paused'
      KEYS[6] 'unlocked-check'

      ARGV[1]  Max stalled job count
      ARGV[2]  queue.toKey('')
      ARGV[3]  timestamp
      ARGV[4]  max check time
]]

-- Check if we need to check for stalled jobs now.
if redis.call("EXISTS", KEYS[6]) == 1 then
  return {{}, {}}
end

redis.call("SET", KEYS[6], ARGV[3], "PX", ARGV[4])

local MAX_STALLED_JOB_COUNT = tonumber(ARGV[1])
local activeJobs = redis.call("LRANGE", KEYS[1], 0, -1)
local stalled = {}
local failed = {}
local dst

-- wait or paused destination
if redis.call("EXISTS", KEYS[4]) ~= 1 then
  dst = KEYS[2]
else
  dst = KEYS[5]
end
local dstAdded = dst .. ":added"

for _, job in ipairs(activeJobs) do

  local jobKey = ARGV[2] .. job
  if(redis.call("EXISTS", jobKey .. ":lock") == 0) then
    --  Remove from the active queue.
    redis.call("LREM", KEYS[1], 1, job)

    -- If it was previously locked then we consider it 'stalled' (Case A above). If this job
    -- has been stalled too many times, such as if it crashes the worker, then fail it.
    local stalledCount = redis.call("HINCRBY", jobKey, "stalledCounter", 1)
    if(stalledCount > MAX_STALLED_JOB_COUNT) then
      redis.call("ZADD", KEYS[3], ARGV[3], job)
      redis.call("HSET", jobKey, "failedReason", "job stalled more than allowable limit")
      table.insert(failed, job)
    else
      -- Move the job back to the wait queue, to immediately be picked up by a waiting worker.
      redis.call("RPUSH", dst, job)
      redis.call("RPUSH", dstAdded, job)

      table.insert(stalled, job)
    end
  end
end

-- Push lost jobs into the :added list (in case a job was popped from the list but did not make it to the active list,
-- very unlikely but a possible hazard)
local diff = redis.call("LLEN", dst) - redis.call("LLEN", dstAdded)
if diff > 0 then
  local res = redis.call( 'LRANGE', dst, 0, diff );
  redis.call("RPUSH", dstAdded, unpack(res) );
end

return {failed, stalled}
