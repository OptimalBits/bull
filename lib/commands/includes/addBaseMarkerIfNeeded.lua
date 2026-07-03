--[[
  Pushes a token onto the dedicated marker key purely to wake up a worker
  that's blocked on BRPOP(marker) (see Queue#getNextJob) whenever a job
  becomes available in 'wait' or 'prioritized'. The marker key never holds
  real job data, so nothing needs to recognize or discard its contents.

  Each token wakes exactly one blocked BRPOP, which is required when
  concurrency > 1: several slots can be blocked on the same connection at
  once, and each needs its own token to wake up roughly when its job
  arrives (a single self-deduping token, e.g. a ZSET with one fixed
  member, would only ever wake one slot at a time, starving the others
  until they time out). The list is trimmed on every push so that it
  can't grow without bound under sustained throughput where jobs keep
  arriving while no worker is ever idle enough to pop a token. If more
  than MAX_MARKER_LENGTH tokens accumulate, the oldest are dropped;
  a worker that starts a fresh BRPOP after that point simply waits out
  the rest of drainDelay before trying a real fetch (via the
  unconditional post-wait fetch in Queue#getNextJob), so a drop costs
  at most one drainDelay of extra latency, never a missed job.
  MAX_MARKER_LENGTH (1024 = 2^10) is chosen to comfortably exceed the
  concurrency setting of any single Bull queue instance in practice;
  raise it if you run a single instance with more concurrent slots than
  that.
]]

local MAX_MARKER_LENGTH = 1024

local function addBaseMarkerIfNeeded(markerKey, isPaused)
  if not isPaused then
    rcall("LPUSH", markerKey, "1")
    rcall("LTRIM", markerKey, 0, MAX_MARKER_LENGTH - 1)
  end
end
