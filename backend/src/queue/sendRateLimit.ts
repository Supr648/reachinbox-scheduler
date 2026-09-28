import { redisConnection } from "../config/redis";

const reserveSlotScript = `
local now = tonumber(ARGV[1])
local hourlyLimit = tonumber(ARGV[2])
local minDelay = tonumber(ARGV[3])
local hour = math.floor(now / 3600000)
local hourlyKey = KEYS[1] .. ':' .. hour
local count = tonumber(redis.call('GET', hourlyKey) or '0')

if hourlyLimit > 0 and count >= hourlyLimit then
  return {0, 3600000 - (now % 3600000), 1}
end

local lastSent = tonumber(redis.call('GET', KEYS[2]) or '0')
local elapsed = now - lastSent
if lastSent > 0 and elapsed < minDelay then
  return {0, minDelay - elapsed, 2}
end

redis.call('INCR', hourlyKey)
redis.call('EXPIRE', hourlyKey, 7200)
redis.call('SET', KEYS[2], now, 'PX', math.max(minDelay * 2, 60000))
return {1, 0, 0}
`;

export const reserveSendSlot = async (
  senderKey: string,
  hourlyLimit: number,
  minDelayMs: number,
): Promise<{ delayMs: number; hourlyLimitHit: boolean }> => {
  const result = await redisConnection.eval(
    reserveSlotScript,
    2,
    `email-rate:${senderKey}:hour`,
    `email-rate:${senderKey}:last-send`,
    Date.now(),
    hourlyLimit,
    minDelayMs,
  ) as number[];

  return {
    delayMs: Number(result[0]) === 1 ? 0 : Math.max(1, Number(result[1])),
    hourlyLimitHit: Number(result[2]) === 1,
  };
};