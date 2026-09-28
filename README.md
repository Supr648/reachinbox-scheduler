# ReachInbox Email Scheduler

A TypeScript/Express email scheduler with a Next.js dashboard. PostgreSQL is the source of truth for email jobs, BullMQ and Redis hold delayed work, Ethereal SMTP sends test email, and Elasticsearch provides search.

## Run Locally

Prerequisites: Node.js 20+, Docker Desktop, a Google OAuth client, a Slack app (for live Slack alerts), and Ethereal SMTP credentials.

1. Start the persistent infrastructure from the repository root:

   ```powershell
   docker compose up -d postgres redis elasticsearch
   ```

2. Configure `backend/.env` using [backend/.env.example](backend/.env.example). Set `DATABASE_URL` to the included local PostgreSQL service and keep `DATABASE_SCHEMA=reachinbox_assignment` so the assignment tables stay isolated from existing public-schema data. Keep `SESSION_SECRET` and `TOKEN_ENCRYPTION_KEY` stable across restarts; use long random values. Set the Slack and Ethereal credentials described below. Google OAuth is optional for local development; a development-only demo sign-in is provided and is disabled in production.

3. Initialize and start the backend:

   ```powershell
   cd backend
   npm install
   npm run db:generate
   npm run db:push
   npm run dev
   ```

   The API listens on `http://localhost:5000`. `db:push` applies the Prisma schema to the configured database; use a dedicated development database.

4. Start the frontend in another terminal:

   ```powershell
   cd frontend
   npm install
   npm run dev
   ```

   Open the URL printed by Next.js (normally `http://localhost:3000`). Set `NEXT_PUBLIC_API_URL` in `frontend/.env.local` if the API is not at `http://localhost:5000`. Set `FRONTEND_URL` in the backend environment to the exact frontend origin used for OAuth redirects.

For a compiled backend, run `npm run build` followed by `npm start`. `npm run typecheck` performs a no-output TypeScript check. The Ethereal helper can create a test account with `npm run ethereal`.

## OAuth And Email Setup

**Google sign-in:** Create an OAuth 2.0 Web client. Add `http://localhost:5000/api/auth/google/callback` as an authorized redirect URI and the frontend origin as an authorized JavaScript origin. Put the client ID and secret in `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

**Slack alerts:** Create a Slack app, enable OAuth, and add `http://localhost:5000/api/integrations/slack/callback` as its redirect URI. Grant bot scopes `chat:write`, `im:write`, and `users:read`. Set `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET`, restart the backend, install the app in the workspace, then use **Slack alerts → Connect** in the dashboard. The dashboard shows `Setup needed` until both variables are present. The app opens a DM with the installing Slack user and sends one message per connected user when a sender first reaches its hourly cap. Disconnecting removes the stored token; reconnecting takes effect without a redeploy. Slack credentials are optional for the scheduler, but live Slack notifications require a configured Slack app.

**Ethereal SMTP:** Run `npm run ethereal` in `backend`, or create an account at Ethereal. Set `ETHEREAL_HOST`, `ETHEREAL_PORT`, `ETHEREAL_USER`, and `ETHEREAL_PASS`. Ethereal captures rather than delivers real email; use its preview URL from the Sent view to inspect a message.

**Queue dashboard:** Set `QUEUE_DASHBOARD_USER` and `QUEUE_DASHBOARD_PASSWORD`. Visit `http://localhost:5000/admin/queues`; the route is protected with HTTP Basic Authentication.

## Architecture

- `POST /api/schedule-email` accepts one or many recipients, a required `Idempotency-Key`, a start time, inter-recipient delay, optional hourly cap, and optional sender. The API persists one row per recipient before adding a BullMQ job with a stable database ID.
- Startup reconciliation re-adds persisted `SCHEDULED`/legacy `PENDING` rows that have no Redis job. BullMQ delayed jobs and Redis persistence survive process restarts. Redis and PostgreSQL use named Docker volumes.
- The worker concurrency is configurable with `WORKER_CONCURRENCY` (default `5`). Redis Lua atomically reserves a sender's hourly slot and minimum send gap across workers. Configure `MAX_EMAILS_PER_HOUR` (default `200`) and `MIN_SEND_DELAY_MS` (default `2000`); sender records can set a stricter hourly cap and a longer minimum gap, while a campaign can only lower its sender's cap. Capacity-hit jobs are delayed to the next UTC hour window rather than discarded. A campaign's delay also spaces its scheduled run times.
- The hourly counter is a fixed UTC-hour window, not a rolling 60-minute window. Reservations count send attempts, including SMTP failures, as a conservative provider-throttling trade-off. Slack alerts are deduplicated per sender and UTC hour.
- `SENDING` is claimed with a conditional database update before SMTP. Automatic BullMQ retries are disabled because SMTP cannot participate in a database transaction: if the process dies after the provider accepts a message but before PostgreSQL records success, delivery is ambiguous. Stale in-flight records are marked `FAILED` for manual review; they are never blindly re-sent. Explicit user retries create a new queue attempt. This avoids automatic duplicates but cannot guarantee exactly-once delivery across an SMTP crash boundary.
- SMTP passwords and Slack bot tokens are encrypted with AES-256-GCM before storage. The encryption key must remain stable; production startup requires `SESSION_SECRET` and `TOKEN_ENCRYPTION_KEY`. Google sessions use an HttpOnly cookie.
- Email jobs are indexed in Elasticsearch and user-scoped search is exposed at `GET /api/search`. If Elasticsearch is unavailable, search falls back to a user-scoped PostgreSQL text query while PostgreSQL remains authoritative.

## Implemented Features

**Backend:** Google OAuth login/session/logout; owner-scoped sender and email APIs; batch scheduling for up to 1,000 recipients; request idempotency; BullMQ delayed jobs and startup reconciliation; configurable worker concurrency; Redis-backed hourly and inter-send limits; per-sender Ethereal SMTP; persisted job status, preview links, retry/cancel; Elasticsearch indexing/search; authenticated Slack OAuth and rate-limit DMs; Basic-Auth Bull Board.

**Frontend:** Google sign-in screen; signed-in user name/email/avatar and logout; Scheduled and Sent views; Elasticsearch search; CSV/text upload with email extraction and deduplication; start time, spacing, hourly cap, sender selection; sender account management; Slack connect/disconnect; loading, empty, error, and success states; failed-job retry and scheduled-job cancellation.

## Load And Operational Notes

The API accepts batches up to 1,000 addresses. Each becomes a persistent delayed job; the worker drains them at the configured concurrency and per-sender rate. At an hourly cap, excess work stays delayed in BullMQ and resumes after the next UTC hour boundary. Use Redis persistence and a durable PostgreSQL volume for restart recovery. The local Compose Elasticsearch service has security disabled and is for development only.

Live Google and Slack OAuth require credentials owned by the operator; those secrets are intentionally not included. SMTP delivery and Slack provider responses cannot be verified without configuring their credentials. For a demo, show sign-in, CSV scheduling, scheduled/sent states, a backend restart with a future job, and (when configured) an hourly-cap Slack DM. No cron process is used.
