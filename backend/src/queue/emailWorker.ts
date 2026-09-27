import { Worker, Job } from "bullmq";
import nodemailer from "nodemailer";
import { redisConnection } from "../config/redis";
import { EMAIL_QUEUE_NAME } from "./emailQueue";
import { prisma } from "../config/prisma";
import { esClient, INDEX_NAME } from "../config/elasticsearch";

const transporter = nodemailer.createTransport({
  host: process.env.ETHEREAL_HOST || "smtp.ethereal.email",
  port: Number(process.env.ETHEREAL_PORT) || 587,
  auth: { user: process.env.ETHEREAL_USER, pass: process.env.ETHEREAL_PASS },
});

export const startEmailWorker = () => {
  const concurrency = Number(process.env.WORKER_CONCURRENCY) || 5;
  const worker = new Worker(
    EMAIL_QUEUE_NAME,
    async (job: Job) => {
      const { jobId, recipient, subject, body } = job.data;
      console.log(`[Worker] Processing Job ID: ${jobId} for ${recipient}`);

      await prisma.emailJob.update({ where: { id: jobId }, data: { status: "PENDING" } });

      try {
        const sentInfo = await transporter.sendMail({
          from: `"ReachInbox Engine" <${process.env.ETHEREAL_USER}>`,
          to: recipient,
          subject: subject,
          text: body,
          html: `<p>${body}</p>`,
        });

        const previewUrl = nodemailer.getTestMessageUrl(sentInfo) || undefined;

        const updatedJob = await prisma.emailJob.update({
          where: { id: jobId },
          data: { 
            status: "SENT", 
            sentAt: new Date(),
            previewUrl: previewUrl as string | undefined
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

        throw error;
      }
    },
    { 
      connection: redisConnection, 
      concurrency,
      limiter: {
        max: 10,       // Max 10 jobs
        duration: 1000 // Per 1000ms (1 second)
      }
    }
  );

  worker.on("completed", (job) => console.log(`[Queue] Job ${job.id} completed.`));
  worker.on("failed", (job, err) => console.error(`[Queue] Job ${job?.id} failed: ${err.message}`));
  console.log(`[Queue Engine] Worker listening with concurrency: ${concurrency} & Rate Limit: 10/sec`);
  return worker;
};
