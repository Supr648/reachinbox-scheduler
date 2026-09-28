import { DelayedError, Job, Worker } from "bullmq";
import nodemailer from "nodemailer";
import { redisConnection } from "../config/redis";
import { EMAIL_QUEUE_NAME } from "./emailQueue";
import { prisma } from "../config/prisma";
import { esClient, INDEX_NAME } from "../config/elasticsearch";
import { reserveSendSlot } from "./sendRateLimit";
import axios from "axios";
import { decryptSecret } from "../config/secrets";

const defaultTransporter = nodemailer.createTransport({
  host: process.env.ETHEREAL_HOST || "smtp.ethereal.email",
  port: Number(process.env.ETHEREAL_PORT) || 587,
  auth: { user: process.env.ETHEREAL_USER, pass: process.env.ETHEREAL_PASS },
});

export const startEmailWorker = () => {
  const concurrency = Math.max(1, Number(process.env.WORKER_CONCURRENCY) || 5);
  const configuredHourlyLimit = Math.max(0, Number(process.env.MAX_EMAILS_PER_HOUR) || 200);
  const configuredMinDelay = Math.max(0, Number(process.env.MIN_SEND_DELAY_MS) || 2000);
  const worker = new Worker(
    EMAIL_QUEUE_NAME,
    async (job: Job, token?: string) => {
      const { jobId, recipient, subject, body, senderId, hourlyLimit } = job.data;
      console.log(`[Worker] Processing Job ID: ${jobId} for ${recipient}`);

      const emailJob = await prisma.emailJob.findUnique({ where: { id: jobId } });
      if (!emailJob || ["SENT", "SENDING"].includes(emailJob.status)) return;
      const sender = senderId
        ? await prisma.sender.findUnique({ where: { id: senderId } })
        : null;
      const senderKey = sender?.id || "default";
      const senderHourlyLimit = sender?.maxPerHour ?? configuredHourlyLimit;
      const effectiveHourlyLimit = hourlyLimit
        ? Math.min(Number(hourlyLimit), senderHourlyLimit)
        : senderHourlyLimit;
      const effectiveMinDelayMs = Math.max(configuredMinDelay, sender?.minDelayMs ?? 0);
      const reservation = await reserveSendSlot(
        senderKey,
        effectiveHourlyLimit,
        effectiveMinDelayMs,
      );

      if (reservation.delayMs > 0) {
        if (reservation.hourlyLimitHit) {
          await notifyRateLimit(
            emailJob.userId,
            senderKey,
            effectiveHourlyLimit,
          );
        }
        const scheduledAt = new Date(Date.now() + reservation.delayMs);
        await prisma.emailJob.update({ where: { id: jobId }, data: { scheduledAt } });
        try {
          await esClient.update({ index: INDEX_NAME, id: jobId, doc: { scheduledAt } });
        } catch (error) {
          console.warn("[Elasticsearch] Failed to update deferred job:", error);
        }
        await job.moveToDelayed(Date.now() + reservation.delayMs, token);
        throw new DelayedError();
      }

      const claim = await prisma.emailJob.updateMany({
        where: { id: jobId, status: { in: ["SCHEDULED", "PENDING"] } },
        data: { status: "SENDING", sendingStartedAt: new Date() },
      });
      if (claim.count === 0) return;

      try {
        const transporter = sender
          ? nodemailer.createTransport({
              host: sender.smtpHost,
              port: sender.smtpPort,
              auth: { user: sender.smtpUser, pass: decryptSecret(sender.smtpPass) },
            })
          : defaultTransporter;
        const sentInfo = await transporter.sendMail({
          from: sender?.email || process.env.ETHEREAL_USER,
          to: recipient,
          subject,
          text: body,
        });

        const previewUrl = nodemailer.getTestMessageUrl(sentInfo) || undefined;

        const updatedJob = await prisma.emailJob.update({
          where: { id: jobId },
          data: {
            status: "SENT",
            sentAt: new Date(),
            sendingStartedAt: null,
            ...(previewUrl ? { previewUrl } : {}),
          },
        });

        try {
          await esClient.update({
            index: INDEX_NAME,
            id: jobId,
            doc: { status: "SENT", sentAt: updatedJob.sentAt, previewUrl },
          });
        } catch (esErr: any) {
          console.warn(`[Elasticsearch] Failed to update job status:`, esErr.message);
        }

        console.log(`[Worker] Sent to ${recipient}. Preview URL: ${previewUrl}`);
      } catch (error: any) {
        console.error(`[Worker] Failed Job ${jobId}:`, error.message);

        await prisma.emailJob.update({
          where: { id: jobId },
          data: { status: "FAILED", errorReason: error.message },
        });

        try {
          await esClient.update({
            index: INDEX_NAME,
            id: jobId,
            doc: { status: "FAILED", errorReason: error.message },
          });
        } catch (esErr: any) {
          console.warn(`[Elasticsearch] Failed to update job status:`, esErr.message);
        }

      }
    },
    {
      connection: redisConnection,
      concurrency,
    }
  );

  worker.on("completed", (job) => console.log(`[Queue] Job ${job.id} completed.`));
  worker.on("failed", (job, err) => console.error(`[Queue] Job ${job?.id} failed: ${err.message}`));
  console.log(`[Queue Engine] Worker listening with concurrency: ${concurrency}`);
  return worker;
};

const notifyRateLimit = async (userId: string, senderKey: string, hourlyLimit: number) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { slackAccessToken: true, slackUserId: true },
  });
  if (!user?.slackAccessToken || !user.slackUserId) return;

  const hourWindow = Math.floor(Date.now() / 3600000);
  const notificationKey = `email-rate:${userId}:${senderKey}:slack:${hourWindow}`;
  const firstHit = await redisConnection.set(notificationKey, "1", "EX", 3600, "NX");
  if (firstHit !== "OK") return;

  try {
    const headers = { Authorization: `Bearer ${decryptSecret(user.slackAccessToken)}` };
    const conversation = await axios.post(
      "https://slack.com/api/conversations.open",
      { users: user.slackUserId },
      { headers },
    );
    if (!conversation.data.ok || !conversation.data.channel?.id) {
      throw new Error(conversation.data.error || "Unable to open Slack DM");
    }
    const slackMessage = await axios.post(
      "https://slack.com/api/chat.postMessage",
      {
        channel: conversation.data.channel.id,
        text: `ReachInbox paused sender ${senderKey} after reaching its hourly email limit (${hourlyLimit}). Scheduled emails will resume in the next hour window.`,
      },
      { headers },
    );
    if (!slackMessage.data.ok) {
      throw new Error(slackMessage.data.error || "Slack did not accept the rate-limit message");
    }
    console.log(`[Slack] Rate-limit alert sent for sender ${senderKey}.`);
  } catch (error) {
    await redisConnection.del(notificationKey);
    console.warn("[Slack] Rate-limit notification failed:", error instanceof Error ? error.message : "Unknown error");
  }
};
