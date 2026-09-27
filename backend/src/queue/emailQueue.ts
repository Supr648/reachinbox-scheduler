import { Queue } from "bullmq";
import { redisConnection } from "../config/redis";

export const EMAIL_QUEUE_NAME = "email-queue";

export const emailQueue = new Queue(EMAIL_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3, // Automatically retry failed jobs up to 3 times
    backoff: {
      type: "exponential",
      delay: 5000, // Retry after 5s, 10s, 20s...
    },
    removeOnComplete: false,
    removeOnFail: false,
  },
});

