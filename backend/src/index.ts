import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { emailQueue } from "./queue/emailQueue";
import { startEmailWorker } from "./queue/emailWorker";
import { prisma } from "./config/prisma";
import { esClient, INDEX_NAME, initElasticsearch } from "./config/elasticsearch";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());
const PORT = process.env.PORT || 5000;

const parseVariables = (text: string, variables: Record<string, string>): string => {
  let result = text;
  if (!variables) return result;
  for (const [key, val] of Object.entries(variables)) {
    const regex = new RegExp(`{{\\s*${key}\\s*}}`, "g");
    result = result.replace(regex, val || "");
  }
  return result;
};

// --- TEMPLATES ENDPOINTS ---
app.get("/api/templates", async (_req, res) => {
  try {
    const templates = await prisma.template.findMany({ orderBy: { createdAt: "desc" } });
    return res.json(templates);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

app.post("/api/templates", async (req, res) => {
  try {
    const { title, subject, body } = req.body;
    if (!title || !subject || !body) {
      return res.status(400).json({ error: "title, subject, and body are required" });
    }
    const template = await prisma.template.create({
      data: { title, subject, body },
    });
    return res.status(201).json(template);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

app.delete("/api/templates/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.template.delete({ where: { id } });
    return res.json({ message: "Template deleted successfully" });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// --- EMAIL SCHEDULING ENDPOINTS ---
app.post("/api/schedule-email", async (req, res) => {
  try {
    const { userEmail, recipient, subject, body, delayInSeconds, variables } = req.body;
    if (!recipient || !subject || !body || delayInSeconds === undefined) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const finalSubject = parseVariables(subject, variables || {});
    const finalBody = parseVariables(body, variables || {});

    let user = await prisma.user.findUnique({ where: { email: userEmail || "default@reachinbox.com" } });
    if (!user) {
      user = await prisma.user.create({ data: { email: userEmail || "default@reachinbox.com", name: "Default User" } });
    }

    const scheduledAt = new Date(Date.now() + delayInSeconds * 1000);
    const emailJob = await prisma.emailJob.create({
      data: { userId: user.id, recipient, subject: finalSubject, body: finalBody, scheduledAt, status: "SCHEDULED" },
    });

    await emailQueue.add(
      "send-email",
      { jobId: emailJob.id, recipient, subject: finalSubject, body: finalBody },
      { delay: delayInSeconds * 1000, jobId: emailJob.id }
    );

    try {
      await esClient.index({
        index: INDEX_NAME,
        id: emailJob.id,
        document: {
          id: emailJob.id,
          userId: emailJob.userId,
          recipient: emailJob.recipient,
          subject: emailJob.subject,
          body: emailJob.body,
          status: emailJob.status,
          scheduledAt: emailJob.scheduledAt,
          createdAt: emailJob.createdAt,
        },
      });
    } catch (esErr: any) {
      console.warn("[Elasticsearch] Failed to index job:", esErr.message);
    }

    return res.status(201).json({ message: "Job scheduled successfully", job: emailJob });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

app.get("/api/jobs", async (_req, res) => {
  try {
    const jobs = await prisma.emailJob.findMany({ orderBy: { createdAt: "desc" } });
    return res.json(jobs);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// CANCEL / DELETE JOB
app.delete("/api/jobs/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const job = await prisma.emailJob.findUnique({ where: { id } });
    if (!job) return res.status(404).json({ error: "Job not found" });

    // 1. Remove from BullMQ queue
    try {
      const bullJob = await emailQueue.getJob(id);
      if (bullJob) {
        await bullJob.remove();
        console.log(`[BullMQ] Job ${id} removed from queue`);
      }
    } catch (qErr: any) {
      console.warn(`[BullMQ] Failed to remove job from queue:`, qErr.message);
    }

    // 2. Delete from Neon PostgreSQL database
    await prisma.emailJob.delete({ where: { id } });

    // 3. Remove from Elasticsearch
    try {
      await esClient.delete({ index: INDEX_NAME, id });
    } catch (esErr: any) {
      console.warn("[Elasticsearch] Failed to delete job from index:", esErr.message);
    }

    return res.json({ message: "Job cancelled and removed successfully", id });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

app.post("/api/jobs/:id/retry", async (req, res) => {
  const { id } = req.params;
  try {
    const job = await prisma.emailJob.findUnique({ where: { id } });
    if (!job) return res.status(404).json({ error: "Job not found" });

    if (job.status !== "FAILED") {
      return res.status(400).json({ error: `Only failed jobs can be retried` });
    }

    await emailQueue.add(
      "send-email",
      { jobId: job.id, recipient: job.recipient, subject: job.subject, body: job.body },
      { jobId: job.id }
    );

    const updatedJob = await prisma.emailJob.update({
      where: { id },
      data: { status: "SCHEDULED", errorReason: null },
    });

    try {
      await esClient.update({
        index: INDEX_NAME,
        id,
        doc: { status: "SCHEDULED", errorReason: null },
      });
    } catch (esErr: any) {
      console.warn("[Elasticsearch] Failed to update job status:", esErr.message);
    }

    return res.json({ message: "Job re-queued successfully", job: updatedJob });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

app.get("/api/search", async (req, res) => {
  const query = req.query.q as string;
  if (!query) {
    return res.status(400).json({ error: "Search query parameter q is required" });
  }

  try {
    const result = await esClient.search({
      index: INDEX_NAME,
      query: {
        multi_match: {
          query,
          fields: ["subject", "body", "recipient"],
          fuzziness: "AUTO",
        },
      },
    });

    const hits = result.hits.hits.map((hit) => hit._source);
    return res.json({ query, count: hits.length, results: hits });
  } catch (error: any) {
    console.error("Elasticsearch query error:", error.message);
    return res.status(500).json({ error: "Failed to execute search query" });
  }
});

app.listen(PORT, () => {
  console.log(`[Express] Backend server running on http://localhost:${PORT}`);
  startEmailWorker();
  initElasticsearch().catch(() => {});
});
