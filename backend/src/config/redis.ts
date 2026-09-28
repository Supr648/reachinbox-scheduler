import Redis from "ioredis";
import dotenv from "dotenv";
dotenv.config();
const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
export const redisConnection = new Redis(redisUrl, {
  connectTimeout: 2000,
  maxRetriesPerRequest: null,
  retryStrategy: () => null,
  tls: redisUrl.startsWith("rediss://") ? { rejectUnauthorized: false } : undefined,
});
