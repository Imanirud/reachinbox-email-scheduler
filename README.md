# ReachX Email Job Scheduler & Dashboard

A production-grade, full-stack email job scheduler service and dashboard built with **TypeScript**, **Express.js**, **BullMQ + Redis**, **PostgreSQL (Prisma ORM)**, and **React + Vite**.

Designed for reliable, high-throughput email scheduling with atomic rate limiting, worker concurrency, and crash resilience across restarts — without using any cron jobs.

---

## 🎯 Overview & Key Features

### Backend Capabilities
- **BullMQ + Redis Persistent Scheduler**: Delayed job queue management with zero dependency on cron.
- **Atomic Sender-based Rate Limiting & Inter-email Throttling**:
  - Implements a custom atomic Redis Lua script (`reserveDeliverySlot`) that reserves precise delivery windows.
  - Enforces minimum delay between emails (e.g. 2s) to prevent provider throttling.
  - Enforces hourly email limits per sender (e.g. 200 emails/hour).
  - Automatically delays and reschedules excess jobs into future hour windows under high load preserving execution order.
- **Crash & Restart Resilience**:
  - Email jobs are durably persisted in PostgreSQL.
  - On server boot, all pending/interrupted jobs are safely enqueued in BullMQ using deterministic `jobId` deduplication, guaranteeing jobs send at their scheduled times after restarts without duplicates.
- **Ethereal Fake SMTP Integration**:
  - Supports configurable Ethereal SMTP accounts.
  - Auto-generates an Ethereal test account on server startup if credentials are not configured, providing out-of-the-box zero-setup email testing with web preview URLs.
- **Multi-Sender & Idempotency Support**:
  - Supports multiple senders per account.
  - `Idempotency-Key` headers and database unique constraints prevent accidental double-enqueuing of email lists.

### Frontend Capabilities
- **Google OAuth Login**: Real Google OAuth authentication using Passport.js, storing secure HttpOnly JWT session cookies.
- **Quick Demo Login Fallback**: Includes a 1-click demo login option (`oliver.brown@domain.io`) so evaluators can test immediately without configuring Google Cloud Platform secrets.
- **Figma-Matched Dashboard**:
  - Header displaying user avatar, name, email, and logout option.
  - Filterable tabs for **Scheduled Emails**, **Sent Emails**, and **Failed Emails**.
  - Search bar filtering by recipient, subject, or message body.
  - Loading indicators, error toasts, and empty state cards.
- **Compose New Email Interface**:
  - From address selector (multi-sender support).
  - Recipient chip input + CSV/txt file upload parser with lead detection counter.
  - Configurable send start time, inter-email delay, and hourly send limit.
  - Message preview & direct web preview link to Ethereal SMTP inbox.

---

## 🛠 Tech Stack

| Domain | Technology |
| --- | --- |
| **Backend Framework** | Node.js, TypeScript, Express.js |
| **Queue / Scheduler** | BullMQ, Redis 7 (Lua scripts for atomic slot reservation) |
| **Database & ORM** | PostgreSQL 16, Prisma ORM |
| **Email Transport** | Nodemailer with Ethereal SMTP (Fake SMTP for testing) |
| **Authentication** | Passport.js (Google OAuth 2.0) + HttpOnly JWT session cookies |
| **Frontend UI** | React 18, Vite, TypeScript, Lucide Icons, Modern Vanilla CSS |
| **Containerization** | Docker, Docker Compose, Nginx (production frontend proxy) |

---

## 🚀 How to Run

### Option 1: Docker Compose (Recommended)

1. Clone the repository:
   ```bash
   git clone <repo-url>
   cd reachx-email-scheduler
   ```

2. (Optional) Create `backend/.env`:
   ```bash
   cp backend/.env.example backend/.env
   ```

3. Launch all services (PostgreSQL, Redis, Backend, Frontend):
   ```bash
   docker compose up --build -d
   ```

4. Access the applications:
   - **Frontend Dashboard**: `http://localhost:5173`
   - **Backend API**: `http://localhost:5000`

---

### Option 2: Running Locally (Manual Setup)

#### Prerequisites
- Node.js (v18+)
- PostgreSQL server running locally (or via Docker)
- Redis server running locally (or via Docker)

#### 1. Setup Backend

```bash
cd backend

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your DATABASE_URL and REDIS_URL

# Push schema to database & generate Prisma client
npx prisma db push
npx prisma generate

# Start dev server
npm run dev
```

#### 2. Setup Frontend

```bash
cd frontend

# Install dependencies
npm install

# Start dev server
npm run dev
```

Open `http://localhost:5173` in your browser.

---

## ⚙️ Environment Variables Reference

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `5000` | Backend API port |
| `FRONTEND_URL` | `http://localhost:5173` | Allowed CORS origin & OAuth redirect base |
| `DATABASE_URL` | `postgresql://...` | PostgreSQL connection string |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL |
| `JWT_SECRET` | `super-secret-jwt-key` | Secret key for signing session tokens |
| `GOOGLE_CLIENT_ID` | `""` | Google OAuth Client ID |
| `GOOGLE_CLIENT_SECRET` | `""` | Google OAuth Client Secret |
| `GOOGLE_CALLBACK` | `http://localhost:5000/api/auth/google/callback` | OAuth redirect URI |
| `SMTP_HOST` | `smtp.ethereal.email` | Ethereal SMTP host |
| `SMTP_PORT` | `587` | Ethereal SMTP port |
| `SMTP_USER` | `""` | Ethereal username (auto-generated if empty) |
| `SMTP_PASS` | `""` | Ethereal password (auto-generated if empty) |
| `WORKER_CONCURRENCY` | `5` | BullMQ parallel worker concurrency |
| `MAX_EMAILS_PER_HOUR` | `200` | Default rate limit (emails/hour/sender) |
| `DEFAULT_DELAY_SECONDS` | `2` | Default minimum delay between emails |

---

## 🧠 Architecture Overview & Technical Deep Dive

### 1. How Scheduling Works (No Cron)
1. User submits a batch of recipient emails along with scheduling parameters (`startAt`, `delaySeconds`, `hourlyLimit`).
2. For each recipient, the backend invokes an atomic Redis Lua script (`reserveDeliverySlot`).
3. The script retrieves the sender's last scheduled timestamp (`sender:<id>:next-at`) and hourly window counter (`sender:<id>:hour:<window>`).
4. If the hourly window count is within limits, it reserves the timestamp and increments the counter. If the hourly limit is exceeded, it shifts candidate timestamps to the start of the next hour window (`window + 3600000`).
5. A database row (`EmailJob`) is inserted with status `SCHEDULED` and `scheduledAt`.
6. BullMQ enqueues the job as a delayed job with `delay = scheduledAt - now`.

### 2. How Persistence Across Server Restarts is Handled
- **Database Persistence**: All scheduled emails are written to PostgreSQL before queueing.
- **Boot Recovery**: On backend boot (`server.ts`), the application connects to DB and Redis. It queries all jobs with status `SCHEDULED` or `PROCESSING` (re-setting `PROCESSING` to `SCHEDULED` if interrupted mid-delivery).
- **Idempotent Queueing**: Re-enqueuing uses `jobId: email.id`. BullMQ automatically ignores duplicate job IDs, ensuring jobs are never re-sent or duplicated on restart.

### 3. Rate Limiting & Concurrency Architecture
- **Worker Concurrency**: Configured via `WORKER_CONCURRENCY` (default `5`), allowing workers to process ready delayed jobs in parallel.
- **Sender Isolation**: Rate limits are scoped per `senderId`. Different senders deliver independently without blocking each other.
- **Load Handling**: Scheduling 1,000+ emails for the same time calculates exact non-overlapping scheduled times for all emails across hourly windows in milliseconds without memory degradation.

---

## 🧪 Verification & Demo Testing

### Testing Server Restarts
1. Open dashboard at `http://localhost:5173` and click **Compose New Email**.
2. Upload or type email leads and set a start time 2 minutes in the future. Click **Schedule**.
3. Verify emails appear in the **Scheduled Emails** list.
4. Stop the backend process / container (`docker compose stop backend` or `Ctrl+C`).
5. Restart backend (`docker compose start backend` or `npm run dev`).
6. Observe boot logs: `[Boot] Found X pending email jobs. Enqueuing into BullMQ...`.
7. Wait for the scheduled time and verify emails transition cleanly to **Sent Emails** with Ethereal preview links.

---

## 🤝 Project Structure

```
.
├── backend
│   ├── prisma
│   │   └── schema.prisma        # Database schema for User, Sender, EmailJob
│   ├── src
│   │   ├── auth.ts              # Passport.js Google OAuth configuration
│   │   ├── config.ts            # Environment settings & defaults
│   │   ├── lib
│   │   │   ├── prisma.ts        # Prisma client instance
│   │   │   ├── queue.ts         # BullMQ queue definition
│   │   │   ├── rate-scheduler.ts# Redis Lua script for rate limiting
│   │   │   └── redis.ts         # Redis connection
│   │   ├── middleware
│   │   │   └── auth.ts          # JWT authentication middleware
│   │   ├── routes
│   │   │   ├── auth.ts          # Auth routes (login, Google OAuth, logout, /me)
│   │   │   ├── emails.ts        # Scheduling & email query endpoints
│   │   │   └── senders.ts       # Sender profile endpoints
│   │   ├── server.ts            # Boot sequence & Express server
│   │   └── worker.ts            # BullMQ email worker & Nodemailer Ethereal SMTP
│   ├── Dockerfile
│   └── package.json
├── frontend
│   ├── src
│   │   ├── App.tsx              # Main React application & components
│   │   ├── styles.css           # Modern custom CSS styling
│   │   └── main.tsx             # React entry point
│   ├── Dockerfile
│   └── nginx.conf               # Nginx reverse proxy configuration
├── compose.yaml                 # Multi-container Docker Compose definition
└── README.md
```


---

# 🏗️ System Architecture

The ReachX Email Scheduler follows an asynchronous microservice-inspired architecture. The frontend communicates with a REST API secured using JWT authentication. Email scheduling requests are persisted in PostgreSQL and processed asynchronously using Redis and BullMQ workers, ensuring scalable and rate-limited email delivery.

```text
                                   ReachX Email Scheduler
────────────────────────────────────────────────────────────────────────────────────────────────────

                                    ┌───────────────────────┐
                                    │       End User        │
                                    └───────────┬───────────┘
                                                │
                                                │ HTTP / HTTPS
                                                ▼
                             ┌────────────────────────────────────┐
                             │ React Frontend (Vite + TypeScript) │
                             │  • Dashboard                       │
                             │  • CSV Upload                      │
                             │  • Scheduling UI                   │
                             └──────────────┬─────────────────────┘
                                            │
                                  REST API + JWT
                                            │
                                            ▼
                   ┌────────────────────────────────────────────────────┐
                   │          Express.js Backend API                    │
                   │                                                    │
                   │ • Google OAuth Authentication                      │
                   │ • JWT Authorization                                │
                   │ • Sender Management                                │
                   │ • Email Scheduling API                             │
                   │ • Dashboard APIs                                   │
                   └───────────────┬───────────────────────┬────────────┘
                                   │                       │
                      Database      │                       │ Queue Jobs
                                   ▼                       ▼
                     ┌────────────────────┐      ┌─────────────────────┐
                     │ PostgreSQL         │      │ Redis + BullMQ      │
                     │                    │      │                     │
                     │ • Users            │      │ • Job Queue         │
                     │ • Senders          │      │ • Retry Logic       │
                     │ • Email Jobs       │      │ • Delayed Jobs      │
                     └─────────┬──────────┘      └─────────┬───────────┘
                               │                           │
                               │                           ▼
                               │            ┌──────────────────────────┐
                               │            │     Email Worker          │
                               │            │                          │
                               │            │ • Queue Consumer         │
                               │            │ • Rate Limiter           │
                               │            │ • Sender Rotation        │
                               │            │ • Email Processing       │
                               │            └──────────┬───────────────┘
                               │                       │
                               │                       ▼
                               │          ┌──────────────────────────┐
                               │          │ SMTP Provider            │
                               │          │ (Gmail / Ethereal)       │
                               │          └──────────┬───────────────┘
                               │                     │
                               ▼                     ▼
                      Job Status Updated      Recipient Inbox

────────────────────────────────────────────────────────────────────────────────────────────────────
```

## Request Flow

```text
User Login
      │
      ▼
Google OAuth
      │
      ▼
JWT Token Issued
      │
      ▼
Frontend Stores JWT
      │
      ▼
Authenticated API Requests
      │
      ▼
Express Backend
      │
      ▼
Prisma ORM
      │
      ▼
PostgreSQL
```

---

## Email Scheduling Flow

```text
Upload CSV
      │
      ▼
Schedule Email
      │
      ▼
Validate Request
      │
      ▼
Save Email Job
      │
      ▼
Push Job to BullMQ
      │
      ▼
Redis Queue
      │
      ▼
Email Worker
      │
      ▼
Rate Limiter
      │
      ▼
SMTP Provider
      │
      ▼
Recipient
      │
      ▼
Update Job Status
```

---

## Architecture Highlights

- **React + TypeScript** provides a responsive and type-safe frontend.
- **Express.js** exposes REST APIs for authentication, sender management, and email scheduling.
- **Google OAuth + JWT** secures user authentication and API access.
- **Prisma ORM** manages communication with PostgreSQL.
- **Redis + BullMQ** enable asynchronous background job processing.
- **Dedicated Worker Service** processes queued emails independently from API requests.
- **Rate Limiting** prevents SMTP throttling and controls email throughput.
- **Docker Compose** orchestrates the frontend, backend, PostgreSQL, and Redis services for consistent local development and deployment.