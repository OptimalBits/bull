--[[this lua script takes three keys and two arguments
  // keys:
  //  - the expanded key for the active set
  //  - the expanded key for the destination set
  //  - the expanded key for the job
  //
  // arguments:
  //  ARGV[1] json serialized context which is:
  //     - delayedTimestamp when the destination set is 'delayed'
  //     - stacktrace when the destination set is 'failed'
  //     - returnvalue of the handler when the destination set is 'completed'
  //  ARGV[2] the id of the job
  //  ARGV[3] timestamp
  //
  // it checks whether KEYS[2] the destination set ends with 'delayed', 'completed'
  // or 'failed'. And then adds the context to the jobhash and adds the job to
  // the destination set. Finally it removes the job from the active list.
  //
  // it returns either 0 for success or -1 for failure.
]]
if redis.call("EXISTS", KEYS[3]) == 1 then
  if string.find(KEYS[2], "delayed$") ~= nil then
    local score = tonumber(ARGV[1])
    if score ~= 0 then
      redis.call("ZADD", KEYS[2], score, ARGV[2])
      redis.call("PUBLISH", KEYS[2], (score / 0x1000))
    else
      redis.call("ZADD", KEYS[2], ARGV[3], ARGV[2])
    end
  elseif string.find(KEYS[2], "completed$") ~= nil then
    redis.call("HSET", KEYS[3], "returnvalue", ARGV[1])
    redis.call("ZADD", KEYS[2], ARGV[3], ARGV[2])
   elseif string.find(KEYS[2], "failed$") ~= nil then
    redis.call("ZADD", KEYS[2], ARGV[3], ARGV[2])
   else
    return -1
   end
   redis.call("LREM", KEYS[1], 0, ARGV[2])
   return 0
  else
   return -1
end
