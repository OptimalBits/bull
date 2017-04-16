--[[ 
  Looks for unlocked jobs in the active queue. There are two circumstances in which a job
   would be in 'active' but NOT have a job lock:
   
     Case A) The job was being worked on, but the worker process died and it failed to renew the lock.
       We call these jobs 'stalled'. This is the most common case. We resolve these by moving them
       back to wait to be re-processed. To prevent jobs from cycling endlessly between active and wait,
       (e.g. if the job handler keeps crashing), we limit the number stalled job recoveries to MAX_STALLED_JOB_COUNT.

    DEPRECATED CASE:
     Case B) The job was just moved to 'active' from 'wait' and the worker that moved it hasn't gotten
       a lock yet, or died immediately before getting the lock (note that due to Redis limitations, the
       worker can't move the job and get the lock atomically - https://github.com/OptimalBits/bull/issues/258).
       For this case we also move the job back to 'wait' for reprocessing, but don't consider it 'stalled'
       since the job had never been started. This case is much rarer than Case A due to the very small
       timing window in which it must occur.

    Input:
      KEYS[1] 'active',
      KEYS[2] 'wait',
      KEYS[3] 'failed'
      KEYS[4] 'added',

      ARGV[1]  Max stalled job count
      ARGV[2]  queue.toKey('')
      ARGV[3]  timestamp
]]
local MAX_STALLED_JOB_COUNT = tonumber(ARGV[1])
local activeJobs = redis.call("LRANGE", KEYS[1], 0, -1)
local stalled = {}
local failed = {}
for _, job in ipairs(activeJobs) do

  local jobKey = ARGV[2] .. job
  if(redis.call("EXISTS", jobKey .. ":lock") == 0) then
      --  Remove from the active queue.
    redis.call("LREM", KEYS[1], 1, job)
    
    --    If it was previously locked then we consider it 'stalled' (Case A above). If this job
    --    has been stalled too many times, such as if it crashes the worker, then fail it.
    local stalledCount = redis.call("HINCRBY", jobKey, "stalledCounter", 1)
    if(stalledCount > MAX_STALLED_JOB_COUNT) then
      redis.call("ZADD", KEYS[3], ARGV[3], job)
      redis.call("HSET", jobKey, "failedReason", "job stalled more than allowable limit")
      table.insert(failed, job)
    else
      --      Move the job back to the wait queue, to immediately be picked up by a waiting worker.
      redis.call("RPUSH", KEYS[2], job)
      table.insert(stalled, job)
      redis.call("PUBLISH", KEYS[4], job)
    end
  end
end
return {failed, stalled}
