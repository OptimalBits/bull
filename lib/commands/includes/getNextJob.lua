--[[
  Function to get the next job to process, checking the prioritized zset
  first (unless the queue is paused) and falling back to the plain wait
  list otherwise. The fallback path also cleans up the legacy priority
  zset, which is where pre-upgrade prioritized jobs still live embedded
  (in order) inside the wait list.
]]

local function getNextJob(prioritizedKey, waitKey, activeKey, legacyPriorityKey, metaPausedKey)
  if rcall("EXISTS", metaPausedKey) == 0 then
    local prioritizedJob = rcall("ZPOPMIN", prioritizedKey)
    if prioritizedJob[1] then
      rcall("LPUSH", activeKey, prioritizedJob[1])
      return prioritizedJob[1]
    end
  end

  local jobId = rcall("RPOPLPUSH", waitKey, activeKey)
  if jobId then
    rcall("ZREM", legacyPriorityKey, jobId)
  end
  return jobId
end
