import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CalendarDays, ExternalLink, ChevronDown, Clock3, FileText, Filter, Paperclip, RefreshCw, Search, Send, Star, Upload, X } from "lucide-react";

type User = { id: string; email: string; name: string; avatarUrl?: string | null };
type Sender = { id: string; email: string; name?: string | null };
type Status = "SCHEDULED" | "PROCESSING" | "SENT" | "FAILED" | "CANCELLED";
type EmailJob = {
  id: string;
  recipient: string;
  subject: string;
  body: string;
  scheduledAt: string;
  sentAt?: string | null;
  status: Status;
  failureReason?: string | null;
  previewUrl?: string | null;
  sender: Sender;
};
type Folder = "scheduled" | "sent" | "failed";

const api = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const { headers: extraHeaders, ...restInit } = init ?? {};
  const isFormData = restInit.body instanceof FormData;
  const defaultHeaders: Record<string, string> = isFormData ? {} : { "Content-Type": "application/json" };
  const response = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { ...defaultHeaders, ...(extraHeaders ?? {}) },
    ...restInit,
  });
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({ error: "Request failed" }));
    throw new Error(errorBody.error ?? "Request failed");
  }
  return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>);
};

const statusLabel = (status: Status) => status.charAt(0) + status.slice(1).toLowerCase();

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [screen, setScreen] = useState<"inbox" | "compose" | "detail">("inbox");
  const [folder, setFolder] = useState<Folder>("scheduled");
  const [emails, setEmails] = useState<EmailJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<EmailJob | null>(null);

  const loadEmails = async () => {
    if (!user) return;
    setLoading(true);
    setError("");
    try {
      setEmails((await api<{ emails: EmailJob[] }>(`/emails?status=${folder}`)).emails);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load emails");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    api<{ user: User }>("/auth/me")
      .then(({ user: current }) => setUser(current))
      .catch(() => setUser(null))
      .finally(() => setCheckingAuth(false));
  }, []);

  useEffect(() => {
    void loadEmails();
  }, [user, folder]);

  const visible = useMemo(() => {
    const term = search.toLowerCase().trim();
    return term
      ? emails.filter((email) => `${email.recipient} ${email.subject} ${email.body}`.toLowerCase().includes(term))
      : emails;
  }, [emails, search]);

  if (checkingAuth) return <main className="login-page"><p className="loading-text">Loading ReachX…</p></main>;
  if (!user) return <Login onLoginSuccess={(u) => setUser(u)} />;
  if (screen === "compose") return <Compose user={user} onBack={() => { setScreen("inbox"); void loadEmails(); }} />;
  if (screen === "detail" && selected) return <MessageDetail message={selected} onBack={() => setScreen("inbox")} />;

  return (
    <div className="app-shell">
      <Sidebar
        user={user}
        folder={folder}
        setFolder={setFolder}
        onCompose={() => setScreen("compose")}
        onLogout={async () => {
          await api("/auth/logout", { method: "POST" });
          setUser(null);
        }}
      />
      <main className="mailbox">
        <div className="search-row">
          <label className="search-box">
            <Search size={15} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search" />
          </label>
          <button className="icon-button" aria-label="Filter"><Filter size={15} /></button>
          <button className="icon-button" onClick={() => void loadEmails()} aria-label="Refresh"><RefreshCw size={15} /></button>
        </div>
        {error && <p className="page-error">{error}</p>}
        {loading ? (
          <p className="loading-text">Loading emails…</p>
        ) : (
          <section className="message-list">
            {visible.length ? (
              visible.map((message) => (
                <button className="message-row" key={message.id} onClick={() => { setSelected(message); setScreen("detail"); }}>
                  <span className="message-to">To: {message.recipient}</span>
                  <span className={`status-pill ${message.status === "SCHEDULED" ? "scheduled" : "sent"}`}>
                    {message.status === "SCHEDULED" && <Clock3 size={11} />}
                    {message.status === "SCHEDULED" ? new Date(message.scheduledAt).toLocaleString() : statusLabel(message.status)}
                  </span>
                  <span className="message-subject">{message.subject}</span>
                  <span className="message-preview"> - {message.body}</span>
                  <Star size={16} className="row-star" />
                </button>
              ))
            ) : (
              <EmptyState folder={folder} />
            )}
          </section>
        )}
      </main>
    </div>
  );
}

function Login({ onLoginSuccess }: { onLoginSuccess: (user: User) => void }) {
  const query = new URLSearchParams(window.location.search);
  const [loggingIn, setLoggingIn] = useState(false);
  const [error, setError] = useState("");

  const handleDemoLogin = async () => {
    setLoggingIn(true);
    setError("");
    try {
      const { user } = await api<{ user: User }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: "oliver.brown@domain.io", password: "password123" }),
      });
      onLoginSuccess(user);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed");
    } finally {
      setLoggingIn(false);
    }
  };

  return (
    <main className="login-page">
      <section className="login-card">
        <h1>ReachX Login</h1>
        <p className="login-copy">Sign in to manage scheduled email delivery.</p>
        {query.get("authError") && <p className="form-error">Google OAuth not completed. You can use Quick Demo Login below.</p>}
        {error && <p className="form-error">{error}</p>}
        <a className="google-button" href="/api/auth/google">
          <svg width="16" height="16" viewBox="0 0 48 48" style={{ marginRight: "10px" }}>
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.7 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          Continue with Google
        </a>
        <button type="button" className="minimal-text-button" onClick={handleDemoLogin} disabled={loggingIn}>
          {loggingIn ? "Signing in…" : "or test locally (Oliver Brown)"}
        </button>
        <p className="login-hint" style={{ marginTop: "auto", fontSize: "10px", color: "#b9bdc3", textAlign: "center" }}>
          Google OAuth requires GCP Client ID & Secret in .env file.
        </p>
      </section>
    </main>
  );
}

function Sidebar({ user, folder, setFolder, onCompose, onLogout }: { user: User; folder: Folder; setFolder: (value: Folder) => void; onCompose: () => void; onLogout: () => void }) {
  return (
    <aside className="sidebar">
      <div className="wordmark">RX</div>
      <button className="profile-card" onClick={onLogout}>
        <span className="avatar">{(user.name || user.email).slice(0, 2).toUpperCase()}</span>
        <span><b>{user.name}</b><small>{user.email}</small></span>
        <ChevronDown size={14} />
      </button>
      <button className="compose-button" onClick={onCompose}>Compose</button>
      <p className="sidebar-label">CORE</p>
      <button className={`nav-item ${folder === "scheduled" ? "active" : ""}`} onClick={() => setFolder("scheduled")}>
        <Clock3 size={16} />Scheduled
      </button>
      <button className={`nav-item ${folder === "sent" ? "active" : ""}`} onClick={() => setFolder("sent")}>
        <Send size={15} />Sent
      </button>
      <button className={`nav-item ${folder === "failed" ? "active" : ""}`} onClick={() => setFolder("failed")}>
        <X size={15} />Failed
      </button>
    </aside>
  );
}

function EmptyState({ folder }: { folder: Folder }) {
  return (
    <div className="empty-state">
      <FileText size={28} />
      <b>No {folder} emails</b>
      <span>Email records will appear here once they are scheduled or delivered.</span>
    </div>
  );
}

function MessageDetail({ message, onBack }: { message: EmailJob; onBack: () => void }) {
  const previewUrl = `/api/emails/${message.id}/preview`;
  return (
    <main className="detail-page">
      <header className="detail-topbar">
        <button className="back-title" onClick={onBack}>
          <ArrowLeft size={23} />{message.subject}
        </button>
        <a className="icon-button green" href={previewUrl} target="_blank" rel="noreferrer" title="Open Email Preview" style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px", textDecoration: "none", padding: "5px 10px", border: "1px solid #00a940", borderRadius: "8px" }}>
          <ExternalLink size={14} /> Preview Email
        </a>
      </header>
      <article className="email-paper">
        <div className="sender-line">
          <span className="sender-avatar">{message.sender.email.slice(0, 1).toUpperCase()}</span>
          <div>
            <b>{message.sender.name ?? message.sender.email}</b>
            <span className="sender-email"> &lt;{message.sender.email}&gt;</span>
            <small>to {message.recipient}</small>
          </div>
          <time>{new Date(message.sentAt ?? message.scheduledAt).toLocaleString()}</time>
        </div>
        <div className="email-body">
          <p>{message.body}</p>
          {message.failureReason && (
            <div className="highlight-callout">
              <b>Delivery failure</b><br />{message.failureReason}
            </div>
          )}
          <div style={{ marginTop: "20px" }}>
            <a className="primary-button" href={previewUrl} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: "6px", textDecoration: "none", padding: "8px 16px" }}>
              <ExternalLink size={14} /> Open Full Email Preview
            </a>
          </div>
        </div>
      </article>
    </main>
  );
}

function Compose({ user, onBack }: { user: User; onBack: () => void }) {
  const [senders, setSenders] = useState<Sender[]>([]);
  const [senderEmail, setSenderEmail] = useState(user.email);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [recipients, setRecipients] = useState<string[]>([]);
  const [recipientInput, setRecipientInput] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [delaySeconds, setDelaySeconds] = useState("2");
  const [hourlyLimit, setHourlyLimit] = useState("200");
  const [startAt, setStartAt] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api<{ senders: Sender[] }>("/senders")
      .then(({ senders: list }) => {
        setSenders(list);
        const currentUser = list.find((s) => s.email === user.email);
        if (currentUser) setSenderEmail(currentUser.email);
        else if (list[0]) setSenderEmail(list[0].email);
      })
      .catch(() => undefined);
  }, []);

  const getCombinedRecipients = () => {
    const added = recipientInput
      .split(/[\s,;]+/)
      .map((value) => value.trim().toLowerCase())
      .filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
    const combined = [...new Set([...recipients, ...added])];
    if (added.length) {
      setRecipients(combined);
      setRecipientInput("");
    }
    return combined;
  };

  const addRecipient = () => {
    getCombinedRecipients();
  };

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const values = (await file.text()).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
    const parsed = values.map((val) => val.toLowerCase());
    setRecipients((old) => [...new Set([...old, ...parsed])]);
    event.target.value = "";
  };

  const handleAttachment = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      setAttachments((old) => [...old, ...Array.from(event.target.files!)]);
    }
    event.target.value = "";
  };

  const removeAttachment = (index: number) => {
    setAttachments((old) => old.filter((_, i) => i !== index));
  };

  const setSendImmediately = () => {
    setStartAt(new Date().toISOString().slice(0, 16));
    setMenuOpen(false);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const finalRecipients = getCombinedRecipients();

    const targetTime = startAt ? new Date(startAt).toISOString() : new Date().toISOString();

    if (!finalRecipients.length || !subject.trim() || !body.trim()) {
      return setError("Please add at least one valid recipient, subject, and message body.");
    }

    setSubmitting(true);
    setError("");
    setSuccess("");

    try {
      const formData = new FormData();
      formData.append("recipients", JSON.stringify(finalRecipients));
      formData.append("senderEmail", senderEmail);
      formData.append("subject", subject);
      formData.append("body", body);
      formData.append("startAt", targetTime);
      formData.append("delaySeconds", delaySeconds);
      formData.append("hourlyLimit", hourlyLimit);
      attachments.forEach((file) => formData.append("attachments", file));

      await api("/emails/schedule", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: formData, // FormData does not need Content-Type header
      });
      setSuccess(`Successfully scheduled ${finalRecipients.length} email${finalRecipients.length === 1 ? "" : "s"}!`);
      setRecipients([]);
      setSubject("");
      setBody("");
      setAttachments([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to schedule emails");
    } finally {
      setSubmitting(false);
    }
  };


  return (
    <main className="compose-page">
      <header className="compose-topbar">
        <button className="back-title" onClick={onBack}>
          <ArrowLeft size={23} />Compose New Email
        </button>
        <div className="compose-actions">
          <label className="icon-button green" style={{ cursor: "pointer" }}>
            <Paperclip size={18} />
            <input type="file" multiple hidden onChange={handleAttachment} />
          </label>
          <button type="button" className="icon-button green" onClick={() => setMenuOpen(!menuOpen)}>
            <Clock3 size={18} />
          </button>
          <button type="submit" form="compose-form" className="send-later" disabled={submitting}>
            {submitting ? "Scheduling…" : "Schedule"}
          </button>
        </div>
      </header>

      <form id="compose-form" className="composer" onSubmit={submit}>
        <div className="field-row from-row">
          <label>From</label>
          <input className="from-select" list="sender-options" value={senderEmail} onChange={(event) => setSenderEmail(event.target.value)} required />
          <datalist id="sender-options">
            {senders.map((sender) => <option key={sender.id} value={sender.email} />)}
          </datalist>
        </div>

        <div className="field-row recipient-row">
          <label>To</label>
          <div className="recipient-area">
            {recipients.map((email) => (
              <span className="email-chip" key={email}>
                {email}
                <button type="button" onClick={() => setRecipients((old) => old.filter((item) => item !== email))}>
                  <X size={12} />
                </button>
              </span>
            ))}
            <input
              value={recipientInput}
              onChange={(event) => setRecipientInput(event.target.value)}
              onBlur={addRecipient}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === ",") {
                  event.preventDefault();
                  addRecipient();
                }
              }}
              placeholder="recipient@example.com"
            />
          </div>
          {recipients.length > 0 && (
            <span style={{ fontSize: "11px", color: "#00a940", fontWeight: 600, whiteSpace: "nowrap" }}>
              {recipients.length} lead{recipients.length === 1 ? "" : "s"} detected
            </span>
          )}
          <label className="upload-button">
            <Upload size={15} />Upload CSV / List
            <input type="file" accept=".csv,.txt" hidden onChange={upload} />
          </label>
        </div>

        <div className="field-row">
          <label>Subject</label>
          <input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Subject" required />
        </div>

        <div className="settings">
          <label>Delay between emails (sec)
            <input value={delaySeconds} onChange={(event) => setDelaySeconds(event.target.value)} inputMode="numeric" required />
          </label>
          <label>Hourly Limit
            <input value={hourlyLimit} onChange={(event) => setHourlyLimit(event.target.value)} inputMode="numeric" required />
          </label>
        </div>

        <div className="editor">
          <textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder="Type your email body here..." required />
          <div className="editor-toolbar">Tt │ <b>B</b> <i>I</i> <u>U</u> │ ☰ •≡ │ ❝</div>
        </div>

        {attachments.length > 0 && (
          <div className="attachments-list" style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "10px" }}>
            {attachments.map((file, idx) => (
              <div key={idx} style={{ display: "flex", alignItems: "center", gap: "4px", background: "#f0fdf4", padding: "4px 8px", borderRadius: "16px", fontSize: "12px", color: "#00a940", border: "1px solid #dcfce7" }}>
                <Paperclip size={12} />
                <span style={{ maxWidth: "150px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</span>
                <button type="button" onClick={() => removeAttachment(idx)} style={{ background: "none", border: "none", color: "#00a940", cursor: "pointer", display: "flex", alignItems: "center", padding: 0, marginLeft: "4px" }}>
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        {error && <p className="form-error">{error}</p>}
        {success && <p className="form-success">{success}</p>}
      </form>

      {menuOpen && (
        <aside className="send-later-menu">
          <b>Send Later / Schedule</b>
          <button type="button" onClick={setSendImmediately}>⚡ Send Immediately</button>
          <label className="date-picker">
            <CalendarDays size={15} />Pick date &amp; time
            <input type="datetime-local" value={startAt} onChange={(event) => { setStartAt(event.target.value); setMenuOpen(false); }} />
          </label>
          <hr />
          <button type="button" onClick={() => {
            const date = new Date(Date.now() + 86_400_000);
            date.setHours(10, 0, 0, 0);
            setStartAt(date.toISOString().slice(0, 16));
            setMenuOpen(false);
          }}>Tomorrow, 10:00 AM</button>
        </aside>
      )}
    </main>
  );
}
