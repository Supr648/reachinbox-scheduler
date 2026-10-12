"use client";

import {
  AlertCircle,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  Download,
  Eye,
  FileText,
  Inbox,
  Loader2,
  LogOut,
  Mail,
  Menu,
  Moon,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  Send,
  Sparkles,
  Split,
  Sun,
  Table,
  Trash2,
  Upload,
  UserCheck,
  X,
} from "lucide-react";
import React, { FormEvent, useEffect, useMemo, useState } from "react";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  (typeof window !== "undefined" && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1"
    ? "https://reachinbox-api-n1c2.onrender.com"
    : "http://localhost:5000");
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

const TEMPLATES = [
  {
    id: "intro",
    name: "Quick Intro & Partnership",
    subject: "Quick question regarding {{company}} outreach",
    body: "Hi {{name}},\n\nI came across {{company}} and noticed your team is actively scaling outreach.\n\nWe recently helped teams streamline multi-sender email deliverability with automated pacing and provider throttling.\n\nWould you be open to a 10-minute chat this Thursday to explore if this could help {{company}}?\n\nBest regards,\nReachInbox Team",
  },
  {
    id: "demo",
    name: "Product Demo Invitation",
    subject: "Modern email scheduling built for {{company}}",
    body: "Hey {{name}},\n\nSaw the great work you're doing at {{company}}.\n\nWe built ReachInbox to handle high-volume scheduled outreach without burning sender reputation or getting throttled by SMTP providers.\n\nWould love to give you a quick walkthrough if you have 15 minutes next week.\n\nCheers,\nReachInbox Team",
  },
  {
    id: "followup",
    name: "Friendly Follow-Up",
    subject: "Following up on my previous note to {{name}}",
    body: "Hi {{name}},\n\nJust bumping this in case it got buried under your inbox.\n\nLet me know if exploring automated email scheduling with rate limits is top of mind for {{company}} right now.\n\nHappy to share a quick demo link.\n\nBest,\nReachInbox Team",
  },
];

type User = { id: string; name: string | null; email: string; avatarUrl: string | null };
type EmailJob = {
  id: string;
  recipient: string;
  subject: string;
  body: string;
  scheduledAt: string;
  sentAt: string | null;
  status: "SCHEDULED" | "PENDING" | "SENDING" | "SENT" | "FAILED";
  errorReason: string | null;
  previewUrl: string | null;
};
type Sender = {
  id: string;
  email: string;
  smtpHost: string;
  smtpPort: number;
  maxPerHour: number | null;
  minDelayMs: number | null;
};

type ApiError = { error?: string };

async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8000);
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers,
      credentials: "include",
      signal: init.signal || controller.signal,
    });
  } finally {
    window.clearTimeout(timeout);
  }
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => ({})) as T & ApiError;
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

function findEmails(text: string) {
  return Array.from(new Set((text.match(emailPattern) || []).map((email) => email.toLowerCase())));
}

type ParsedLead = {
  email: string;
  name?: string;
  company?: string;
  role?: string;
};

function parseLeadCsv(text: string): ParsedLead[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const separator = lines[0].includes("\t") ? "\t" : lines[0].includes(";") ? ";" : ",";
  const headerTokens = lines[0].split(separator).map((h) => h.trim().replace(/^["']|["']$/g, "").toLowerCase());
  const hasHeader = headerTokens.some((h) =>
    ["email", "mail", "recipient", "name", "first name", "company", "organization"].includes(h)
  );

  if (!hasHeader) {
    const rawEmails = findEmails(text);
    return rawEmails.map((email) => {
      const emailUser = email.split("@")[0] || "";
      const emailDomain = email.split("@")[1] || "";
      return {
        email,
        name: emailUser.replace(/[._-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        company: emailDomain.split(".")[0]?.toUpperCase() || "",
      };
    });
  }

  const emailColIdx = headerTokens.findIndex((h) => ["email", "mail", "recipient", "e-mail"].includes(h));
  const nameColIdx = headerTokens.findIndex((h) => ["name", "first name", "firstname", "full name", "contact"].includes(h));
  const companyColIdx = headerTokens.findIndex((h) => ["company", "company name", "organization", "account"].includes(h));
  const roleColIdx = headerTokens.findIndex((h) => ["role", "title", "job title", "position"].includes(h));

  const results: ParsedLead[] = [];
  const seenEmails = new Set<string>();

  for (let i = 1; i < lines.length; i++) {
    const rawCols = lines[i].split(separator).map((c) => c.trim().replace(/^["']|["']$/g, ""));
    const emailCandidate = (emailColIdx >= 0 ? rawCols[emailColIdx] : rawCols.find((c) => emailPattern.test(c)))?.toLowerCase();
    if (!emailCandidate || !emailCandidate.includes("@") || seenEmails.has(emailCandidate)) continue;
    seenEmails.add(emailCandidate);

    const emailUser = emailCandidate.split("@")[0] || "";
    const emailDomain = emailCandidate.split("@")[1] || "";
    const defaultName = emailUser.replace(/[._-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    const defaultCompany = emailDomain.split(".")[0]?.toUpperCase() || "";

    results.push({
      email: emailCandidate,
      name: nameColIdx >= 0 && rawCols[nameColIdx] ? rawCols[nameColIdx] : defaultName,
      company: companyColIdx >= 0 && rawCols[companyColIdx] ? rawCols[companyColIdx] : defaultCompany,
      ...(roleColIdx >= 0 && rawCols[roleColIdx] ? { role: rawCols[roleColIdx] } : {}),
    });
  }

  return results;
}

function localDateTimeValue(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function displayDate(value: string | null) {
  if (!value) return "Not sent";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function initials(name: string | null, email: string) {
  return (name || email).split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

export default function Page() {
  const [user, setUser] = useState<User | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [emails, setEmails] = useState<EmailJob[]>([]);
  const [senders, setSenders] = useState<Sender[]>([]);
  const [selectedView, setSelectedView] = useState<"scheduled" | "sent">("scheduled");
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<EmailJob[] | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [senderSettingsOpen, setSenderSettingsOpen] = useState(false);
  const [slackConnected, setSlackConnected] = useState(false);
  const [slackConfigured, setSlackConfigured] = useState(false);
  const [toast, setToast] = useState("");
  const [actionError, setActionError] = useState("");

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [leadText, setLeadText] = useState("");
  const [fileName, setFileName] = useState("");
  const [startAt, setStartAt] = useState(() => localDateTimeValue(new Date(Date.now() + 60 * 60 * 1000)));
  const [sendDelay, setSendDelay] = useState("2");
  const [hourlyLimit, setHourlyLimit] = useState("");
  const [senderId, setSenderId] = useState("");
  const [scheduling, setScheduling] = useState(false);

  const [senderEmail, setSenderEmail] = useState("");
  const [smtpHost, setSmtpHost] = useState("smtp.ethereal.email");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [senderHourlyLimit, setSenderHourlyLimit] = useState("200");
  const [senderDelay, setSenderDelay] = useState("2000");
  const [savingSender, setSavingSender] = useState(false);

  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [abTestEnabled, setAbTestEnabled] = useState(false);
  const [subjectB, setSubjectB] = useState("");
  const [syncInterval, setSyncInterval] = useState<number | null>(10);
  const [secondsUntilSync, setSecondsUntilSync] = useState(10);
  const [showLeadTable, setShowLeadTable] = useState(false);

  const parsedLeads = useMemo(() => parseLeadCsv(leadText), [leadText]);
  const recipients = useMemo(() => parsedLeads.map((l) => l.email), [parsedLeads]);

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    if (typeof window !== "undefined") {
      localStorage.setItem("reachinbox_theme", next);
    }
  };

  const scheduledCount = emails.filter((email) => ["SCHEDULED", "PENDING", "SENDING"].includes(email.status)).length;
  const sentCount = emails.filter((email) => email.status === "SENT").length;
  const failedCount = emails.filter((email) => email.status === "FAILED").length;
  const deliveryRate = sentCount + failedCount > 0 ? Math.round((sentCount / (sentCount + failedCount)) * 100) : 100;
  const [statusFilter, setStatusFilter] = useState<"ALL" | "SENT" | "FAILED">("ALL");
  const [retryingAll, setRetryingAll] = useState(false);
  const [templatePreview, setTemplatePreview] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [selectedEmail, setSelectedEmail] = useState<EmailJob | null>(null);

  const applySchedulePreset = (preset: "now" | "1hour" | "tomorrow" | "2days") => {
    const d = new Date();
    if (preset === "now") {
      setStartAt(localDateTimeValue(d));
    } else if (preset === "1hour") {
      setStartAt(localDateTimeValue(new Date(d.getTime() + 60 * 60 * 1000)));
    } else if (preset === "tomorrow") {
      const tomorrow = new Date(d);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(9, 0, 0, 0);
      setStartAt(localDateTimeValue(tomorrow));
    } else if (preset === "2days") {
      const future = new Date(d);
      future.setDate(future.getDate() + 2);
      future.setHours(10, 0, 0, 0);
      setStartAt(localDateTimeValue(future));
    }
  };

  const totalCount = emails.length;
  const sentPercent = totalCount > 0 ? (sentCount / totalCount) * 100 : 0;
  const scheduledPercent = totalCount > 0 ? (scheduledCount / totalCount) * 100 : 0;
  const failedPercent = totalCount > 0 ? (failedCount / totalCount) * 100 : 0;

  const baseEmails = searchResults || emails;
  const visibleEmails = baseEmails.filter((email) => {
    if (selectedView === "scheduled") {
      return ["SCHEDULED", "PENDING", "SENDING"].includes(email.status);
    }
    if (statusFilter === "SENT") return email.status === "SENT";
    if (statusFilter === "FAILED") return email.status === "FAILED";
    return ["SENT", "FAILED"].includes(email.status);
  });

  useEffect(() => {
    let active = true;
    apiRequest<{ googleEnabled: boolean }>("/api/auth/options")
      .then((options) => { if (active) setGoogleEnabled(options.googleEnabled); })
      .catch(() => undefined);
    apiRequest<{ user: User }>("/api/auth/me")
      .then(({ user: signedInUser }) => { if (active) setUser(signedInUser); })
      .catch(() => { if (active) setUser(null); })
      .finally(() => { if (active) setCheckingSession(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!user) return;
    let active = true;
    setLoadingJobs(true);
    Promise.all([
      apiRequest<{ emails: EmailJob[] }>("/api/jobs?take=200"),
      apiRequest<{ senders: Sender[] }>("/api/senders"),
      apiRequest<{ connected: boolean; configured: boolean }>("/api/integrations/slack/status"),
    ]).then(([jobs, senderResponse, slack]) => {
      if (!active) return;
      setEmails(jobs.emails);
      setSenders(senderResponse.senders);
      setSlackConnected(slack.connected);
      setSlackConfigured(slack.configured);
    }).catch((error: Error) => {
      if (active) setActionError(error.message);
    }).finally(() => {
      if (active) setLoadingJobs(false);
    });
    return () => { active = false; };
  }, [user]);

  useEffect(() => {
    if (!user || syncInterval === null) return;
    setSecondsUntilSync(syncInterval);
    const ticker = window.setInterval(() => {
      setSecondsUntilSync((prev) => {
        if (prev <= 1) {
          apiRequest<{ emails: EmailJob[] }>("/api/jobs?take=200")
            .then((result) => setEmails(result.emails))
            .catch(() => undefined);
          return syncInterval;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(ticker);
  }, [user, syncInterval]);

  useEffect(() => {
    const query = search.trim();
    if (!query || !user) {
      setSearchResults(null);
      return;
    }
    const timer = window.setTimeout(() => {
      apiRequest<{ results: EmailJob[] }>(`/api/search?q=${encodeURIComponent(query)}`)
        .then((result) => setSearchResults(result.results))
        .catch((error: Error) => setActionError(error.message));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search, user]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = localStorage.getItem("reachinbox_theme");
    if (saved === "dark" || saved === "light") setTheme(saved);
    const params = new URLSearchParams(window.location.search);
    if (params.get("auth") === "failed") setActionError("Google sign-in could not be completed. Check the OAuth configuration and try again.");
    if (params.get("slack") === "connected") setToast("Slack connected. Rate-limit alerts will be sent by DM.");
    if (params.get("slack") === "failed") setActionError("Slack could not be connected. Check the OAuth scopes and app configuration.");
    if (params.has("auth") || params.has("slack")) window.history.replaceState({}, "", window.location.pathname);
  }, []);

  const refreshJobs = async () => {
    setLoadingJobs(true);
    setActionError("");
    try {
      const [jobs, senderResponse, slack] = await Promise.all([
        apiRequest<{ emails: EmailJob[] }>("/api/jobs?take=200"),
        apiRequest<{ senders: Sender[] }>("/api/senders"),
        apiRequest<{ connected: boolean; configured: boolean }>("/api/integrations/slack/status"),
      ]);
      setEmails(jobs.emails);
      setSenders(senderResponse.senders);
      setSlackConnected(slack.connected);
      setSlackConfigured(slack.configured);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not refresh emails");
    } finally {
      setLoadingJobs(false);
    }
  };

  const logout = async () => {
    try { await apiRequest<void>("/api/auth/logout", { method: "POST" }); } catch {}
    setUser(null);
    setEmails([]);
  };

  const enterDemoWorkspace = async () => {
    setLoginBusy(true);
    setLoginError("");
    try {
      const result = await apiRequest<{ user: User }>("/api/auth/dev-login", {
        method: "POST",
        body: JSON.stringify({}),
      });
      setUser(result.user);
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "Could not open the demo workspace");
    } finally {
      setLoginBusy(false);
    }
  };

  const scheduleEmails = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setScheduling(true);
    setActionError("");
    try {
      const headers = new Headers();
      headers.set("Idempotency-Key", crypto.randomUUID());

      const personalizedMap: Record<string, { name?: string; company?: string }> = {};
      parsedLeads.forEach((lead) => {
        personalizedMap[lead.email] = {
          name: lead.name,
          company: lead.company,
        };
      });

      const result = await apiRequest<{ count: number }>("/api/schedule-email", {
        method: "POST",
        headers,
        body: JSON.stringify({
          recipients,
          subject,
          body,
          subjectB: abTestEnabled && subjectB.trim() ? subjectB.trim() : undefined,
          personalized: personalizedMap,
          startAt: new Date(startAt).toISOString(),
          delayBetweenEmailsSeconds: Number(sendDelay),
          hourlyLimit: hourlyLimit ? Number(hourlyLimit) : undefined,
          senderId: senderId || undefined,
        }),
      });
      setToast(`${result.count} email${result.count === 1 ? "" : "s"} scheduled`);
      setComposeOpen(false);
      setLeadText("");
      setFileName("");
      setSubject("");
      setSubjectB("");
      setBody("");
      setAbTestEnabled(false);
      setShowLeadTable(false);
      await refreshJobs();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Scheduling failed");
    } finally {
      setScheduling(false);
    }
  };

  const uploadLeads = async (file?: File) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setActionError("Lead files must be smaller than 2 MB");
      return;
    }
    setFileName(file.name);
    setLeadText(await file.text());
    setActionError("");
  };

  const saveSender = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSavingSender(true);
    setActionError("");
    try {
      await apiRequest<{ sender: Sender }>("/api/senders", {
        method: "POST",
        body: JSON.stringify({
          email: senderEmail,
          smtpHost,
          smtpPort: Number(smtpPort),
          smtpUser,
          smtpPass,
          maxPerHour: Number(senderHourlyLimit),
          minDelayMs: Number(senderDelay),
        }),
      });
      setToast("Sender added");
      setSenderEmail("");
      setSmtpUser("");
      setSmtpPass("");
      setSenderSettingsOpen(false);
      await refreshJobs();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not save sender");
    } finally {
      setSavingSender(false);
    }
  };

  const updateJob = async (job: EmailJob, action: "cancel" | "retry") => {
    setActionError("");
    try {
      if (action === "cancel") {
        await apiRequest<void>(`/api/jobs/${job.id}`, { method: "DELETE" });
        setToast("Scheduled email cancelled");
      } else {
        await apiRequest<void>(`/api/jobs/${job.id}/retry`, { method: "POST" });
        setToast("Email queued for retry");
      }
      await refreshJobs();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not update email");
    }
  };

  const exportToCsv = () => {
    const listToExport = searchResults || emails;
    if (!listToExport.length) {
      setActionError("No emails to export");
      return;
    }
    const headers = ["ID", "Recipient", "Subject", "Status", "ScheduledAt", "SentAt", "ErrorReason"];
    const rows = listToExport.map((e) => [
      `"${e.id}"`,
      `"${e.recipient.replace(/"/g, '""')}"`,
      `"${(e.subject || "").replace(/"/g, '""')}"`,
      `"${e.status}"`,
      `"${e.scheduledAt || ""}"`,
      `"${e.sentAt || ""}"`,
      `"${(e.errorReason || "").replace(/"/g, '""')}"`,
    ]);
    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `reachinbox-emails-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setToast("Exported emails to CSV file");
  };

  const retryAllFailed = async () => {
    const failedEmails = emails.filter((e) => e.status === "FAILED");
    if (!failedEmails.length) return;
    setRetryingAll(true);
    setActionError("");
    try {
      await Promise.allSettled(failedEmails.map((email) => updateJob(email, "retry")));
      setToast(`Retrying ${failedEmails.length} failed email${failedEmails.length > 1 ? "s" : ""}`);
      await refreshJobs();
    } catch {
      setActionError("Some emails could not be retried");
    } finally {
      setRetryingAll(false);
    }
  };

  const insertVariable = (tag: string) => {
    setBody((prev) => (prev ? `${prev} ${tag}` : tag));
  };

  const renderPreview = (text: string) => {
    const sample = parsedLeads[0];
    const sampleRecipient = sample?.email || "alex.morgan@acme.corp";
    const sampleName = sample?.name || sampleRecipient.split("@")[0].replace(/[._-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    const domain = sampleRecipient.split("@")[1] || "acme.corp";
    const sampleCompany = sample?.company || domain.split(".")[0].toUpperCase();
    return text
      .replace(/\{\{name\}\}/gi, sampleName)
      .replace(/\{\{company\}\}/gi, sampleCompany)
      .replace(/\{\{email\}\}/gi, sampleRecipient);
  };

  const disconnectSlack = async () => {
    try {
      await apiRequest<void>("/api/integrations/slack", { method: "DELETE" });
      setSlackConnected(false);
      setToast("Slack disconnected");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not disconnect Slack");
    }
  };

  const connectSlack = () => {
    if (!slackConfigured) {
      setActionError("Slack is not configured yet. Add SLACK_CLIENT_ID and SLACK_CLIENT_SECRET to backend/.env, then restart the backend.");
      return;
    }
    window.location.assign(`${API_URL}/api/integrations/slack/connect`);
  };

  if (checkingSession) {
    return <main className="auth-loading"><Loader2 className="spin" size={20} /> Verifying session</main>;
  }

  if (!user) {
    return (
      <main className="login-page">
        <section className="login-panel">
          <div className="login-brand"><span className="brand-mark"><Mail size={19} /></span> reachinbox</div>
          <div className="login-copy">
            <span className="eyebrow">OUTREACH OPERATIONS</span>
            <h1>Thoughtful follow-ups, right on time.</h1>
            <p>Schedule, track, and deliver email sequences from one focused workspace.</p>
          </div>
          {googleEnabled && (
            <a className="google-button" href={`${API_URL}/api/auth/google`}>
              <span className="google-g">G</span>
              Continue with Google
              <ArrowUpRight size={16} />
            </a>
          )}
          <button
            className="google-button demo-login-button"
            onClick={enterDemoWorkspace}
            disabled={loginBusy}
            style={googleEnabled ? { marginTop: "10px", background: "#f8fafc", color: "#334155", border: "1px solid #cbd5e1" } : undefined}
          >
            {loginBusy ? <Loader2 className="spin" size={16} /> : <Mail size={16} />}
            {loginBusy ? "Opening workspace..." : "Sign in as Demo User"}
            <ArrowUpRight size={16} />
          </button>
          {loginError && <p className="login-error" role="alert">{loginError}</p>}
          <div className="login-foot"><span>Secure workspace</span><span>OAuth protected</span></div>
        </section>
        <aside className="login-art" aria-hidden="true">
          <div className="art-grid" />
          <div className="art-stamp"><span>RI</span><span>EMAIL<br />SCHEDULER</span></div>
          <div className="art-note"><span className="note-kicker">ON YOUR TIME</span><strong>Every send,<br />considered.</strong><span className="note-line" /></div>
          <div className="art-footer">REACHINBOX / OUTBOX LABS</div>
        </aside>
      </main>
    );
  }

  return (
    <main className={`workspace ${theme === "dark" ? "dark-theme" : ""}`}>
      <aside className="sidebar">
        <a className="brand" href="#top">
          <span className="brand-mark"><Mail size={17} /></span>
          <span className="brand-name">ReachInbox</span>
          <span className="brand-badge">PRO</span>
        </a>
        <div className="account-card">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {user.avatarUrl ? <img className="avatar" src={user.avatarUrl} alt="" /> : <div className="avatar avatar-fallback">{initials(user.name, user.email)}</div>}
          <div className="account-text">
            <strong>{user.name || "ReachInbox user"}</strong>
            <span>{user.email}</span>
          </div>
          <span className="live-status-dot" title="Workspace Active" />
        </div>
        <button className="compose-button" onClick={() => { setActionError(""); setComposeOpen(true); }}>
          <Plus size={16} /> <span>New Campaign</span>
          <span className="btn-key-hint">⌘N</span>
        </button>
        <div className="sidebar-label">MAILBOX QUEUE</div>
        <nav className="mail-nav" aria-label="Email folders">
          <button className={selectedView === "scheduled" ? "nav-link active" : "nav-link"} onClick={() => setSelectedView("scheduled")}>
            <CalendarDays size={16} /><span>Scheduled Queue</span><span className="nav-count">{scheduledCount}</span>
          </button>
          <button className={selectedView === "sent" ? "nav-link active" : "nav-link"} onClick={() => setSelectedView("sent")}>
            <Send size={16} /><span>Sent Messages</span><span className="nav-count">{sentCount}</span>
          </button>
        </nav>
        <div className="sidebar-spacer" />
        <div className="sidebar-tools">
          <button className="tool-link" onClick={() => setSenderSettingsOpen(true)}>
            <Settings2 size={16} /><span>Sender Accounts</span><span className="sender-total">{senders.length}</span>
          </button>
          <button className="tool-link" onClick={connectSlack} title={slackConfigured ? "Connect Slack" : "Slack OAuth setup required"}>
            <span className={slackConnected ? "slack-dot connected" : "slack-dot"} />
            <span>Slack Alerts</span><span className="connect-state">{slackConnected ? "Active" : slackConfigured ? "Connect" : "Setup"}</span>
          </button>
          {slackConnected && <button className="disconnect-link" onClick={disconnectSlack}>Disconnect Slack</button>}
        </div>
        <button className="logout-button" onClick={logout}><LogOut size={15} /><span>Sign out</span></button>
        <div className="sidebar-version">REACHINBOX ENGINE · V2.4</div>
      </aside>

      <section className="main-column" id="top">
        <header className="topbar">
          <div className="topbar-title">
            <div className="breadcrumb">
              <span className="breadcrumb-root">WORKSPACE</span>
              <span className="breadcrumb-sep">/</span>
              <span className="breadcrumb-current">{selectedView === "scheduled" ? "Scheduled Queue" : "Sent Messages"}</span>
            </div>
            <h1>{selectedView === "scheduled" ? "Scheduled Queue" : "Sent Messages"}</h1>
          </div>
          <div className="topbar-actions">
            <label className="search-box">
              <Search size={15} />
              <input aria-label="Search emails" placeholder="Search by recipient, subject, or text..." value={search} onChange={(event) => setSearch(event.target.value)} />
              {search ? <button aria-label="Clear search" onClick={() => setSearch("")}><X size={13} /></button> : <span className="kbd-shortcut">⌘K</span>}
            </label>
            <button className="icon-button" title="Refresh queue" aria-label="Refresh emails" onClick={refreshJobs}>
              <RefreshCw size={15} className={loadingJobs ? "spin" : ""} />
            </button>
            <button className="icon-button theme-btn" title={`Switch to ${theme === "light" ? "dark" : "light"} mode`} aria-label="Toggle theme" onClick={toggleTheme}>
              {theme === "light" ? <Moon size={15} /> : <Sun size={15} />}
            </button>
            <button className="user-avatar-button" title="Sign out" onClick={logout}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initials(user.name, user.email)}
            </button>
          </div>
        </header>

        <div className="metrics-banner">
          <div className="metric-card">
            <span className="metric-icon scheduled"><Clock3 size={16} /></span>
            <div className="metric-info">
              <span className="metric-val">{scheduledCount}</span>
              <span className="metric-label">In Queue</span>
            </div>
          </div>
          <div className="metric-card">
            <span className="metric-icon sent"><Send size={16} /></span>
            <div className="metric-info">
              <span className="metric-val">{sentCount}</span>
              <span className="metric-label">Delivered</span>
            </div>
          </div>
          <div className="metric-card">
            <span className="metric-icon failed"><AlertCircle size={16} /></span>
            <div className="metric-info">
              <span className="metric-val">{failedCount}</span>
              <span className="metric-label">Failed</span>
            </div>
          </div>
          <div className="metric-card">
            <span className="metric-icon rate"><BarChart3 size={16} /></span>
            <div className="metric-info">
              <span className="metric-val">{deliveryRate}%</span>
              <span className="metric-label">Success Rate</span>
            </div>
          </div>
          <div className="progress-section">
            <div className="progress-label-row">
              <span className="progress-title">QUEUE DISTRIBUTION</span>
              <span className="progress-legend">
                <span className="legend-dot sent" /> Delivered ({sentCount})
                <span className="legend-dot scheduled" /> In Queue ({scheduledCount})
                {failedCount > 0 && <><span className="legend-dot failed" /> Failed ({failedCount})</>}
              </span>
            </div>
            <div className="multi-progress-bar">
              <div className="bar-segment sent" style={{ width: `${sentPercent}%` }} title={`Delivered: ${sentCount}`} />
              <div className="bar-segment scheduled" style={{ width: `${scheduledPercent}%` }} title={`In Queue: ${scheduledCount}`} />
              <div className="bar-segment failed" style={{ width: `${failedPercent}%` }} title={`Failed: ${failedCount}`} />
            </div>
          </div>
        </div>

        <div className="list-toolbar">
          <div className="list-caption">
            <span className="caption-icon">{selectedView === "scheduled" ? <Clock3 size={15} /> : <Inbox size={15} />}</span>
            <span className="caption-text">{visibleEmails.length} {selectedView === "scheduled" ? "in active queue" : "messages recorded"}</span>
            {selectedView === "sent" && (
              <div className="filter-pills" role="tablist">
                <button type="button" className={`filter-pill ${statusFilter === "ALL" ? "active" : ""}`} onClick={() => setStatusFilter("ALL")}>All ({sentCount + failedCount})</button>
                <button type="button" className={`filter-pill ${statusFilter === "SENT" ? "active" : ""}`} onClick={() => setStatusFilter("SENT")}>Delivered ({sentCount})</button>
                {failedCount > 0 && (
                  <button type="button" className={`filter-pill failed ${statusFilter === "FAILED" ? "active" : ""}`} onClick={() => setStatusFilter("FAILED")}>Failed ({failedCount})</button>
                )}
              </div>
            )}
          </div>
          <div className="toolbar-right">
            <button className="toolbar-button" onClick={exportToCsv} title="Download CSV report"><Download size={13} /> Export CSV</button>
            {selectedView === "sent" && failedCount > 0 && (
              <button className="toolbar-button retry-all" onClick={retryAllFailed} disabled={retryingAll} title="Retry all failed deliveries">
                <RotateCcw size={13} className={retryingAll ? "spin" : ""} /> {retryingAll ? "Retrying..." : `Retry ${failedCount} Failed`}
              </button>
            )}
            <button
              type="button"
              className="sync-pill"
              title="Click to toggle auto-refresh speed (10s -> 5s -> 30s -> Pause)"
              onClick={() => {
                setSyncInterval((prev) => (prev === 10 ? 5 : prev === 5 ? 30 : prev === 30 ? null : 10));
              }}
            >
              <span className={`sync-dot ${syncInterval ? "active" : "paused"}`} />
              <span>{syncInterval ? `Auto-sync: ${secondsUntilSync}s` : "Sync: Paused"}</span>
            </button>
            <button className="compose-small" onClick={() => setComposeOpen(true)}><Plus size={14} /> New Campaign</button>
          </div>
        </div>

        {actionError && <div className="error-banner" role="alert"><AlertCircle size={15} /><span>{actionError}</span><button onClick={() => setActionError("")} aria-label="Dismiss"><X size={14} /></button></div>}

        <div className="email-list" aria-live="polite">
          {loadingJobs && emails.length === 0 ? (
            <div className="list-state"><Loader2 className="spin" size={22} /><span>Loading messages from queue...</span></div>
          ) : visibleEmails.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">{selectedView === "scheduled" ? <CalendarDays size={22} /> : <Send size={22} />}</div>
              <h2>{search ? "No matching emails found" : selectedView === "scheduled" ? "Your queue is clear" : "No messages sent yet"}</h2>
              <p>{search ? "Try searching by another recipient address, domain, or subject phrase." : selectedView === "scheduled" ? "Compose an outreach sequence and set delivery pacing with provider throttling." : "Delivered messages will appear here once sent through SMTP relays."}</p>
              {!search && selectedView === "scheduled" && <button className="empty-cta" onClick={() => setComposeOpen(true)}><Plus size={15} /> Schedule an email</button>}
            </div>
          ) : (
            <>
              <div className="table-header-row">
                <span className="th-col th-recipient">RECIPIENT &amp; LEAD</span>
                <span className="th-col th-subject">SUBJECT &amp; MESSAGE PREVIEW</span>
                <span className="th-col th-status">STATUS</span>
                <span className="th-col th-timing">{selectedView === "sent" ? "SENT AT" : "SCHEDULED FOR"}</span>
                <span className="th-col th-actions">ACTIONS</span>
              </div>
              <div className="email-rows-container">
                {visibleEmails.map((email, index) => (
                  <article
                    className="email-row clickable-row"
                    key={email.id}
                    onClick={() => setSelectedEmail(email)}
                    title="Click to inspect email details"
                    style={{ animationDelay: `${Math.min(index * 30, 240)}ms` }}
                  >
                    <div className="col-recipient">
                      <div className="recipient-mark">{initials(null, email.recipient)}</div>
                      <div className="recipient-text-block">
                        <span className="email-address">{email.recipient}</span>
                        <span className="email-tag">{email.recipient.split("@")[1] || "Lead"}</span>
                      </div>
                    </div>
                    <div className="col-content">
                      <div className="email-subject">{email.subject || "(no subject)"}</div>
                      <div className="email-preview">{email.body}</div>
                    </div>
                    <div className="col-status">
                      <span className={`status-pill ${email.status.toLowerCase()}`}>
                        <span className="status-dot" />
                        {email.status === "SENDING" ? "Sending" : email.status.toLowerCase()}
                      </span>
                    </div>
                    <div className="col-timing">
                      <Clock3 size={12} className="timing-clock" />
                      <time>{displayDate(selectedView === "sent" ? email.sentAt : email.scheduledAt)}</time>
                    </div>
                    <div className="row-action">
                      {email.status === "FAILED" && <button title="Retry email" aria-label="Retry email" onClick={(e) => { e.stopPropagation(); updateJob(email, "retry"); }}><RotateCcw size={14} /></button>}
                      {email.status === "SCHEDULED" && <button title="Cancel scheduled email" aria-label="Cancel scheduled email" onClick={(e) => { e.stopPropagation(); updateJob(email, "cancel"); }}><Trash2 size={14} /></button>}
                      {email.previewUrl && <a title="Open Ethereal preview" aria-label="Open Ethereal preview" href={email.previewUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}><ArrowUpRight size={14} /></a>}
                      <button title="Inspect email" aria-label="Inspect email" onClick={(e) => { e.stopPropagation(); setSelectedEmail(email); }}><Eye size={14} /></button>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </div>
        <footer className="list-footer">
          <span>{emails.length} total messages loaded</span>
          <span>ReachInbox Engine <span className="footer-dot">/</span> {user.email}</span>
        </footer>
      </section>

      {composeOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setComposeOpen(false); }}>
        <section className="compose-modal" role="dialog" aria-modal="true" aria-labelledby="compose-heading">
          <header className="modal-header"><div className="modal-heading"><span className="modal-mark"><Mail size={17} /></span><div><span className="modal-kicker">NEW CAMPAIGN</span><h2 id="compose-heading">Compose email</h2></div></div><button className="icon-button" aria-label="Close compose" onClick={() => setComposeOpen(false)}><X size={18} /></button></header>
          <form onSubmit={scheduleEmails}>
            <div className="compose-fields">
              <label className="compose-field"><span>From</span><select value={senderId} onChange={(event) => setSenderId(event.target.value)}><option value="">Default Ethereal sender</option>{senders.map((sender) => <option key={sender.id} value={sender.id}>{sender.email}</option>)}</select></label>
              <div className="compose-field recipient-field">
                <span>To</span>
                <div className="recipient-controls">
                  <textarea value={leadText} onChange={(event) => { setLeadText(event.target.value); setFileName(""); }} placeholder="Paste email addresses or upload a lead file" rows={3} aria-label="Lead email addresses"/>
                  <label className="upload-button"><Upload size={15} /> Upload list<input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={(event) => void uploadLeads(event.target.files?.[0])} /></label>
                </div>
                <div className="lead-count">
                  <span>{recipients.length} valid {recipients.length === 1 ? "address" : "addresses"} found</span>
                  {fileName && <span className="file-name"><FileText size={13} /> {fileName}</span>}
                </div>
                {parsedLeads.length > 0 && (
                  <div className="lead-preview-strip">
                    <div className="lead-strip-summary">
                      <UserCheck size={13} className="lead-check-icon" />
                      <span>{parsedLeads.length} leads loaded · Auto-injecting <code>{"{{name}}"}</code> &amp; <code>{"{{company}}"}</code></span>
                    </div>
                    <button type="button" className="lead-strip-toggle" onClick={() => setShowLeadTable(!showLeadTable)}>
                      <Table size={12} /> {showLeadTable ? "Hide Lead Table" : "View Data Table"}
                    </button>
                  </div>
                )}
                {showLeadTable && parsedLeads.length > 0 && (
                  <div className="lead-data-drawer">
                    <table className="lead-mini-table">
                      <thead>
                        <tr>
                          <th>Email</th>
                          <th>Name (&#123;&#123;name&#125;&#125;)</th>
                          <th>Company (&#123;&#123;company&#125;&#125;)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {parsedLeads.slice(0, 5).map((l, i) => (
                          <tr key={i}>
                            <td className="lead-email-cell">{l.email}</td>
                            <td>{l.name || "—"}</td>
                            <td>{l.company || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {parsedLeads.length > 5 && (
                      <div className="lead-more-note">+ {parsedLeads.length - 5} more leads will be personalized</div>
                    )}
                  </div>
                )}
              </div>
              
              <div className="template-bar">
                <div className="template-left">
                  <Sparkles size={14} className="sparkle-icon" />
                  <span className="template-label">Template:</span>
                  <select
                    className="template-select"
                    value={selectedTemplate}
                    onChange={(e) => {
                      const t = TEMPLATES.find((tpl) => tpl.id === e.target.value);
                      if (t) {
                        setSubject(t.subject);
                        setBody(t.body);
                        setSelectedTemplate(t.id);
                        setTemplatePreview(false);
                      }
                    }}
                  >
                    <option value="">Load an outreach template...</option>
                    {TEMPLATES.map((tpl) => (
                      <option key={tpl.id} value={tpl.id}>{tpl.name}</option>
                    ))}
                  </select>
                </div>
                <div className="variable-chips">
                  <span className="chips-label">Merge tags:</span>
                  <button type="button" className="chip" onClick={() => insertVariable("{{name}}")}>+ {"{{name}}"}</button>
                  <button type="button" className="chip" onClick={() => insertVariable("{{company}}")}>+ {"{{company}}"}</button>
                  <button type="button" className="chip" onClick={() => insertVariable("{{email}}")}>+ {"{{email}}"}</button>
                  <button type="button" className={`chip preview-toggle ${templatePreview ? "active" : ""}`} onClick={() => setTemplatePreview(!templatePreview)}>
                    <Eye size={12} /> {templatePreview ? "Editor" : "Preview"}
                  </button>
                </div>
              </div>

              <div className="ab-split-bar">
                <button
                  type="button"
                  className={`ab-split-button ${abTestEnabled ? "active" : ""}`}
                  onClick={() => setAbTestEnabled(!abTestEnabled)}
                >
                  <Split size={13} /> {abTestEnabled ? "Disable A/B Split Test" : "+ A/B Test Subject Line (50/50 Split)"}
                </button>
                {abTestEnabled && (
                  <span className="ab-split-badge">50% Traffic Split across Leads</span>
                )}
              </div>

              {templatePreview ? (
                <div className="preview-container">
                  <div className="preview-header">
                    <Sparkles size={13} />
                    <span>SAMPLE PERSONALIZED PREVIEW ({recipients[0] || "alex.morgan@acme.corp"})</span>
                  </div>
                  <div className="preview-subject">
                    <span className="preview-label">Subject:</span> {renderPreview(subject || "(No subject)")}
                  </div>
                  <div className="preview-body">
                    {renderPreview(body || "(No message body written yet)")}
                  </div>
                </div>
              ) : (
                <>
                  {abTestEnabled ? (
                    <div className="ab-subject-grid">
                      <label className="compose-field">
                        <span>Subject [A]</span>
                        <input
                          required
                          maxLength={998}
                          value={subject}
                          onChange={(event) => setSubject(event.target.value)}
                          placeholder="Variant A subject line (50% traffic)"
                        />
                      </label>
                      <label className="compose-field">
                        <span>Subject [B]</span>
                        <input
                          required
                          maxLength={998}
                          value={subjectB}
                          onChange={(event) => setSubjectB(event.target.value)}
                          placeholder="Variant B subject line (50% traffic)"
                        />
                      </label>
                    </div>
                  ) : (
                    <label className="compose-field"><span>Subject</span><input required maxLength={998} value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="A clear, relevant subject" /></label>
                  )}
                  <label className="compose-field body-field"><span>Message</span><textarea required maxLength={100000} value={body} onChange={(event) => setBody(event.target.value)} placeholder="Write a thoughtful note..." rows={6} /></label>
                </>
              )}
            </div>
            <div className="schedule-settings">
              <div className="settings-heading">
                <span>DELIVERY SETTINGS</span>
                <div className="preset-chips">
                  <span className="chips-label">Quick time:</span>
                  <button type="button" className="preset-chip" onClick={() => applySchedulePreset("now")}>⚡ Now</button>
                  <button type="button" className="preset-chip" onClick={() => applySchedulePreset("1hour")}>⏱ +1h</button>
                  <button type="button" className="preset-chip" onClick={() => applySchedulePreset("tomorrow")}>☀️ Tomorrow 9 AM</button>
                  <button type="button" className="preset-chip" onClick={() => applySchedulePreset("2days")}>📅 +2 Days</button>
                </div>
              </div>
              <div className="settings-grid">
                <label className="setting-input"><span><CalendarDays size={14} /> Start time</span><input type="datetime-local" value={startAt} onChange={(event) => setStartAt(event.target.value)} /></label>
                <label className="setting-input"><span><Clock3 size={14} /> Delay between emails</span><div className="number-with-unit"><input type="number" min="0" max="86400" value={sendDelay} onChange={(event) => setSendDelay(event.target.value)} /><small>seconds</small></div></label>
                <label className="setting-input"><span><Send size={14} /> Hourly limit <em>optional</em></span><div className="number-with-unit"><input type="number" min="1" max="100000" placeholder="Sender default" value={hourlyLimit} onChange={(event) => setHourlyLimit(event.target.value)} /><small>/ hour</small></div></label>
              </div>
            </div>
            <div className="modal-footer"><span className="queue-note"><Check size={15} /> Durable queue enabled</span><button type="submit" className="schedule-button" disabled={scheduling || recipients.length === 0 || !subject || !body}>{scheduling ? <Loader2 className="spin" size={16} /> : <CalendarDays size={16} />}{scheduling ? "Scheduling..." : `Schedule ${recipients.length || "emails"}`}</button></div>
          </form>
        </section>
      </div>}

      {senderSettingsOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSenderSettingsOpen(false); }}>
        <section className="sender-modal" role="dialog" aria-modal="true" aria-labelledby="sender-heading">
          <header className="modal-header"><div className="modal-heading"><span className="modal-mark sender-mark"><Settings2 size={17} /></span><div><span className="modal-kicker">SENDER ACCOUNTS</span><h2 id="sender-heading">Manage senders</h2></div></div><button className="icon-button" aria-label="Close sender settings" onClick={() => setSenderSettingsOpen(false)}><X size={18} /></button></header>
          <div className="sender-existing">{senders.length ? senders.map((sender) => <div className="sender-item" key={sender.id}><span className="sender-avatar"><Mail size={15} /></span><span className="sender-detail"><strong>{sender.email}</strong><small>{sender.smtpHost} · {sender.maxPerHour ?? "Default"} emails/hour</small></span><button aria-label={`Remove ${sender.email}`} title="Remove sender" onClick={async () => { try { await apiRequest<void>(`/api/senders/${sender.id}`, { method: "DELETE" }); await refreshJobs(); setToast("Sender removed"); } catch (error) { setActionError(error instanceof Error ? error.message : "Could not remove sender"); } }}><Trash2 size={15} /></button></div>) : <p className="no-senders">No additional senders yet. Add an SMTP account below.</p>}</div>
          <form className="sender-form" onSubmit={saveSender}><div className="form-section-title"><Plus size={15} /> Add SMTP sender</div>
            <div className="sender-form-grid"><label><span>Sender email</span><input type="email" required value={senderEmail} onChange={(event) => setSenderEmail(event.target.value)} placeholder="you@example.com" /></label><label><span>SMTP host</span><input required value={smtpHost} onChange={(event) => setSmtpHost(event.target.value)} placeholder="smtp.example.com" /></label><label><span>Port</span><input type="number" required min="1" max="65535" value={smtpPort} onChange={(event) => setSmtpPort(event.target.value)} /></label><label><span>SMTP username</span><input required value={smtpUser} onChange={(event) => setSmtpUser(event.target.value)} /></label><label><span>SMTP password</span><input type="password" required value={smtpPass} onChange={(event) => setSmtpPass(event.target.value)} /></label><label><span>Emails per hour</span><input type="number" required min="1" value={senderHourlyLimit} onChange={(event) => setSenderHourlyLimit(event.target.value)} /></label><label><span>Minimum delay (ms)</span><input type="number" required min="0" value={senderDelay} onChange={(event) => setSenderDelay(event.target.value)} /></label></div>
            <div className="sender-footer"><span>Credentials are encrypted before storage.</span><button type="submit" className="schedule-button" disabled={savingSender}>{savingSender ? <Loader2 className="spin" size={16} /> : <Plus size={16} />}{savingSender ? "Saving..." : "Add sender"}</button></div>
          </form>
        </section>
      </div>}

      {selectedEmail && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedEmail(null); }}>
          <section className="compose-modal detail-modal" role="dialog" aria-modal="true" aria-labelledby="detail-heading">
            <header className="modal-header">
              <div className="modal-heading">
                <span className="modal-mark"><Mail size={17} /></span>
                <div>
                  <span className="modal-kicker">EMAIL INSPECTOR</span>
                  <h2 id="detail-heading">{selectedEmail.recipient}</h2>
                </div>
              </div>
              <button className="icon-button" aria-label="Close details" onClick={() => setSelectedEmail(null)}><X size={18} /></button>
            </header>
            <div className="detail-body">
              <div className="detail-meta-grid">
                <div className="meta-box">
                  <span className="meta-label">STATUS</span>
                  <span className={`status-pill ${selectedEmail.status.toLowerCase()}`}>{selectedEmail.status}</span>
                </div>
                <div className="meta-box">
                  <span className="meta-label">TIMING</span>
                  <strong>{selectedEmail.sentAt ? `Delivered ${displayDate(selectedEmail.sentAt)}` : `Scheduled ${displayDate(selectedEmail.scheduledAt)}`}</strong>
                </div>
                <div className="meta-box">
                  <span className="meta-label">RECORD ID</span>
                  <span className="id-text" title={selectedEmail.id}>{selectedEmail.id.slice(0, 16)}...</span>
                </div>
              </div>

              {selectedEmail.errorReason && (
                <div className="detail-error-box" role="alert">
                  <AlertCircle size={17} />
                  <div>
                    <strong>Delivery Issue Details:</strong>
                    <p>{selectedEmail.errorReason}</p>
                  </div>
                </div>
              )}

              <div className="detail-content-box">
                <div className="detail-subject-line">
                  <span className="subject-kicker">Subject:</span>
                  <h3>{selectedEmail.subject || "(No subject)"}</h3>
                </div>
                <div className="detail-body-text">
                  {selectedEmail.body}
                </div>
              </div>
            </div>
            <div className="modal-footer detail-footer">
              <div className="detail-actions">
                {selectedEmail.previewUrl && (
                  <a className="schedule-button ethereal-btn" href={selectedEmail.previewUrl} target="_blank" rel="noreferrer">
                    <ArrowUpRight size={15} /> Open in Ethereal
                  </a>
                )}
                {selectedEmail.status === "FAILED" && (
                  <button className="schedule-button" onClick={() => { updateJob(selectedEmail, "retry"); setSelectedEmail(null); }}>
                    <RotateCcw size={15} /> Retry Email
                  </button>
                )}
                {selectedEmail.status === "SCHEDULED" && (
                  <button className="cancel-pill" onClick={() => { updateJob(selectedEmail, "cancel"); setSelectedEmail(null); }}>
                    <Trash2 size={15} /> Cancel Scheduled
                  </button>
                )}
              </div>
              <button className="toolbar-button" onClick={() => setSelectedEmail(null)}>Close</button>
            </div>
          </section>
        </div>
      )}

      {toast && <div className="toast" role="status"><Check size={16} />{toast}<button aria-label="Dismiss notification" onClick={() => setToast("")}><X size={14} /></button></div>}
    </main>
  );
}
