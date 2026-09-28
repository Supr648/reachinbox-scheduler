import { EmailJob } from "@prisma/client";
import { emailQueue } from "./emailQueue";
import { prisma } from "../config/prisma";

export const enqueueEmailJob = async (emailJob: EmailJob, replaceTerminal = false) => {
  const existing = await emailQueue.getJob(emailJob.id);
  if (existing) {
    const state = await existing.getState();
    if (!replaceTerminal || !["failed", "completed"].includes(state)) return;
    await existing.remove();
  }

  await emailQueue.add(
    "send-email",
    {
      jobId: emailJob.id,
      userId: emailJob.userId,
      recipient: emailJob.recipient,
      subject: emailJob.subject,
      body: emailJob.body,
      senderId: emailJob.senderId,
      hourlyLimit: emailJob.hourlyLimit,
    },
    {
      delay: Math.max(0, emailJob.scheduledAt.getTime() - Date.now()),
      jobId: emailJob.id,
    },
  );
};

export const reconcileScheduledJobs = async () => {
  const staleSendingBefore = new Date(Date.now() - 10 * 60 * 1000);
  await prisma.emailJob.updateMany({
    where: { status: "SENDING", sendingStartedAt: { lt: staleSendingBefore } },
    data: {
      status: "FAILED",
      errorReason: "Delivery outcome is unknown after a worker restart; manual review is required.",
    },
  });

  const scheduledJobs = await prisma.emailJob.findMany({
    where: { status: { in: ["SCHEDULED", "PENDING"] } },
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
  });

  for (const emailJob of scheduledJobs) {
    const existing = await emailQueue.getJob(emailJob.id);
    if (existing) {
      const state = await existing.getState();
      if (state === "failed" || state === "completed") {
        await prisma.emailJob.update({
          where: { id: emailJob.id },
          data: {
            status: "FAILED",
            errorReason: "Queue state and database state disagree; manual review is required.",
          },
        });
      }
      continue;
    }
    await enqueueEmailJob(emailJob);
  }

  console.log(`[Queue] Reconciled ${scheduledJobs.length} persisted scheduled emails.`);
};