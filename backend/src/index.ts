import axios from "axios";
import { randomUUID } from "node:crypto";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import cookieParser = require("cookie-parser");
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import { OAuth2Client } from "google-auth-library";
import jwt = require("jsonwebtoken");
import { JobStatus } from "@prisma/client";
import { esClient, INDEX_NAME, initElasticsearch } from "./config/elasticsearch";
import { encryptSecret } from "./config/secrets";
import { prisma } from "./config/prisma";
import { redisConnection } from "./config/redis";
import { emailQueue } from "./queue/emailQueue";
import { startEmailWorker } from "./queue/emailWorker";
import { enqueueEmailJob, reconcileScheduledJobs } from "./queue/reconcile";
import { isValidEmailAddress, makeIdempotencyKey, normalizeRecipients, scheduledTimeForRecipient } from "./queue/scheduling";

dotenv.config();

const app = express();
const port = Number(process.env.PORT) || 5000;
const sessionSecret = process.env.SESSION_SECRET || "local-development-only-change-me";
const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
const backendUrl = process.env.BACKEND_URL || `http://localhost:${port}`;
const sessionCookie = "reachinbox_session";
const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
const googleClient = new OAuth2Client(
  googleClientId,
  googleClientSecret,
  `${backendUrl}/api/auth/google/callback`,
);

interface AuthenticatedRequest extends Request {
  userId?: string;
}

const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: "/",
};

app.disable("x-powered-by");
app.use(cors({
  credentials: true,
  origin: (origin, callback) => {
    const allowedOrigins = new Set([
      frontendUrl,
      "http://localhost:3002",
      "http://127.0.0.1:3002",
    ]);
    const isLocalhost = Boolean(origin && /^(https?:\/\/)(localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin));
    const isConfigured = Boolean(origin && allowedOrigins.has(origin));
    callback(null, !origin || isLocalhost || isConfigured);
  },
}));
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

app.get("/api/auth/options", (_req, res) => {
  return res.json({ googleEnabled: Boolean(googleClientId && googleClientSecret) });
});

const requireSession = (req: Request, res: Response, next: NextFunction) => {
  const authenticatedRequest = req as AuthenticatedRequest;
  const bearerToken = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const token = authenticatedRequest.cookies?.[sessionCookie] || bearerToken;
  if (!token) return res.status(401).json({ error: "Sign in is required" });

  try {
    const session = jwt.verify(token, sessionSecret) as jwt.JwtPayload;
    if (typeof session.sub !== "string") throw new Error("Invalid session subject");
    authenticatedRequest.userId = session.sub;
    return next();
  } catch {
    return res.status(401).json({ error: "Session expired; sign in again" });
  }
};

const userIdOf = (req: Request) => (req as AuthenticatedRequest).userId as string;
const signSession = (userId: string) => jwt.sign({ sub: userId }, sessionSecret, { expiresIn: "7d" });

app.get("/", (_req, res) => {
  res.json({
    status: "ok",
    message: "ReachInbox backend is running"
  });
});

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.post("/api/auth/dev-login", async (req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(404).json({ error: "Not found" });
  }

  const email = String(req.body.email || "demo@reachinbox.local").trim().toLowerCase();
  if (!isValidEmailAddress(email)) return res.status(400).json({ error: "A valid email is required" });
  const name = String(req.body.name || "Demo User").trim().slice(0, 100);
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, name },
    update: { name },
    select: { id: true, email: true, name: true, avatarUrl: true },
  });

  res.cookie(sessionCookie, signSession(user.id), sessionCookieOptions);
  return res.json({ user });
});

app.get("/api/auth/google", (_req, res) => {
  if (!googleClientId || !googleClientSecret) {
    return res.status(503).json({ error: "Google OAuth is not configured" });
  }
  const state = jwt.sign({ purpose: "google", nonce: randomUUID() }, sessionSecret, { expiresIn: "10m" });
  return res.redirect(googleClient.generateAuthUrl({
    access_type: "online",
    prompt: "select_account",
    scope: ["openid", "email", "profile"],
    state,
  }));
});

app.get("/api/auth/google/callback", async (req, res) => {
  try {
    const state = String(req.query.state || "");
    const statePayload = jwt.verify(state, sessionSecret) as jwt.JwtPayload & { purpose?: string };
    if (statePayload.purpose !== "google") throw new Error("Invalid OAuth state");
    const code = String(req.query.code || "");
    if (!code) throw new Error("Google did not return an authorization code");

    const { tokens } = await googleClient.getToken(code);
    if (!tokens.id_token || !googleClientId) throw new Error("Google did not return a verified identity");
    const ticket = await googleClient.verifyIdToken({ idToken: tokens.id_token, audience: googleClientId });
    const profile = ticket.getPayload();
    if (!profile?.sub || !profile.email || !profile.email_verified) {
      throw new Error("Google account email is missing or unverified");
    }

    const user = await prisma.user.upsert({
      where: { email: profile.email },
      create: {
        email: profile.email,
        name: profile.name || null,
        avatarUrl: profile.picture || null,
      },
      update: {
        name: profile.name || null,
        avatarUrl: profile.picture || null,
      },
    });
    res.cookie(sessionCookie, signSession(user.id), sessionCookieOptions);
    return res.redirect(frontendUrl);
  } catch (error) {
    console.warn("[OAuth] Google sign-in failed:", error instanceof Error ? error.message : "Unknown error");
    return res.redirect(`${frontendUrl}?auth=failed`);
  }
});

app.get("/api/auth/me", requireSession, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: userIdOf(req) },
    select: { id: true, email: true, name: true, avatarUrl: true },
  });
  if (!user) return res.status(401).json({ error: "Account no longer exists" });
  return res.json({ user });
});

app.post("/api/auth/logout", (_req, res) => {
  res.clearCookie(sessionCookie, { ...sessionCookieOptions, maxAge: undefined });
  return res.status(204).end();
});

app.get("/api/integrations/slack/status", requireSession, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: userIdOf(req) },
    select: { slackTeamId: true },
  });
  return res.json({
    connected: Boolean(user?.slackTeamId),
    configured: Boolean(process.env.SLACK_CLIENT_ID && process.env.SLACK_CLIENT_SECRET),
  });
});

app.get("/api/integrations/slack/connect", requireSession, (req, res) => {
  const clientId = process.env.SLACK_CLIENT_ID;
  if (!clientId || !process.env.SLACK_CLIENT_SECRET) {
    return res.status(503).json({ error: "Slack OAuth is not configured" });
  }
  const state = jwt.sign({ sub: userIdOf(req), purpose: "slack" }, sessionSecret, { expiresIn: "10m" });
  const params = new URLSearchParams({
    client_id: clientId,
    scope: "chat:write,im:write,users:read",
    redirect_uri: `${backendUrl}/api/integrations/slack/callback`,
    state,
  });
  return res.redirect(`https://slack.com/oauth/v2/authorize?${params.toString()}`);
});

app.get("/api/integrations/slack/callback", async (req, res) => {
  try {
    const state = jwt.verify(String(req.query.state || ""), sessionSecret) as jwt.JwtPayload & { purpose?: string };
    if (state.purpose !== "slack" || typeof state.sub !== "string") throw new Error("Invalid Slack OAuth state");
    const code = String(req.query.code || "");
    if (!code || !process.env.SLACK_CLIENT_ID || !process.env.SLACK_CLIENT_SECRET) {
      throw new Error("Slack OAuth is not configured or authorization was denied");
    }

    const tokenResponse = await axios.post("https://slack.com/api/oauth.v2.access", new URLSearchParams({
      client_id: process.env.SLACK_CLIENT_ID,
      client_secret: process.env.SLACK_CLIENT_SECRET,
      code,
      redirect_uri: `${backendUrl}/api/integrations/slack/callback`,
    }), { headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    const oauth = tokenResponse.data;
    if (!oauth.ok || !oauth.access_token || !oauth.authed_user?.id || !oauth.team?.id) {
      throw new Error(oauth.error || "Slack did not grant the required scopes");
    }

    await prisma.user.update({
      where: { id: state.sub },
      data: {
        slackAccessToken: encryptSecret(oauth.access_token),
        slackTeamId: oauth.team.id,
        slackUserId: oauth.authed_user.id,
      },
    });
    return res.redirect(`${frontendUrl}?slack=connected`);
  } catch (error) {
    console.warn("[OAuth] Slack connection failed:", error instanceof Error ? error.message : "Unknown error");
    return res.redirect(`${frontendUrl}?slack=failed`);
  }
});

app.delete("/api/integrations/slack", requireSession, async (req, res) => {
  await prisma.user.update({
    where: { id: userIdOf(req) },
    data: { slackAccessToken: null, slackTeamId: null, slackUserId: null },
  });
  return res.status(204).end();
});

app.get("/api/senders", requireSession, async (req, res) => {
  const senders = await prisma.sender.findMany({
    where: { userId: userIdOf(req) },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      email: true,
      smtpHost: true,
      smtpPort: true,
      maxPerHour: true,
      minDelayMs: true,
      createdAt: true,
    },
  });
  return res.json({ senders });
});

app.post("/api/senders", requireSession, async (req, res) => {
  const { email, smtpHost, smtpPort, smtpUser, smtpPass, maxPerHour, minDelayMs } = req.body;
  if (!isValidEmailAddress(String(email || "")) || !smtpHost || !smtpUser || !smtpPass || !Number.isInteger(Number(smtpPort))) {
    return res.status(400).json({ error: "Valid sender email, SMTP host, port, username, and password are required" });
  }
  const hourlyCap = maxPerHour === undefined ? null : Number(maxPerHour);
  const delay = minDelayMs === undefined ? null : Number(minDelayMs);
  if ((hourlyCap !== null && (!Number.isInteger(hourlyCap) || hourlyCap < 1)) ||
      (delay !== null && (!Number.isInteger(delay) || delay < 0))) {
    return res.status(400).json({ error: "Hourly cap and minimum delay must be non-negative integers" });
  }

  try {
    const sender = await prisma.sender.create({
      data: {
        userId: userIdOf(req),
        email: String(email).trim().toLowerCase(),
        smtpHost: String(smtpHost).trim(),
        smtpPort: Number(smtpPort),
        smtpUser: String(smtpUser).trim(),
        smtpPass: encryptSecret(String(smtpPass)),
        maxPerHour: hourlyCap,
        minDelayMs: delay,
      },
      select: { id: true, email: true, smtpHost: true, smtpPort: true, maxPerHour: true, minDelayMs: true },
    });
    return res.status(201).json({ sender });
  } catch (error) {
    return res.status(409).json({ error: "A sender with this email address already exists" });
  }
});

app.delete("/api/senders/:id", requireSession, async (req, res) => {
  const sender = await prisma.sender.findFirst({ where: { id: String(req.params.id), userId: userIdOf(req) } });
  if (!sender) return res.status(404).json({ error: "Sender not found" });
  await prisma.sender.delete({ where: { id: sender.id } });
  return res.status(204).end();
});

app.post("/api/schedule-email", requireSession, async (req, res) => {
  const { subject, body, startAt, delayBetweenEmailsSeconds, hourlyLimit, senderId } = req.body;
  const recipientValues: unknown[] = Array.isArray(req.body.recipients)
    ? req.body.recipients
    : [req.body.recipient];
  const recipients = normalizeRecipients(recipientValues);
  if (!recipients.length || recipients.length > 1000 || recipients.some((email) => !isValidEmailAddress(email))) {
    return res.status(400).json({ error: "Provide between 1 and 1000 valid recipient email addresses" });
  }
  if (!subject || !body || String(subject).length > 998 || String(body).length > 100000) {
    return res.status(400).json({ error: "Subject and body are required and must fit within email limits" });
  }

  const startTime = startAt ? new Date(startAt) : new Date();
  const sendDelay = Number(delayBetweenEmailsSeconds ?? 0);
  const cap = hourlyLimit === undefined || hourlyLimit === null || hourlyLimit === ""
    ? null
    : Number(hourlyLimit);
  if (Number.isNaN(startTime.getTime()) || !Number.isInteger(sendDelay) || sendDelay < 0 || sendDelay > 86400 ||
      (cap !== null && (!Number.isInteger(cap) || cap < 1 || cap > 100000))) {
    return res.status(400).json({ error: "Start time, delay, or hourly limit is invalid" });
  }

  const userId = userIdOf(req);
  const configuredSender = senderId
    ? await prisma.sender.findFirst({ where: { id: String(senderId), userId } })
    : null;
  if (senderId && !configuredSender) return res.status(404).json({ error: "Sender not found" });

  const idempotencyHeader = req.get("Idempotency-Key");
  if (!idempotencyHeader) return res.status(400).json({ error: "Idempotency-Key header is required" });
  if (idempotencyHeader.length > 200) return res.status(400).json({ error: "Idempotency-Key is too long" });
  const scheduled = [];

  try {
    for (const [index, recipient] of recipients.entries()) {
      const idempotencyKey = makeIdempotencyKey(userId, idempotencyHeader, recipient);
      const scheduledAt = scheduledTimeForRecipient(startTime, index, sendDelay);
      const selectedSender = configuredSender;
      let emailJob = await prisma.emailJob.findUnique({ where: { idempotencyKey } });
      if (!emailJob) {
        emailJob = await prisma.emailJob.create({
          data: {
            userId,
            senderId: selectedSender?.id ?? null,
            recipient,
            subject: String(subject),
            body: String(body),
            scheduledAt,
            hourlyLimit: cap,
            idempotencyKey,
          },
        });
      }
      await enqueueEmailJob(emailJob);
      scheduled.push(emailJob);

      try {
        await esClient.index({
          index: INDEX_NAME,
          id: emailJob.id,
          document: {
            id: emailJob.id,
            userId,
            recipient,
            subject: emailJob.subject,
            body: emailJob.body,
            status: emailJob.status,
            scheduledAt: emailJob.scheduledAt,
            createdAt: emailJob.createdAt,
          },
        });
      } catch (error) {
        console.warn("[Elasticsearch] Email indexing failed:", error instanceof Error ? error.message : "Unknown error");
      }
    }
    return res.status(201).json({ count: scheduled.length, emails: scheduled });
  } catch (error) {
    console.error("[Scheduler] Could not queue the complete batch:", error instanceof Error ? error.message : "Unknown error");
    return res.status(503).json({ error: "The batch was only partially queued; retry with the same Idempotency-Key" });
  }
});

app.get("/api/jobs", requireSession, async (req, res) => {
  const allowedStatuses = new Set(Object.values(JobStatus));
  const status = req.query.status ? String(req.query.status).toUpperCase() : undefined;
  if (status && !allowedStatuses.has(status as JobStatus)) {
    return res.status(400).json({ error: "Unknown job status" });
  }
  const take = Math.min(200, Math.max(1, Number(req.query.take) || 100));
  const skip = Math.max(0, Number(req.query.skip) || 0);
  const where = { userId: userIdOf(req), ...(status ? { status: status as JobStatus } : {}) };
  const [emails, total] = await Promise.all([
    prisma.emailJob.findMany({ where, orderBy: [{ scheduledAt: "desc" }, { createdAt: "desc" }], take, skip }),
    prisma.emailJob.count({ where }),
  ]);
  return res.json({ emails, total, take, skip });
});

app.get("/api/search", requireSession, async (req, res) => {
  const query = String(req.query.q || "").trim();
  if (!query) return res.status(400).json({ error: "Search query parameter q is required" });
  try {
    const result = await esClient.search({
      index: INDEX_NAME,
      query: {
        bool: {
          filter: [{ term: { userId: userIdOf(req) } }],
          must: [{ multi_match: { query, fields: ["subject", "body", "recipient"], fuzziness: "AUTO" } }],
        },
      },
    });
    return res.json({ query, count: result.hits.hits.length, results: result.hits.hits.map((hit) => hit._source) });
  } catch (error) {
    console.warn("[Search] Elasticsearch unavailable; using PostgreSQL fallback:", error instanceof Error ? error.message : "Unknown error");
    const results = await prisma.emailJob.findMany({
      where: {
        userId: userIdOf(req),
        OR: [
          { recipient: { contains: query, mode: "insensitive" } },
          { subject: { contains: query, mode: "insensitive" } },
          { body: { contains: query, mode: "insensitive" } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return res.json({ query, count: results.length, results, source: "postgres-fallback" });
  }
});

app.delete("/api/jobs/:id", requireSession, async (req, res) => {
  const emailJob = await prisma.emailJob.findFirst({
    where: { id: String(req.params.id), userId: userIdOf(req), status: "SCHEDULED" },
  });
  if (!emailJob) return res.status(404).json({ error: "Scheduled email not found" });
  const queuedJob = await emailQueue.getJob(emailJob.id);
  if (queuedJob) {
    try {
      await queuedJob.remove();
    } catch {
      return res.status(409).json({ error: "Email has started sending and can no longer be cancelled" });
    }
  }
  await prisma.emailJob.delete({ where: { id: emailJob.id } });
  try {
    await esClient.delete({ index: INDEX_NAME, id: emailJob.id });
  } catch {}
  return res.status(204).end();
});

app.post("/api/jobs/:id/retry", requireSession, async (req, res) => {
  const emailJob = await prisma.emailJob.findFirst({
    where: { id: String(req.params.id), userId: userIdOf(req), status: "FAILED" },
  });
  if (!emailJob) return res.status(404).json({ error: "Failed email not found" });
  const scheduledJob = await prisma.emailJob.update({
    where: { id: emailJob.id },
    data: { status: "SCHEDULED", errorReason: null, sendingStartedAt: null, scheduledAt: new Date() },
  });
  await enqueueEmailJob(scheduledJob, true);
  return res.status(202).json({ email: scheduledJob });
});

const queueDashboard = new ExpressAdapter();
queueDashboard.setBasePath("/admin/queues");
createBullBoard({ queues: [new BullMQAdapter(emailQueue)], serverAdapter: queueDashboard });
app.use("/admin/queues", (req, res, next) => {
  const username = process.env.QUEUE_DASHBOARD_USER;
  const password = process.env.QUEUE_DASHBOARD_PASSWORD;
  if (!username || !password) return res.status(503).send("Queue dashboard credentials are not configured");
  const supplied = req.headers.authorization?.match(/^Basic\s+(.+)$/i)?.[1];
  const credentials = supplied ? Buffer.from(supplied, "base64").toString("utf8") : "";
  if (credentials !== `${username}:${password}`) {
    res.setHeader("WWW-Authenticate", "Basic realm=\"ReachInbox queues\"");
    return res.status(401).send("Authentication required");
  }
  return next();
}, queueDashboard.getRouter());

const start = async () => {
  if (process.env.NODE_ENV === "production" && (!process.env.SESSION_SECRET || !process.env.TOKEN_ENCRYPTION_KEY)) {
    throw new Error("SESSION_SECRET and TOKEN_ENCRYPTION_KEY are required in production");
  }
  await prisma.$connect();
  let redisAvailable = false;
  try {
    await redisConnection.ping();
    redisAvailable = true;
  } catch (error) {
    console.warn("[Queue] Redis unavailable; starting without queue processing:", error instanceof Error ? error.message : "Unknown error");
  }
  await initElasticsearch();
  if (redisAvailable) {
    try {
      await reconcileScheduledJobs();
    } catch (error) {
      console.warn("[Queue] Startup reconciliation skipped:", error instanceof Error ? error.message : "Unknown error");
    }
  }
  const worker = redisAvailable ? startEmailWorker() : null;
  const server = app.listen(port, () => {
    console.log(`[Express] Backend server running at ${backendUrl}`);
    console.log(`[Bull Board] Queue dashboard mounted at ${backendUrl}/admin/queues`);
    if (!redisAvailable) console.warn("[Queue] Email scheduling is paused until Redis is available.");
  });

  const shutdown = async () => {
    server.close();
    if (worker) await worker.close();
    await emailQueue.close();
    await redisConnection.quit();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
};

start().catch((error) => {
  console.error("[Startup] Backend could not start:", error instanceof Error ? error.message : error);
  process.exit(1);
});
