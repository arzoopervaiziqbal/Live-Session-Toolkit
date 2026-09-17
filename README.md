# AI-Powered Live Session Toolkit

One toolkit for live-session engagement: AI-generated quizzes, live polls, and a Q&A feed, with auto-grading and a consolidated report at the end.

Stack: **Next.js 14** (App Router) · **Express** · **Supabase / PostgreSQL** · **Google Gemini** (`gemini-2.5-flash`) · **Socket.IO**

---

## Setup

### 1. Supabase

Create a project at [supabase.com](https://supabase.com), then open **SQL Editor** and run the contents of:

```
backend/src/config/schema.sql
```

This creates all six tables, enums, indexes, cascades, the atomic scoring function, and enables RLS. It's idempotent, so re-running it is safe.

Grab your credentials from **Project Settings → API**: the Project URL and the `service_role` key.

### 2. Gemini

Get a key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).

### 3. Backend

```bash
cd backend
cp .env.example .env     # then fill in the values below
npm install
npm run check            # verifies nothing is still a placeholder
npm run dev
```

`.env`:

```
PORT=5000
CLIENT_URL=http://localhost:3000
JWT_SECRET=<a long random string>
JWT_EXPIRES_IN=7d
SUPABASE_URL=https://<your-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role key>
GEMINI_API_KEY=<your key>
GEMINI_MODEL=gemini-2.5-flash
```

### 4. Frontend

```bash
cd frontend
cp .env.local.example .env.local
npm install
npm run dev
```

Open http://localhost:3000.

---

## Using it

**Host:** register → *New session* → name it, pick which tools you want (Quiz / Polls / Q&A) → paste notes or upload a PDF/DOCX → *Create & generate with AI*.

Generated questions land on the **review** screen as drafts. Nothing reaches a participant until you publish. Edit the wording, fix options, change the answer key, adjust timers, delete anything wrong — then *Publish all*.

*Start session* opens the **live room**. Share the 6-character code, push questions one at a time, watch answers arrive, close to reveal the chart. Moderate Q&A from the sidebar: pin important questions, mark them answered.

*End session* finalises the **report**: ranked scoreboard, per-question breakdown with distributions, poll results, and the full Q&A transcript. Export as CSV or JSON.

**Participant:** go to `/participant/join`, enter the code and a name. No account.

---

## How the PRD requirements are met

| Requirement | Implementation |
|---|---|
| AI quiz generation from notes (6.1) | `services/ai.service.js` — Gemini with `responseMimeType: "application/json"` **and** a `responseSchema`, so output shape is enforced by the API rather than hoped for |
| Host review before publishing (6.1) | Everything generates with `is_published: false`. Participants only ever see published rows |
| Sync under 500ms (10.1) | Socket.IO broadcast + absolute server timestamps + an NTP-style clock handshake |
| Instant auto-grading (6.2 / 9.1) | `scoring.service.js` grades on insert; rule-based, no AI in the answer path |
| Live polls with charts (6.3) | Vote tallies broadcast on every submission, rendered by `ResultChart` |
| Live Q&A (6.4) | `qa_feed` table with REST + realtime; host can pin and mark answered |
| Consolidated report (9.2) | `report.service.js` — one query pass, four sections, CSV and JSON export |
| No data loss (9.3) | See below |

### The no-data-loss mechanism

This is the part worth understanding, because it's three pieces working together:

1. **Write locally first.** `lib/offlineQueue.js` writes every answer to IndexedDB *before* attempting the network call. Close the tab mid-request and the answer survives.
2. **Idempotency key.** Each submission carries a `clientToken` (a UUID minted on the device). The `responses` table has a unique index on it.
3. **Safe retry.** Because of (2), retrying is free — a replay hits the index and returns the original result instead of scoring twice. `startAutoSync` retries on the `online` event, on tab refocus, and on a slow interval as a backstop for networks that reconnect without firing `online`.

There's a second unique index on `(activity_id, participant_id)`, so a participant can't answer the same question twice even with a fresh token.

The PRD lists offline mode as out of scope (§8) while §9.3 and §10.1 both require local caching with auto-retry. I implemented it — §9.3 is specific about the behaviour, and it's what makes the "no data loss" guarantee real rather than aspirational.

---

## Schema notes

The six tables match your spec. I added columns that the requested features can't work without:

| Table | Added | Why |
|---|---|---|
| `hosts` | `name` | The registration form collects it |
| `sessions` | `title`, `description`, `source_notes_text`, `ended_at` | Sessions need a name; notes are reused for "generate more" |
| `sessions` | `current_activity_id`, `activity_started_at` | Server-authoritative timers. Without these, a participant who reloads mid-question lands on a blank screen instead of back in the question with the correct time remaining |
| `activities` | `order_index`, `points`, `ai_generated`, `closed_at` | Queue ordering, scoring weight, draft provenance, close state |
| `participants` | `guest_id`, `last_seen_at` | Stable device identity so a reconnect keeps the score instead of creating a duplicate row |
| `responses` | `client_token`, `response_time_ms` | Idempotency (above) and the report's average-response-time column |

---

## Security

Two things to be aware of:

**Revoke the Groq key.** The repo you sent had `backend/.env` committed with a live `GROQ_API_KEY` in it, and `.gitignore` contained only `node_modules/`. That key is in your git history and should be treated as compromised — revoke it at console.groq.com. This version ships a proper `.gitignore` and placeholder-only `.env`.

**The service role key must stay server-side.** It bypasses RLS entirely. The frontend only ever talks to the Express API, never to Supabase directly. Don't add `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY` anywhere.

Other measures in place: bcrypt password hashing, JWT with role claims, host ownership checks on every session/activity/Q&A mutation, correct answers stripped from all participant-facing payloads while a question is open, CSV formula-injection escaping on export, and RLS enabled on every table so a leaked anon key reads nothing.

---

## API

```
POST   /api/auth/host/register|login          GET /api/auth/host/me

GET    /api/sessions                          POST   /api/sessions
GET    /api/sessions/:id                      PATCH  /api/sessions/:id
DELETE /api/sessions/:id
POST   /api/sessions/:id/notes                (multipart file or { notesText })
POST   /api/sessions/:id/start|end            GET    /api/sessions/:id/live

GET    /api/sessions/:id/activities?status=draft|published
POST   /api/sessions/:id/activities           (manual)
POST   /api/sessions/:id/activities/generate  (Gemini)
POST   /api/sessions/:id/activities/publish   (batch)
PATCH  /api/activities/:id                    DELETE /api/activities/:id
POST   /api/activities/:id/push|close|unpublish
GET    /api/activities/:id/results

POST   /api/join                              GET  /api/join/:code
POST   /api/join/:sessionId/responses         POST /api/join/:sessionId/responses/batch
GET    /api/join/:sessionId/me?participantId=

GET    /api/sessions/:id/qa                   POST   /api/sessions/:id/qa
PATCH  /api/qa/:id                            DELETE /api/qa/:id

GET    /api/sessions/:id/report
GET    /api/sessions/:id/report/export?format=csv|json
```

### Socket events

Client emits `session:join` and `time:sync`. Server emits `activity:push`, `activity:close`, `poll:update`, `stats:update`, `leaderboard:update`, `score:update`, `qa:new`, `qa:update`, `presence:update`, `session:status`.

---

## What was removed

`sqlite3`, `better-sqlite3`, `sequelize`, `pg`, `pg-hstore`, `mongoose`, `mongodb-memory-server`, `database.sqlite`, the entire `src/models/` directory, the Groq and Anthropic AI paths, participant accounts (the PRD specifies code-based joining), and ~200 lines of commented-out dead code in `activity.controller.js`.

The old data model stored a whole quiz as a `questions` JSON blob on one `activities` row. Your spec flattens this so one row is one question, which is what makes per-question pushing, timing, and reporting possible.
