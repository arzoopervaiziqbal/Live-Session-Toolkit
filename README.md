# LiveHub — AI Live Session Toolkit

Full-stack app: hosts create quizzes/polls/feedback/Q&A from lecture notes using AI,
publish a link + code, and participants join, answer, and see instant results.
Hosts and participants are fully separate accounts (their own register/login).

## Stack
- **Frontend:** Next.js (App Router) + Tailwind CSS
- **Backend:** Node.js + Express
- **Database:** SQLite by default (via Sequelize) — set `DATABASE_URL` to use PostgreSQL instead
- **AI:** Groq (free, default) or Anthropic Claude API (question generation from notes, with easy/medium/hard difficulty and a configurable question count)
- **File parsing:** PDF (pdf-parse), DOCX (mammoth), TXT/MD (plain text)

## Project layout
```
live-session-toolkit/
├── backend/     # Express API + Sequelize models (SQLite/PostgreSQL)
└── frontend/    # Next.js app (host + participant UIs)
```

## Setup

### 1. Backend
```bash
cd backend
# edit .env: set JWT_SECRET, and GROQ_API_KEY (free, no billing — get one at console.groq.com)
# leave DATABASE_URL empty to use local SQLite — no separate database server needed
npm install
npm run dev
```
Runs on http://localhost:5000

### 2. Frontend
```bash
cd frontend
cp .env.local.example .env.local
# edit .env.local if your backend runs elsewhere
npm install
npm run dev
```
Runs on http://localhost:3000

## How it works
1. A **host** registers/logs in, creates a session, picks a category
   (Quiz / Poll / Feedback / Live Q&A), a question count, and, for quizzes,
   a difficulty (Easy / Medium / Hard).
2. The host pastes notes or **uploads a file** (PDF/DOCX/TXT/MD).
3. Clicking "Generate with AI" sends the notes to Groq (or Anthropic) and gets back
   structured questions, which the host can edit before publishing.
4. Publishing generates a short **session code** / link.
5. A **participant** registers/logs in separately, enters the code,
   answers the questions, and sees their score immediately.
6. All responses are stored in the database. The host can view live counts,
   rename or delete sessions, and export results as CSV.

## Notes on this scaffold
- Real-time updates on the host's "live" page currently use simple polling
  (every 4s). A `sockets/` layer can be added with `socket.io` for true
  push updates — the project structure anticipates this.
- Google Sheets export isn't wired up yet; CSV export is included
  (`GET /api/activities/:id/export`) as the simpler first step.
- Passwords are hashed with bcrypt; auth uses JWT bearer tokens stored
  in `localStorage` on the frontend.
