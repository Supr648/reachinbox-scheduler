"use client";

import React, { useState, useEffect } from "react";
import axios from "axios";

const API_BASE = "http://localhost:5000/api";

interface EmailJob {
  id: string;
  recipient: string;
  subject: string;
  body: string;
  scheduledAt: string;
  sentAt?: string;
  status: "SCHEDULED" | "PENDING" | "SENT" | "FAILED";
  errorReason?: string;
  previewUrl?: string;
}

interface Template {
  id: string;
  title: string;
  subject: string;
  body: string;
}

export default function Dashboard() {
  const [jobs, setJobs] = useState<EmailJob[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);

  const [userEmail] = useState("admin@reachinbox.com");
  const [recipient, setRecipient] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [delayInSeconds, setDelayInSeconds] = useState(10);
  const [scheduling, setScheduling] = useState(false);

  const [firstName, setFirstName] = useState("John");
  const [company, setCompany] = useState("Acme Corp");

  const [newTitle, setNewTitle] = useState("");
  const [newSubject, setNewSubject] = useState("");
  const [newBody, setNewBody] = useState("");
  const [showTemplateModal, setShowTemplateModal] = useState(false);

  const fetchJobs = async () => {
    try {
      setLoading(true);
      const res = await axios.get(`${API_BASE}/jobs`);
      setJobs(res.data);
    } catch (err) {
      console.error("Failed to fetch jobs", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchTemplates = async () => {
    try {
      const res = await axios.get(`${API_BASE}/templates`);
      setTemplates(res.data);
    } catch (err) {
      console.error("Failed to fetch templates", err);
    }
  };

  const handleSelectTemplate = (templateId: string) => {
    setSelectedTemplateId(templateId);
    const tmpl = templates.find((t) => t.id === templateId);
    if (tmpl) {
      setSubject(tmpl.subject);
      setBody(tmpl.body);
    }
  };

  const handleSaveTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await axios.post(`${API_BASE}/templates`, {
        title: newTitle,
        subject: newSubject,
        body: newBody,
      });
      setNewTitle("");
      setNewSubject("");
      setNewBody("");
      setShowTemplateModal(false);
      fetchTemplates();
    } catch (err) {
      alert("Failed to save template");
    }
  };

  const handleDeleteTemplate = async (id: string) => {
    try {
      await axios.delete(`${API_BASE}/templates/${id}`);
      fetchTemplates();
    } catch (err) {
      alert("Failed to delete template");
    }
  };

  const handleSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setScheduling(true);
      await axios.post(`${API_BASE}/schedule-email`, {
        userEmail,
        recipient,
        subject,
        body,
        delayInSeconds: Number(delayInSeconds),
        variables: { firstName, company },
      });
      setRecipient("");
      setSubject("");
      setBody("");
      setSelectedTemplateId("");
      fetchJobs();
    } catch (err) {
      alert("Failed to schedule email");
    } finally {
      setScheduling(false);
    }
  };

  const handleCancel = async (id: string) => {
    if (!confirm("Cancel this scheduled email?")) return;
    try {
      await axios.delete(`${API_BASE}/jobs/${id}`);
      fetchJobs();
    } catch (err: any) {
      alert(err.response?.data?.error || "Failed to cancel job");
    }
  };

  const handleRetry = async (id: string) => {
    try {
      await axios.post(`${API_BASE}/jobs/${id}/retry`);
      fetchJobs();
    } catch (err: any) {
      alert(err.response?.data?.error || "Failed to retry job");
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) {
      fetchJobs();
      return;
    }
    try {
      setLoading(true);
      const res = await axios.get(`${API_BASE}/search?q=${encodeURIComponent(searchQuery)}`);
      setJobs(res.data.results || []);
    } catch (err) {
      console.error("Search failed", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
    fetchTemplates();
    const interval = setInterval(fetchJobs, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{ maxWidth: "1100px", margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
        <div>
          <h1 style={{ fontSize: "2rem", fontWeight: "800", background: "linear-gradient(to right, #818cf8, #c084fc)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            ReachInbox Scheduler
          </h1>
          <p style={{ color: "#94a3b8", fontSize: "0.9rem" }}>Enterprise Email Queue & Search Engine</p>
        </div>
        <button className="btn-gradient" onClick={() => setShowTemplateModal(!showTemplateModal)}>
          {showTemplateModal ? "Close Template Manager" : "+ Create Template"}
        </button>
      </div>

      {showTemplateModal && (
        <form onSubmit={handleSaveTemplate} className="glass-card" style={{ display: "grid", gap: "1rem", marginBottom: "2rem" }}>
          <h3 style={{ color: "#a855f7" }}>New Email Template</h3>
          <input
            className="input-styled"
            type="text"
            placeholder="Template Title (e.g., Cold Outreach)"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            required
          />
          <input
            className="input-styled"
            type="text"
            placeholder="Subject (e.g., Quick question for {{firstName}})"
            value={newSubject}
            onChange={(e) => setNewSubject(e.target.value)}
            required
          />
          <textarea
            className="input-styled"
            placeholder="Body (e.g., Hi {{firstName}}, loved your work at {{company}}!)"
            value={newBody}
            onChange={(e) => setNewBody(e.target.value)}
            required
            rows={3}
          />
          <button type="submit" className="btn-gradient">Save Template</button>
        </form>
      )}

      <div className="glass-card" style={{ marginBottom: "2rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
          <h3 style={{ fontSize: "1.25rem" }}>Schedule Email Job</h3>

          {templates.length > 0 && (
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <select
                className="input-styled"
                value={selectedTemplateId}
                onChange={(e) => handleSelectTemplate(e.target.value)}
                style={{ padding: "0.4rem 0.8rem", fontSize: "0.85rem" }}
              >
                <option value="">Load Saved Template...</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.title}</option>
                ))}
              </select>
              {selectedTemplateId && (
                <button type="button" className="btn-danger" onClick={() => handleDeleteTemplate(selectedTemplateId)}>
                  Delete
                </button>
              )}
            </div>
          )}
        </div>

        <form onSubmit={handleSchedule} style={{ display: "grid", gap: "1rem" }}>
          <input
            className="input-styled"
            type="email"
            placeholder="Recipient Email Address"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            required
          />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <input
              className="input-styled"
              type="text"
              placeholder="Variable: {{firstName}}"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
            />
            <input
              className="input-styled"
              type="text"
              placeholder="Variable: {{company}}"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
            />
          </div>

          <input
            className="input-styled"
            type="text"
            placeholder="Subject Line"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            required
          />
          <textarea
            className="input-styled"
            placeholder="Email Body Content"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
            rows={3}
          />

          <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
            <label style={{ fontSize: "0.9rem", color: "#94a3b8" }}>Delay (Seconds):</label>
            <input
              className="input-styled"
              type="number"
              value={delayInSeconds}
              onChange={(e) => setDelayInSeconds(Number(e.target.value))}
              min={1}
              style={{ width: "90px" }}
            />
            <button type="submit" className="btn-gradient" disabled={scheduling}>
              {scheduling ? "Queuing..." : "Dispatch Email"}
            </button>
          </div>
        </form>
      </div>

      <form onSubmit={handleSearch} style={{ display: "flex", gap: "0.75rem", marginBottom: "1.5rem" }}>
        <input
          className="input-styled"
          type="text"
          placeholder="Search queued emails with Elasticsearch..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ flex: 1 }}
        />
        <button type="submit" className="btn-gradient">Search</button>
        <button type="button" className="input-styled" onClick={fetchJobs} style={{ cursor: "pointer" }}>Reset</button>
      </form>

      <div className="glass-card" style={{ padding: "1rem" }}>
        <h3 style={{ padding: "0.75rem 1rem", fontSize: "1.1rem", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
          Queue Activity Log {loading && <span style={{ fontSize: "0.8rem", color: "#818cf8" }}>(Refreshing...)</span>}
        </h3>
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "0.5rem" }}>
          <thead>
            <tr style={{ color: "#94a3b8", textAlign: "left", fontSize: "0.85rem", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
              <th style={{ padding: "0.75rem 1rem" }}>Recipient</th>
              <th style={{ padding: "0.75rem 1rem" }}>Subject</th>
              <th style={{ padding: "0.75rem 1rem" }}>Status</th>
              <th style={{ padding: "0.75rem 1rem" }}>Scheduled At</th>
              <th style={{ padding: "0.75rem 1rem" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                <td style={{ padding: "0.85rem 1rem" }}>{job.recipient}</td>
                <td style={{ padding: "0.85rem 1rem" }}>{job.subject}</td>
                <td style={{ padding: "0.85rem 1rem" }}>
                  <span className={`badge badge-${job.status.toLowerCase()}`}>
                    ? {job.status}
                  </span>
                </td>
                <td style={{ padding: "0.85rem 1rem", color: "#94a3b8", fontSize: "0.85rem" }}>
                  {new Date(job.scheduledAt).toLocaleTimeString()}
                </td>
                <td style={{ padding: "0.85rem 1rem", display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  {job.status === "SCHEDULED" && (
                    <button className="btn-danger" onClick={() => handleCancel(job.id)}>Cancel</button>
                  )}
                  {job.status === "FAILED" && (
                    <button className="btn-warning" onClick={() => handleRetry(job.id)}>Retry</button>
                  )}
                  {job.previewUrl ? (
                    <a href={job.previewUrl} target="_blank" rel="noreferrer" style={{ color: "#818cf8", fontWeight: "600", fontSize: "0.85rem" }}>
                      View Email ?
                    </a>
                  ) : (
                    job.status !== "SCHEDULED" && job.status !== "FAILED" && "-"
                  )}
                </td>
              </tr>
            ))}
            {jobs.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: "center", padding: "2rem", color: "#94a3b8" }}>
                  No email jobs in queue.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
