import Redis from "ioredis";
import dotenv from "dotenv";
dotenv.config();
const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
export const redisConnection = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  tls: redisUrl.startsWith("rediss://") ? { rejectUnauthorized: false } : undefined,
});
