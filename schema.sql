-- =====================================================================
-- AI-Powered Live Session Toolkit — Supabase / PostgreSQL schema
-- ---------------------------------------------------------------------
-- Run this once against your Supabase project:
--   Supabase Dashboard -> SQL Editor -> paste -> Run
-- or:  psql "$SUPABASE_DB_URL" -f src/config/schema.sql
--
-- The script is idempotent: it can be re-run safely.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
do $$ begin
  create type session_status as enum ('draft', 'active', 'ended');
exception when duplicate_object then null; end $$;

do $$ begin
  create type activity_type as enum ('quiz', 'poll');
exception when duplicate_object then null; end $$;

do $$ begin
  create type difficulty_level as enum ('easy', 'medium', 'hard');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 1. hosts
-- ---------------------------------------------------------------------
create table if not exists hosts (
  id            uuid primary key default gen_random_uuid(),
  name          text        not null default 'Host',
  email         text        not null unique,
  password_hash text        not null,
  created_at    timestamptz not null default now()
);

create index if not exists hosts_email_idx on hosts (lower(email));

-- ---------------------------------------------------------------------
-- 2. sessions
-- ---------------------------------------------------------------------
create table if not exists sessions (
  id                  uuid           primary key default gen_random_uuid(),
  host_id             uuid           not null references hosts (id) on delete cascade,
  title               text           not null,
  description         text           not null default '',
  session_code        text           not null unique,
  active_categories   jsonb          not null default '["quiz","poll","qa"]'::jsonb,
  status              session_status not null default 'draft',
  -- Live state: which activity is currently pushed to participants, and when
  -- the server pushed it. Clients derive their countdown from these two fields
  -- plus a server-clock offset, which keeps every device within ~1 tick.
  current_activity_id uuid           null,
  activity_started_at timestamptz    null,
  source_notes_text   text           not null default '',
  ended_at            timestamptz    null,
  created_at          timestamptz    not null default now()
);

create index if not exists sessions_host_id_idx      on sessions (host_id);
create index if not exists sessions_session_code_idx on sessions (upper(session_code));
create index if not exists sessions_status_idx       on sessions (status);

-- ---------------------------------------------------------------------
-- 3. activities  (one row === one question / one poll)
-- ---------------------------------------------------------------------
create table if not exists activities (
  id             uuid             primary key default gen_random_uuid(),
  session_id     uuid             not null references sessions (id) on delete cascade,
  type           activity_type    not null default 'quiz',
  question       text             not null default '',
  options        jsonb            not null default '[]'::jsonb,
  correct_answer text             null,          -- null for polls
  timer_seconds  integer          not null default 30 check (timer_seconds between 5 and 600),
  difficulty     difficulty_level not null default 'medium',
  points         integer          not null default 10 check (points >= 0),
  is_published   boolean          not null default false,  -- false === AI draft awaiting host review
  order_index    integer          not null default 0,
  ai_generated   boolean          not null default false,
  closed_at      timestamptz      null,
  created_at     timestamptz      not null default now()
);

create index if not exists activities_session_id_idx on activities (session_id);
create index if not exists activities_published_idx  on activities (session_id, is_published, order_index);

-- sessions.current_activity_id -> activities.id (added after both tables exist)
do $$ begin
  alter table sessions
    add constraint sessions_current_activity_fk
    foreign key (current_activity_id) references activities (id) on delete set null;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 4. participants
-- ---------------------------------------------------------------------
create table if not exists participants (
  id           uuid        primary key default gen_random_uuid(),
  session_id   uuid        not null references sessions (id) on delete cascade,
  name         text        not null default 'Guest',
  -- Stable per-device identity generated by the browser. Lets a participant
  -- reload or reconnect mid-session and keep their score.
  guest_id     text        not null,
  total_score  integer     not null default 0,
  joined_at    timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create unique index if not exists participants_session_guest_uidx
  on participants (session_id, guest_id);
create index if not exists participants_leaderboard_idx
  on participants (session_id, total_score desc, joined_at asc);

-- ---------------------------------------------------------------------
-- 5. responses
-- ---------------------------------------------------------------------
create table if not exists responses (
  id              uuid        primary key default gen_random_uuid(),
  activity_id     uuid        not null references activities (id) on delete cascade,
  participant_id  uuid        not null references participants (id) on delete cascade,
  answer          text        not null,
  is_correct      boolean     null,   -- null for polls (nothing to grade)
  points_awarded  integer     not null default 0,
  response_time_ms integer    null,
  -- Idempotency key minted on the participant's device. The offline queue
  -- retries with the same token, so a duplicate replay hits this unique index
  -- instead of double-scoring. This is what makes "no data loss" safe to retry.
  client_token    text        not null,
  submitted_at    timestamptz not null default now()
);

create unique index if not exists responses_client_token_uidx on responses (client_token);
create unique index if not exists responses_one_per_activity_uidx
  on responses (activity_id, participant_id);
create index if not exists responses_activity_idx    on responses (activity_id);
create index if not exists responses_participant_idx on responses (participant_id);

-- ---------------------------------------------------------------------
-- 6. qa_feed
-- ---------------------------------------------------------------------
create table if not exists qa_feed (
  id               uuid        primary key default gen_random_uuid(),
  session_id       uuid        not null references sessions (id) on delete cascade,
  participant_id   uuid        null references participants (id) on delete set null,
  participant_name text        not null default 'Guest',
  question_text    text        not null,
  is_answered      boolean     not null default false,
  is_highlighted   boolean     not null default false,
  created_at       timestamptz not null default now()
);

create index if not exists qa_feed_session_idx     on qa_feed (session_id, created_at desc);
create index if not exists qa_feed_highlighted_idx on qa_feed (session_id, is_highlighted);

-- ---------------------------------------------------------------------
-- Atomic score increment — avoids a read-modify-write race when several
-- participants submit in the same instant.
-- ---------------------------------------------------------------------
create or replace function increment_participant_score(p_participant_id uuid, p_points integer)
returns integer
language plpgsql
as $$
declare
  new_score integer;
begin
  update participants
     set total_score = total_score + p_points,
         last_seen_at = now()
   where id = p_participant_id
  returning total_score into new_score;
  return new_score;
end;
$$;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
-- The Express API talks to Postgres with the service role key, which bypasses
-- RLS. We still enable RLS on every table so that the anon/public key cannot
-- read or write anything directly, even if it leaks into the browser bundle.
-- ---------------------------------------------------------------------
alter table hosts        enable row level security;
alter table sessions     enable row level security;
alter table activities   enable row level security;
alter table participants enable row level security;
alter table responses    enable row level security;
alter table qa_feed      enable row level security;
