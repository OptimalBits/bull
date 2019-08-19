--[[
  get stalled jobs.

    Input:
      KEYS[1] 'stalled' (SET)
      KEYS[2] 'wait',   (LIST)
      KEYS[3] 'active', (LIST)
      KEYS[4] 'failed', (ZSET)
      KEYS[5] 'stalled-check', (KEY)

      KEYS[6] 'meta-paused', (KEY)
      KEYS[7] 'paused', (LIST)

      ARGV[1]  Max stalled job count
      ARGV[2]  queue.toKey('')
      ARGV[3]  timestamp
      ARGV[4]  max check time

]]

local rcall = redis.call

-- Find all stalled jobs
local stalling = rcall('SMEMBERS', KEYS[1])
local stalled = {}
local failed = {}
if(#stalling > 0) then

  rcall('DEL', KEYS[1])

  local MAX_STALLED_JOB_COUNT = tonumber(ARGV[1])

  -- Remove from active list
  for i, jobId in ipairs(stalling) do
    local jobKey = ARGV[2] .. jobId

    -- Check that the lock is also missing, then we can handle this job as really stalled.
    if(rcall("EXISTS", jobKey .. ":lock") == 0) then
      --  Remove from the active queue.
      local removed = rcall("LREM", KEYS[3], 1, jobId)

      if(removed > 0) then
        -- If this job has been stalled too many times, such as if it crashes the worker, then fail it.
        local stalledCount = rcall("HINCRBY", jobKey, "stalledCounter", 1)
        
        if(stalledCount > MAX_STALLED_JOB_COUNT) then
          rcall("ZADD", KEYS[4], ARGV[3], jobId)
          rcall("HSET", jobKey, "failedReason", "job stalled more than allowable limit")
          table.insert(failed, jobId)
        else
          -- Do not Move the job back to the wait queue, so it wouldn't be picked up by a waiting worker.
          table.insert(stalled, jobId)
        end
      end
    end
  end
end

-- Mark potentially stalled jobs
local active = rcall('LRANGE', KEYS[3], 0, -1)
if(#active > 0) then
  rcall('SADD', KEYS[1], unpack(active))
end

return {failed, stalled}
