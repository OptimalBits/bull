--[[
  Move stalled jobs to wait.

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

    Events:
      'stalled' with stalled job ids.
]]

-- Check if we need to check for stalled jobs now.
if redis.call("EXISTS", KEYS[5]) == 1 then
  return {{}, {}}
end

redis.call("SET", KEYS[5], ARGV[3], "PX", ARGV[4])

-- Move all stalled jobs to wait
local stalling = redis.call('SMEMBERS', KEYS[1])
local stalled = {}
local failed = {}
if(#stalling > 0) then

  local dst
  -- wait or paused destination
  if redis.call("EXISTS", KEYS[6]) ~= 1 then
    dst = KEYS[2]
  else
    dst = KEYS[7]
  end

  redis.call('DEL', KEYS[1])

  local MAX_STALLED_JOB_COUNT = tonumber(ARGV[1])

  -- Remove from active list
  for i, jobId in ipairs(stalling) do
    local jobKey = ARGV[2] .. jobId

    -- Check that the lock is also missing, then we can handle this job as really stalled.
    if(redis.call("EXISTS", jobKey .. ":lock") == 0) then
      --  Remove from the active queue.
      local removed = redis.call("LREM", KEYS[3], 1, jobId)

      -- If this job has been stalled too many times, such as if it crashes the worker, then fail it.
      local stalledCount = redis.call("HINCRBY", jobKey, "stalledCounter", 1)
      if(stalledCount > MAX_STALLED_JOB_COUNT) then
        redis.call("ZADD", KEYS[4], ARGV[3], job)
        redis.call("HSET", jobKey, "failedReason", "job stalled more than allowable limit")
        table.insert(failed, jobId)
      else
        -- Move the job back to the wait queue, to immediately be picked up by a waiting worker.
        redis.call("RPUSH", dst, jobId)

        -- TODO: Publish a global stalled event.
        -- redis.call('PUBLISH', KEYS[1], stalled);
        table.insert(stalled, jobId)
      end
    end
  end
end

-- Mark potentially stalled jobs
local active = redis.call('LRANGE', KEYS[3], 0, -1)
if(#active > 0) then
  redis.call('SADD', KEYS[1], unpack(active))
end

return {failed, stalled}
