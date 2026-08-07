import { redis } from "./redis";

// Atomically reserves a sender-specific delivery slot in Redis. Reservations survive
// app restarts and enforce both a minimum inter-send delay and hourly cap.
const reserveScript = `
local nextKey = KEYS[1]
local hourPrefix = KEYS[2]
local desired = tonumber(ARGV[1])
local now = tonumber(ARGV[2])
local minDelay = tonumber(ARGV[3])
local hourlyLimit = tonumber(ARGV[4])
local nextAt = tonumber(redis.call('GET', nextKey) or '0')
local candidate = math.max(desired, nextAt)
while true do
  local window = math.floor(candidate / 3600000) * 3600000
  local hourKey = hourPrefix .. window
  local used = tonumber(redis.call('GET', hourKey) or '0')
  if used < hourlyLimit then
    redis.call('INCR', hourKey)
    redis.call('PEXPIRE', hourKey, math.max(7200000, window + 7200000 - now))
    redis.call('SET', nextKey, candidate + minDelay, 'PX', math.max(7200000, candidate + minDelay + 7200000 - now))
    return candidate
  end
  candidate = window + 3600000
end
`;

export const reserveDeliverySlot = async (senderId: string, requestedAt: Date, delaySeconds: number, hourlyLimit: number) => {
  const timestamp = await redis.eval(
    reserveScript,
    2,
    `sender:${senderId}:next-at`,
    `sender:${senderId}:hour:`,
    requestedAt.getTime(),
    Date.now(),
    Math.max(0, delaySeconds) * 1_000,
    hourlyLimit,
  );
  return new Date(Number(timestamp));
};
