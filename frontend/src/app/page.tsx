"use client";

import {
  AlertCircle,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  FileText,
  Inbox,
  Loader2,
  LogOut,
  Mail,
  Menu,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  Send,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import React, { FormEvent, useEffect, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

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

  const recipients = findEmails(leadText);
  const scheduledCount = emails.filter((email) => ["SCHEDULED", "PENDING", "SENDING"].includes(email.status)).length;
  const sentCount = emails.filter((email) => email.status === "SENT").length;
  const visibleEmails = (searchResults || emails).filter((email) => selectedView === "scheduled"
    ? ["SCHEDULED", "PENDING", "SENDING"].includes(email.status)
    : ["SENT", "FAILED"].includes(email.status));

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
  }, [user?.id]);

  useEffect(() => {
    if (!user) return;
    const timer = window.setInterval(() => {
      apiRequest<{ emails: EmailJob[] }>("/api/jobs?take=200")
        .then((result) => setEmails(result.emails))
        .catch(() => undefined);
    }, 10000);
    return () => window.clearInterval(timer);
  }, [user?.id]);

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
  }, [search, user?.id]);

  useEffect(() => {
    if (typeof window === "undefined") return;
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
      const result = await apiRequest<{ count: number }>("/api/schedule-email", {
        method: "POST",
        headers,
        body: JSON.stringify({
          recipients,
          subject,
          body,
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
      setBody("");
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
          {googleEnabled ? (
            <a className="google-button" href={`${API_URL}/api/auth/google`}>
              <span className="google-g">G</span>
              Continue with Google
              <ArrowUpRight size={16} />
            </a>
          ) : (
            <button className="google-button demo-login-button" onClick={enterDemoWorkspace} disabled={loginBusy}>
              {loginBusy ? <Loader2 className="spin" size={16} /> : <Mail size={16} />}
              {loginBusy ? "Opening workspace..." : "Enter demo workspace"}
              <ArrowUpRight size={16} />
            </button>
          )}
          {loginError && <p className="login-error" role="alert">{loginError}</p>}
          <div className="login-foot"><span>Secure workspace</span><span>OAuth protected</span></div>
        </section>
        <aside className="login-art" aria-hidden="true">
          <div className="art-grid" />
          <div className="art-stamp"><span>RI</span><span>EMAIL<br />SCHEDULER</span></div>
          <div className="art-note"><span className="note-kicker">ON YOUR TIME</span><strong>Every send,<br />considered.</strong><span className="note-line" /></div>
          <div className="art-footer">REACHINBOX / OUTBOX LABS</div>
        </aside>
        <style jsx global>{styles}</style>
      </main>
    );
  }

  return (
    <main className="workspace">
      <aside className="sidebar">
        <a className="brand" href="#top"><span className="brand-mark"><Mail size={18} /></span><span>reachinbox</span></a>
        <div className="account-card">
          {user.avatarUrl ? <img className="avatar" src={user.avatarUrl} alt="" /> : <div className="avatar avatar-fallback">{initials(user.name, user.email)}</div>}
          <div className="account-text"><strong>{user.name || "ReachInbox user"}</strong><span>{user.email}</span></div>
          <ChevronDown size={15} />
        </div>
        <button className="compose-button" onClick={() => { setActionError(""); setComposeOpen(true); }}><Plus size={17} /> Compose email</button>
        <div className="sidebar-label">MAILBOX</div>
        <nav className="mail-nav" aria-label="Email folders">
          <button className={selectedView === "scheduled" ? "nav-link active" : "nav-link"} onClick={() => setSelectedView("scheduled")}>
            <CalendarDays size={17} /><span>Scheduled</span><span className="nav-count">{scheduledCount}</span>
          </button>
          <button className={selectedView === "sent" ? "nav-link active" : "nav-link"} onClick={() => setSelectedView("sent")}>
            <Send size={17} /><span>Sent emails</span><span className="nav-count">{sentCount}</span>
          </button>
        </nav>
        <div className="sidebar-spacer" />
        <div className="sidebar-tools">
          <button className="tool-link" onClick={() => setSenderSettingsOpen(true)}><Settings2 size={17} /><span>Senders</span><span className="sender-total">{senders.length}</span></button>
          <button className="tool-link" onClick={connectSlack} title={slackConfigured ? "Connect Slack" : "Slack OAuth setup required"}>
            <span className={slackConnected ? "slack-dot connected" : "slack-dot"} />
            <span>Slack alerts</span><span className="connect-state">{slackConnected ? "On" : slackConfigured ? "Connect" : "Setup needed"}</span>
          </button>
          {slackConnected && <button className="disconnect-link" onClick={disconnectSlack}>Disconnect Slack</button>}
        </div>
        <button className="logout-button" onClick={logout}><LogOut size={16} /><span>Sign out</span></button>
        <div className="sidebar-version">SCHEDULER / 01</div>
      </aside>

      <section className="main-column" id="top">
        <header className="topbar">
          <div className="topbar-title"><span className="workspace-overline">WORKSPACE</span><h1>{selectedView === "scheduled" ? "Scheduled emails" : "Sent emails"}</h1></div>
          <div className="topbar-actions">
            <label className="search-box"><Search size={17} /><input aria-label="Search emails" placeholder="Search emails" value={search} onChange={(event) => setSearch(event.target.value)} />{search && <button aria-label="Clear search" onClick={() => setSearch("")}><X size={14} /></button>}</label>
            <button className="icon-button" title="Refresh emails" aria-label="Refresh emails" onClick={refreshJobs}><RefreshCw size={17} className={loadingJobs ? "spin" : ""} /></button>
            <button className="user-avatar-button" title="Sign out" onClick={logout}>{user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initials(user.name, user.email)}</button>
          </div>
        </header>

        <div className="list-toolbar">
          <div className="list-caption"><span className="caption-icon">{selectedView === "scheduled" ? <Clock3 size={16} /> : <Inbox size={16} />}</span><span>{visibleEmails.length} {selectedView === "scheduled" ? "in your queue" : "messages delivered"}</span></div>
          <div className="toolbar-right"><span className="live-indicator"><i /> LIVE QUEUE</span><button className="compose-small" onClick={() => setComposeOpen(true)}><Plus size={15} /> New email</button></div>
        </div>

        {actionError && <div className="error-banner" role="alert"><AlertCircle size={16} /><span>{actionError}</span><button onClick={() => setActionError("")} aria-label="Dismiss"><X size={15} /></button></div>}

        <div className="email-list" aria-live="polite">
          {loadingJobs && emails.length === 0 ? (
            <div className="list-state"><Loader2 className="spin" size={22} /><span>Loading your emails</span></div>
          ) : visibleEmails.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">{selectedView === "scheduled" ? <CalendarDays size={22} /> : <Send size={22} />}</div>
              <h2>{search ? "No matching emails" : selectedView === "scheduled" ? "Your queue is clear" : "Nothing sent yet"}</h2>
              <p>{search ? "Try another recipient, subject, or phrase." : selectedView === "scheduled" ? "Compose a message and choose when it should go out." : "Messages will show up here once they have been sent."}</p>
              {!search && selectedView === "scheduled" && <button className="empty-cta" onClick={() => setComposeOpen(true)}><Plus size={16} /> Schedule an email</button>}
            </div>
          ) : visibleEmails.map((email, index) => (
            <article className="email-row" key={email.id} style={{ animationDelay: `${Math.min(index * 35, 280)}ms` }}>
              <div className="recipient-mark">{initials(null, email.recipient)}</div>
              <div className="email-primary"><div className="email-address">{email.recipient}</div><div className="email-subject">{email.subject || "(no subject)"}</div><div className="email-preview">{email.body}</div></div>
              <div className="email-meta"><span className={`status-pill ${email.status.toLowerCase()}`}>{email.status === "SENDING" ? "Sending" : email.status.toLowerCase()}</span><time>{displayDate(selectedView === "sent" ? email.sentAt : email.scheduledAt)}</time></div>
              <div className="row-action">
                {email.status === "FAILED" && <button title="Retry email" aria-label="Retry email" onClick={() => updateJob(email, "retry")}><RotateCcw size={16} /></button>}
                {email.status === "SCHEDULED" && <button title="Cancel scheduled email" aria-label="Cancel scheduled email" onClick={() => updateJob(email, "cancel")}><Trash2 size={16} /></button>}
                {email.previewUrl && <a title="Open Ethereal preview" aria-label="Open Ethereal preview" href={email.previewUrl} target="_blank" rel="noreferrer"><ArrowUpRight size={16} /></a>}
              </div>
            </article>
          ))}
        </div>
        <footer className="list-footer"><span>{emails.length} loaded</span><span>ReachInbox scheduler <span className="footer-dot">/</span> {user.email}</span></footer>
      </section>

      {composeOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setComposeOpen(false); }}>
        <section className="compose-modal" role="dialog" aria-modal="true" aria-labelledby="compose-heading">
          <header className="modal-header"><div className="modal-heading"><span className="modal-mark"><Mail size={17} /></span><div><span className="modal-kicker">NEW CAMPAIGN</span><h2 id="compose-heading">Compose email</h2></div></div><button className="icon-button" aria-label="Close compose" onClick={() => setComposeOpen(false)}><X size={18} /></button></header>
          <form onSubmit={scheduleEmails}>
            <div className="compose-fields">
              <label className="compose-field"><span>From</span><select value={senderId} onChange={(event) => setSenderId(event.target.value)}><option value="">Default Ethereal sender</option>{senders.map((sender) => <option key={sender.id} value={sender.id}>{sender.email}</option>)}</select></label>
              <div className="compose-field recipient-field"><span>To</span><div className="recipient-controls"><textarea value={leadText} onChange={(event) => { setLeadText(event.target.value); setFileName(""); }} placeholder="Paste email addresses or upload a lead file" rows={3} aria-label="Lead email addresses"/><label className="upload-button"><Upload size={15} /> Upload list<input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={(event) => void uploadLeads(event.target.files?.[0])} /></label></div><div className="lead-count"><span>{recipients.length} valid {recipients.length === 1 ? "address" : "addresses"} found</span>{fileName && <span className="file-name"><FileText size={13} /> {fileName}</span>}</div></div>
              <label className="compose-field"><span>Subject</span><input required maxLength={998} value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="A clear, relevant subject" /></label>
              <label className="compose-field body-field"><span>Message</span><textarea required maxLength={100000} value={body} onChange={(event) => setBody(event.target.value)} placeholder="Write a thoughtful note..." rows={6} /></label>
            </div>
            <div className="schedule-settings"><div className="settings-heading"><span>DELIVERY SETTINGS</span><span>APPLIED PER EMAIL</span></div><div className="settings-grid">
              <label className="setting-input"><span><CalendarDays size={14} /> Start time</span><input type="datetime-local" value={startAt} onChange={(event) => setStartAt(event.target.value)} /></label>
              <label className="setting-input"><span><Clock3 size={14} /> Delay between emails</span><div className="number-with-unit"><input type="number" min="0" max="86400" value={sendDelay} onChange={(event) => setSendDelay(event.target.value)} /><small>seconds</small></div></label>
              <label className="setting-input"><span><Send size={14} /> Hourly limit <em>optional</em></span><div className="number-with-unit"><input type="number" min="1" max="100000" placeholder="Sender default" value={hourlyLimit} onChange={(event) => setHourlyLimit(event.target.value)} /><small>/ hour</small></div></label>
            </div></div>
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

      {toast && <div className="toast" role="status"><Check size={16} />{toast}<button aria-label="Dismiss notification" onClick={() => setToast("")}><X size={14} /></button></div>}
      <style jsx global>{styles}</style>
    </main>
  );
}

const styles = `
  :root { --ink: #202723; --muted: #79817b; --line: #e7e9e4; --paper: #fbfcf9; --canvas: #f5f6f2; --green: #3b7958; --green-dark: #285a40; --mint: #e6f1e9; --amber: #bb7839; --red: #ad4f45; }
  * { box-sizing: border-box; }
  html, body { margin: 0; min-height: 100%; background: var(--canvas); color: var(--ink); font-family: "Avenir Next", Avenir, "Trebuchet MS", sans-serif; }
  button, input, textarea, select { font: inherit; }
  button { color: inherit; }
  .workspace { min-height: 100vh; display: grid; grid-template-columns: 250px minmax(0, 1fr); background: var(--paper); }
  .sidebar { display: flex; flex-direction: column; min-height: 100vh; padding: 25px 17px 18px; background: #f2f4ef; border-right: 1px solid #e3e6df; }
  .brand, .login-brand { display: flex; align-items: center; gap: 10px; color: #24332b; text-decoration: none; font-family: Georgia, serif; font-size: 21px; letter-spacing: 0; font-weight: 700; }
  .brand-mark { display: grid; width: 32px; height: 32px; place-items: center; color: #f9fcf8; background: #355d45; border-radius: 9px 9px 9px 3px; }
  .account-card { display: flex; align-items: center; gap: 10px; min-width: 0; margin: 32px 1px 18px; padding: 11px 10px; border: 1px solid #e2e6de; border-radius: 8px; background: rgba(255,255,255,.65); }
  .avatar { width: 34px; height: 34px; flex: 0 0 34px; border-radius: 50%; object-fit: cover; }
  .avatar-fallback { display: grid; place-items: center; color: #fff; background: #ad7950; font-size: 12px; font-weight: 700; }
  .account-text { flex: 1; min-width: 0; display: grid; gap: 3px; }
  .account-text strong { overflow: hidden; color: #303b34; font-size: 12px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
  .account-text span { overflow: hidden; color: var(--muted); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
  .account-card > :global(svg) { color: #8a928b; }
  .compose-button, .compose-small, .schedule-button, .empty-cta { display: inline-flex; align-items: center; justify-content: center; gap: 9px; border: 1px solid #2f6847; border-radius: 6px; background: #3d7955; color: white; font-size: 13px; font-weight: 650; cursor: pointer; transition: background .16s ease, transform .16s ease; }
  .compose-button { height: 43px; margin: 2px 0 30px; }
  .compose-button:hover, .compose-small:hover, .schedule-button:hover:not(:disabled), .empty-cta:hover { background: #2e6546; transform: translateY(-1px); }
  .sidebar-label, .workspace-overline, .modal-kicker, .settings-heading, .form-section-title { color: #8a928b; font-size: 9px; font-weight: 750; letter-spacing: 1.1px; }
  .sidebar-label { margin: 0 11px 9px; }
  .mail-nav { display: grid; gap: 4px; }
  .nav-link, .tool-link { display: flex; align-items: center; gap: 11px; width: 100%; min-height: 40px; padding: 0 11px; border: 0; border-radius: 6px; background: transparent; color: #57615a; text-align: left; font-size: 13px; cursor: pointer; }
  .nav-link:hover, .tool-link:hover { background: #e9ede6; color: #27382e; }
  .nav-link.active { color: #295e40; background: #e1ece3; font-weight: 700; }
  .nav-link.active :global(svg) { color: #397651; }
  .nav-count { display: grid; min-width: 24px; height: 21px; margin-left: auto; place-items: center; border-radius: 11px; color: #647168; font-size: 11px; }
  .nav-link.active .nav-count { color: #35664a; background: #d1e3d4; }
  .sidebar-spacer { flex: 1; min-height: 55px; }
  .sidebar-tools { display: grid; gap: 2px; padding-top: 11px; border-top: 1px solid #e0e4dc; }
  .tool-link { min-height: 38px; font-size: 12px; }
  .sender-total, .connect-state { margin-left: auto; color: #858f87; font-size: 10px; }
  .slack-dot { width: 8px; height: 8px; margin-left: 4px; border-radius: 50%; background: #b7bdb8; box-shadow: 0 0 0 3px #e5e8e3; }
  .slack-dot.connected { background: #43a174; box-shadow: 0 0 0 3px #d8ebdf; }
  .disconnect-link { justify-self: start; margin: 0 0 4px 34px; padding: 3px 0; border: 0; background: none; color: #838a84; font-size: 10px; cursor: pointer; }
  .logout-button { display: flex; align-items: center; gap: 10px; width: 100%; margin-top: 13px; padding: 10px 11px; border: 0; border-radius: 6px; background: transparent; color: #69736c; text-align: left; font-size: 12px; cursor: pointer; }
  .logout-button:hover { background: #e9ede6; color: #2d3b32; }
  .sidebar-version { margin: 10px 11px 0; color: #9da49e; font-size: 8px; letter-spacing: .9px; }
  .main-column { display: flex; min-width: 0; min-height: 100vh; flex-direction: column; }
  .topbar { display: flex; min-height: 98px; align-items: center; justify-content: space-between; gap: 25px; padding: 20px clamp(22px, 4vw, 62px); border-bottom: 1px solid var(--line); }
  .topbar-title { display: grid; gap: 5px; }
  .workspace-overline { color: #9aa19b; font-size: 8px; }
  .topbar h1 { margin: 0; color: #28342d; font-family: Georgia, serif; font-size: 24px; font-weight: 500; }
  .topbar-actions { display: flex; align-items: center; gap: 11px; }
  .search-box { display: flex; width: min(270px, 28vw); height: 37px; align-items: center; gap: 8px; padding: 0 11px; border: 1px solid #e3e7e0; border-radius: 6px; background: #fff; color: #879088; }
  .search-box input { width: 100%; min-width: 0; border: 0; outline: 0; background: transparent; color: #39443c; font-size: 12px; }
  .search-box input::placeholder { color: #a5aca6; }
  .search-box button, .icon-button { display: grid; flex: 0 0 auto; place-items: center; padding: 0; border: 0; background: transparent; color: #79837b; cursor: pointer; }
  .icon-button { width: 35px; height: 35px; border: 1px solid #e3e7e0; border-radius: 6px; background: white; }
  .icon-button:hover { color: #315f43; border-color: #bfd3c4; }
  .user-avatar-button { display: grid; width: 34px; height: 34px; place-items: center; overflow: hidden; border: 0; border-radius: 50%; background: #c28b5e; color: white; font-size: 11px; font-weight: 700; cursor: pointer; }
  .user-avatar-button img { width: 100%; height: 100%; object-fit: cover; }
  .list-toolbar { display: flex; min-height: 62px; align-items: center; justify-content: space-between; gap: 14px; padding: 0 clamp(22px, 4vw, 62px); border-bottom: 1px solid var(--line); }
  .list-caption, .toolbar-right { display: flex; align-items: center; gap: 10px; color: #788078; font-size: 11px; }
  .caption-icon { display: grid; width: 26px; height: 26px; place-items: center; border-radius: 6px; background: #eef2ec; color: #56725e; }
  .live-indicator { display: inline-flex; align-items: center; gap: 6px; color: #839088; font-size: 8px; font-weight: 750; letter-spacing: .8px; }
  .live-indicator i { width: 6px; height: 6px; border-radius: 50%; background: #68a57a; box-shadow: 0 0 0 3px #e1eee3; }
  .compose-small { min-height: 32px; padding: 0 11px; font-size: 11px; }
  .error-banner { display: flex; align-items: center; gap: 9px; margin: 13px clamp(22px, 4vw, 62px) 0; padding: 10px 12px; border: 1px solid #f0d0cb; border-radius: 5px; background: #fff7f5; color: #9d4d43; font-size: 12px; }
  .error-banner span { flex: 1; }
  .error-banner button { display: grid; place-items: center; border: 0; background: none; color: inherit; cursor: pointer; }
  .email-list { flex: 1; padding: 0 clamp(22px, 4vw, 62px); }
  .email-row { display: grid; grid-template-columns: 36px minmax(0, 1fr) minmax(120px, 180px) 30px; align-items: center; gap: 14px; min-height: 91px; border-bottom: 1px solid #eceeea; animation: row-in .32s ease both; }
  @keyframes row-in { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
  .recipient-mark { display: grid; width: 32px; height: 32px; place-items: center; border: 1px solid #e5e8e1; border-radius: 50%; background: #f4f2e9; color: #776b51; font-size: 10px; font-weight: 700; }
  .email-primary { display: grid; min-width: 0; gap: 4px; }
  .email-address { overflow: hidden; color: #323c35; font-size: 12px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
  .email-subject { overflow: hidden; color: #566159; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
  .email-preview { overflow: hidden; color: #9aa19b; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
  .email-meta { display: grid; justify-items: end; gap: 8px; }
  .email-meta time { color: #8b938d; font-size: 10px; white-space: nowrap; }
  .status-pill { display: inline-flex; align-items: center; min-height: 19px; padding: 0 7px; border-radius: 3px; background: #e8f1e9; color: #39744d; font-size: 9px; font-weight: 700; text-transform: capitalize; }
  .status-pill.sending, .status-pill.pending { background: #f5eddf; color: #98713b; }
  .status-pill.failed { background: #f7e9e5; color: #a35448; }
  .status-pill.sent { background: #e6f1e9; color: #39744d; }
  .row-action { display: flex; justify-content: end; gap: 5px; }
  .row-action button, .row-action a { display: grid; width: 28px; height: 28px; place-items: center; border: 1px solid transparent; border-radius: 5px; background: transparent; color: #89928b; cursor: pointer; }
  .row-action button:hover, .row-action a:hover { border-color: #e0e6de; background: #f1f4ef; color: #4b6d53; }
  .list-state, .empty-state { display: flex; min-height: 300px; align-items: center; justify-content: center; flex-direction: column; gap: 12px; color: #89938a; font-size: 12px; }
  .empty-state { padding: 34px 20px; text-align: center; }
  .empty-icon { display: grid; width: 48px; height: 48px; place-items: center; border: 1px solid #e1e8df; border-radius: 14px 14px 14px 4px; background: #eff4ee; color: #5f8066; }
  .empty-state h2 { margin: 4px 0 0; color: #354239; font-family: Georgia, serif; font-size: 20px; font-weight: 500; }
  .empty-state p { max-width: 320px; margin: 0; color: #8b958d; font-size: 12px; line-height: 1.6; }
  .empty-cta { min-height: 35px; margin-top: 8px; padding: 0 12px; font-size: 11px; }
  .list-footer { display: flex; justify-content: space-between; gap: 15px; padding: 15px clamp(22px, 4vw, 62px); color: #a0a7a0; font-size: 9px; }
  .footer-dot { padding: 0 5px; color: #6a9574; }
  .modal-backdrop { position: fixed; z-index: 20; inset: 0; display: grid; place-items: center; overflow: auto; padding: 24px; background: rgba(24, 32, 27, .42); backdrop-filter: blur(3px); animation: backdrop-in .18s ease; }
  @keyframes backdrop-in { from { opacity: 0; } to { opacity: 1; } }
  .compose-modal, .sender-modal { width: min(770px, 100%); max-height: min(92vh, 900px); overflow: auto; border: 1px solid #e1e5df; border-radius: 9px; background: #fcfdfa; box-shadow: 0 24px 80px rgba(18, 31, 22, .2); animation: modal-in .22s ease both; }
  @keyframes modal-in { from { opacity: 0; transform: translateY(9px) scale(.99); } to { opacity: 1; transform: translateY(0) scale(1); } }
  .modal-header { display: flex; min-height: 72px; align-items: center; justify-content: space-between; padding: 13px 22px; border-bottom: 1px solid var(--line); }
  .modal-heading { display: flex; align-items: center; gap: 12px; }
  .modal-mark { display: grid; width: 34px; height: 34px; place-items: center; border-radius: 8px; background: #e7f0e8; color: #417350; }
  .sender-mark { background: #f3ede2; color: #98723f; }
  .modal-kicker { display: block; margin-bottom: 4px; color: #869087; font-size: 8px; }
  .modal-heading h2 { margin: 0; color: #2b382f; font-family: Georgia, serif; font-size: 19px; font-weight: 500; }
  .compose-fields { display: grid; gap: 0; padding: 13px 22px 7px; }
  .compose-field { display: grid; grid-template-columns: 78px minmax(0, 1fr); align-items: start; gap: 12px; padding: 12px 0; border-bottom: 1px solid #edf0eb; }
  .compose-field > span { padding-top: 9px; color: #707a72; font-size: 11px; font-weight: 650; }
  .compose-field input, .compose-field select, .compose-field textarea { width: 100%; min-width: 0; padding: 9px 10px; border: 1px solid #e3e7e0; border-radius: 5px; outline: none; background: white; color: #364139; font-size: 12px; }
  .compose-field input:focus, .compose-field select:focus, .compose-field textarea:focus, .setting-input input:focus { border-color: #93b29a; box-shadow: 0 0 0 3px #e9f1e9; }
  .compose-field input::placeholder, .compose-field textarea::placeholder { color: #a6ada6; }
  .compose-field textarea { resize: vertical; line-height: 1.55; }
  .recipient-controls { display: grid; gap: 8px; }
  .recipient-controls textarea { min-height: 65px; }
  .upload-button { display: inline-flex; width: fit-content; align-items: center; gap: 6px; padding: 6px 9px; border: 1px solid #e2e8e0; border-radius: 4px; color: #53715a; background: #f7faf6; font-size: 10px; cursor: pointer; }
  .upload-button input { display: none; }
  .lead-count { display: flex; grid-column: 2; justify-content: space-between; gap: 10px; color: #63816a; font-size: 10px; }
  .file-name { display: inline-flex; align-items: center; gap: 4px; overflow: hidden; color: #8a938b; text-overflow: ellipsis; white-space: nowrap; }
  .body-field textarea { min-height: 126px; }
  .schedule-settings { padding: 14px 22px 18px; background: #f5f7f3; }
  .settings-heading { display: flex; justify-content: space-between; margin-bottom: 11px; color: #879188; font-size: 8px; }
  .settings-heading span:last-child { color: #a3aaa3; font-weight: 600; letter-spacing: .5px; }
  .settings-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
  .setting-input { display: grid; min-width: 0; gap: 7px; }
  .setting-input > span { display: flex; align-items: center; gap: 6px; color: #68736b; font-size: 10px; font-weight: 650; }
  .setting-input > span :global(svg) { color: #78927d; }
  .setting-input em { margin-left: auto; color: #a2aaa2; font-size: 8px; font-style: normal; font-weight: 500; }
  .setting-input input { width: 100%; min-width: 0; height: 34px; padding: 0 8px; border: 1px solid #e1e6de; border-radius: 4px; outline: none; background: white; color: #3b463e; font-size: 10px; }
  .number-with-unit { display: flex; align-items: center; gap: 5px; min-width: 0; }
  .number-with-unit input { flex: 1; width: 40px; }
  .number-with-unit small { color: #969e97; font-size: 9px; white-space: nowrap; }
  .modal-footer { display: flex; min-height: 65px; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 22px; }
  .queue-note { display: inline-flex; align-items: center; gap: 6px; color: #78867b; font-size: 10px; }
  .queue-note :global(svg) { color: #548563; }
  .schedule-button { min-height: 37px; padding: 0 13px; font-size: 11px; }
  .schedule-button:disabled { border-color: #c9d2ca; background: #cbd5cc; cursor: not-allowed; }
  .sender-modal { width: min(620px, 100%); }
  .sender-existing { display: grid; gap: 1px; padding: 12px 22px; }
  .sender-item { display: flex; align-items: center; gap: 10px; min-height: 50px; border-bottom: 1px solid #eef0ec; }
  .sender-avatar { display: grid; width: 30px; height: 30px; place-items: center; border-radius: 7px; background: #f2f2e9; color: #7f7751; }
  .sender-detail { display: grid; flex: 1; min-width: 0; gap: 3px; }
  .sender-detail strong { overflow: hidden; color: #39443d; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
  .sender-detail small { overflow: hidden; color: #8d978f; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
  .sender-item > button { display: grid; width: 29px; height: 29px; place-items: center; border: 0; border-radius: 4px; background: transparent; color: #929a93; cursor: pointer; }
  .sender-item > button:hover { background: #f8eae7; color: #a64e42; }
  .no-senders { margin: 5px 0; color: #879188; font-size: 11px; }
  .sender-form { padding: 15px 22px 20px; border-top: 1px solid var(--line); background: #f7f8f5; }
  .form-section-title { display: flex; align-items: center; gap: 7px; margin-bottom: 12px; color: #6f7e72; font-size: 9px; }
  .sender-form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .sender-form-grid label { display: grid; min-width: 0; gap: 5px; }
  .sender-form-grid label > span { color: #707a72; font-size: 9px; font-weight: 650; }
  .sender-form-grid input { height: 33px; min-width: 0; padding: 0 8px; border: 1px solid #e2e6df; border-radius: 4px; outline: 0; background: white; color: #364139; font-size: 11px; }
  .sender-footer { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 14px; }
  .sender-footer > span { color: #879188; font-size: 9px; }
  .toast { position: fixed; z-index: 50; right: 22px; bottom: 20px; display: flex; align-items: center; gap: 9px; max-width: min(420px, calc(100vw - 32px)); padding: 12px 13px; border: 1px solid #d8e5d9; border-radius: 6px; background: #f4faf4; box-shadow: 0 9px 30px rgba(30, 54, 37, .12); color: #42664a; font-size: 11px; animation: modal-in .2s ease both; }
  .toast button { display: grid; margin-left: 5px; place-items: center; border: 0; background: transparent; color: #7a8a7d; cursor: pointer; }
  .login-page { display: grid; min-height: 100vh; grid-template-columns: minmax(360px, .88fr) 1.12fr; background: #f4f6f1; }
  .login-panel { display: flex; width: min(100%, 530px); min-height: 100vh; flex-direction: column; justify-self: center; padding: clamp(30px, 5vw, 68px); background: #fbfcf9; }
  .login-brand { font-size: 20px; }
  .login-copy { margin: auto 0 40px; }
  .eyebrow { color: #6f8e73; font-size: 9px; font-weight: 750; letter-spacing: 1.4px; }
  .login-copy h1 { max-width: 440px; margin: 18px 0 13px; color: #25362b; font-family: Georgia, serif; font-size: clamp(36px, 4.2vw, 54px); font-weight: 400; line-height: 1.08; }
  .login-copy p { max-width: 360px; margin: 0; color: #818b82; font-size: 13px; line-height: 1.7; }
  .google-button { display: flex; min-height: 48px; align-items: center; justify-content: center; gap: 11px; padding: 0 14px; border: 1px solid #dfe5dc; border-radius: 5px; background: white; color: #344238; text-decoration: none; font-size: 12px; font-weight: 650; transition: border-color .16s, background .16s; }
  .google-button:hover { border-color: #a9c1ac; background: #f7faf6; }
  .demo-login-button { width: 100%; cursor: pointer; }
  .demo-login-button:disabled { opacity: .7; cursor: wait; }
  .login-error { margin: 10px 0 0; color: #a54e45; font-size: 11px; }
  .google-g { color: #4285f4; font-family: Arial, sans-serif; font-size: 16px; font-weight: 800; }
  .google-button :global(svg) { margin-left: auto; color: #7b8a7d; }
  .login-foot { display: flex; justify-content: space-between; margin-top: 18px; color: #a1a9a1; font-size: 9px; }
  .login-art { position: relative; display: flex; min-height: 100vh; overflow: hidden; align-items: end; padding: clamp(35px, 6vw, 80px); background: #385943; color: #f5f4e9; }
  .art-grid { position: absolute; inset: 0; opacity: .15; background-image: linear-gradient(rgba(255,255,255,.22) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.22) 1px, transparent 1px); background-size: 52px 52px; mask-image: linear-gradient(135deg, black, transparent 76%); }
  .art-stamp { position: absolute; top: 10%; right: 10%; display: flex; align-items: center; gap: 9px; color: #dce8d9; font-size: 8px; font-weight: 700; letter-spacing: 1px; line-height: 1.5; }
  .art-stamp span:first-child { display: grid; width: 37px; height: 37px; place-items: center; border: 1px solid rgba(235,241,226,.45); border-radius: 50%; font-family: Georgia, serif; font-size: 14px; }
  .art-note { position: relative; z-index: 1; display: grid; gap: 15px; margin-bottom: 20px; }
  .note-kicker { color: #c0d0b9; font-size: 9px; font-weight: 700; letter-spacing: 1.5px; }
  .art-note strong { color: #f3f1df; font-family: Georgia, serif; font-size: clamp(38px, 6vw, 78px); font-weight: 400; line-height: .98; }
  .note-line { width: 56px; height: 2px; margin-top: 8px; background: #d6ad72; }
  .art-footer { position: absolute; right: 35px; bottom: 26px; color: #c0d0bf; font-size: 8px; letter-spacing: 1.1px; }
  .auth-loading { display: flex; min-height: 100vh; align-items: center; justify-content: center; gap: 9px; background: #f6f7f3; color: #718075; font-size: 12px; }
  .spin { animation: spin .9s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (max-width: 820px) {
    .workspace { grid-template-columns: 205px minmax(0, 1fr); }
    .sidebar { padding-inline: 12px; }
    .account-card { gap: 7px; padding-inline: 7px; }
    .email-row { grid-template-columns: 32px minmax(0, 1fr) 112px 26px; gap: 9px; }
    .email-meta time { font-size: 9px; }
    .topbar { padding-inline: 22px; }
    .login-page { grid-template-columns: 1fr 1fr; }
  }
  @media (max-width: 620px) {
    .workspace { display: flex; flex-direction: column; }
    .sidebar { min-height: auto; display: grid; grid-template-columns: 1fr auto; gap: 0 12px; padding: 12px 15px; border-right: 0; border-bottom: 1px solid #e2e6df; }
    .brand { font-size: 18px; }
    .brand-mark { width: 29px; height: 29px; }
    .account-card { display: none; }
    .compose-button { width: auto; height: 34px; margin: 0; padding: 0 9px; font-size: 10px; }
    .sidebar-label, .sidebar-spacer, .logout-button, .sidebar-version { display: none; }
    .mail-nav { grid-column: 1 / -1; grid-row: 2; display: flex; gap: 5px; margin-top: 11px; }
    .nav-link { width: auto; min-height: 34px; gap: 7px; padding: 0 9px; font-size: 10px; }
    .nav-link :global(svg) { width: 14px; }
    .nav-count { min-width: 18px; height: 17px; font-size: 9px; }
    .sidebar-tools { grid-column: 1 / -1; grid-row: 3; display: flex; align-items: center; justify-content: flex-start; gap: 8px; margin-top: 6px; padding-top: 6px; border-top: 1px solid #e0e4dc; }
    .sidebar-tools .tool-link { width: auto; min-height: 30px; gap: 6px; padding: 0 8px; font-size: 10px; }
    .sidebar-tools .sender-total, .sidebar-tools .connect-state { font-size: 9px; }
    .sidebar-tools .disconnect-link { margin: 0 8px 0 auto; }
    .main-column { min-height: calc(100vh - 110px); }
    .topbar { min-height: 76px; gap: 10px; padding: 12px 15px; }
    .topbar h1 { font-size: 19px; }
    .workspace-overline { font-size: 7px; }
    .topbar-actions { gap: 6px; }
    .search-box { width: min(38vw, 170px); height: 33px; gap: 5px; padding-inline: 7px; }
    .search-box input { font-size: 10px; }
    .search-box :global(svg) { width: 14px; }
    .icon-button { width: 31px; height: 31px; }
    .user-avatar-button { width: 30px; height: 30px; }
    .list-toolbar { min-height: 53px; padding-inline: 15px; }
    .list-caption { gap: 7px; font-size: 9px; }
    .caption-icon { width: 23px; height: 23px; }
    .live-indicator { display: none; }
    .compose-small { min-height: 29px; gap: 5px; padding-inline: 8px; font-size: 9px; }
    .email-list { padding-inline: 15px; }
    .email-row { grid-template-columns: 28px minmax(0, 1fr) 25px; gap: 8px; min-height: 80px; }
    .recipient-mark { width: 27px; height: 27px; font-size: 9px; }
    .email-primary { gap: 4px; }
    .email-address, .email-subject { font-size: 10px; }
    .email-preview { font-size: 9px; }
    .email-meta { grid-column: 2; grid-row: 2; display: flex; justify-content: space-between; justify-items: start; gap: 7px; margin-top: -19px; }
    .email-meta time { font-size: 8px; }
    .status-pill { min-height: 16px; padding-inline: 5px; font-size: 8px; }
    .row-action { grid-column: 3; grid-row: 1 / span 2; }
    .list-footer { padding: 13px 15px; font-size: 8px; }
    .modal-backdrop { align-items: end; padding: 0; }
    .compose-modal, .sender-modal { width: 100%; max-height: 94vh; border-radius: 11px 11px 0 0; }
    .modal-header { min-height: 63px; padding-inline: 15px; }
    .compose-fields { padding-inline: 15px; }
    .compose-field { grid-template-columns: 53px minmax(0, 1fr); gap: 8px; }
    .compose-field > span { font-size: 10px; }
    .schedule-settings { padding: 13px 15px 15px; }
    .settings-grid { grid-template-columns: 1fr; gap: 11px; }
    .setting-input { grid-template-columns: 1fr 1fr; align-items: center; }
    .setting-input > span { font-size: 10px; }
    .setting-input input { height: 33px; }
    .modal-footer { padding-inline: 15px; }
    .sender-existing, .sender-form { padding-inline: 15px; }
    .sender-form-grid { grid-template-columns: 1fr 1fr; }
    .login-page { display: flex; flex-direction: column; }
    .login-panel { width: 100%; min-height: 58vh; padding: 28px 25px 25px; }
    .login-copy { margin: 70px 0 30px; }
    .login-copy h1 { max-width: 350px; font-size: 41px; }
    .login-art { min-height: 42vh; padding: 24px; }
    .art-stamp { top: 11%; right: 8%; }
    .art-note strong { font-size: 44px; }
    .art-footer { right: 18px; bottom: 16px; font-size: 7px; }
  }
  @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; scroll-behavior: auto !important; } }
`;
