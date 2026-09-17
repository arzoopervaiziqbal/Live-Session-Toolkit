const { supabase, q } = require("../config/db");
const { httpError } = require("../middleware/error");
const { generateUniqueSessionCode } = require("../utils/sessionCode");
const { extractTextFromFile, safeUnlink } = require("../services/fileParser.service");
const { VALID_CATEGORIES } = require("../utils/validators");
const realtime = require("../realtime/gateway");

/** Loads a session and asserts the caller owns it. */
async function ownedSession(sessionId, hostId) {
  const session = await q(
    supabase.from("sessions").select("*").eq("id", sessionId).maybeSingle(),
    "load session"
  );
  if (!session) throw httpError(404, "Session not found.");
  if (session.host_id !== hostId) throw httpError(403, "That session belongs to another host.");
  return session;
}

function sanitizeCategories(input) {
  if (!Array.isArray(input)) return ["quiz", "poll", "qa"];
  const cleaned = input.filter((c) => VALID_CATEGORIES.includes(c));
  return cleaned.length ? [...new Set(cleaned)] : ["quiz", "poll", "qa"];
}

// POST /api/sessions
async function createSession(req, res) {
  const { title, description, activeCategories } = req.body;
  if (!title || !title.trim()) {
    throw httpError(400, "Give the session a name.", { title: "Give the session a name." });
  }

  const session = await q(
    supabase
      .from("sessions")
      .insert({
        host_id: req.user.id,
        title: title.trim(),
        description: (description || "").trim(),
        session_code: await generateUniqueSessionCode(),
        active_categories: sanitizeCategories(activeCategories),
        status: "draft",
      })
      .select("*")
      .single(),
    "create session"
  );

  res.status(201).json({ session });
}

// GET /api/sessions
async function listSessions(req, res) {
  const sessions = await q(
    supabase
      .from("sessions")
      .select("*")
      .eq("host_id", req.user.id)
      .order("created_at", { ascending: false }),
    "list sessions"
  );

  if (!sessions.length) return res.json({ sessions: [] });

  const ids = sessions.map((s) => s.id);

  // Two batched queries instead of N per session — the dashboard is the page
  // hosts hit most often.
  const [activities, participants] = await Promise.all([
    q(
      supabase.from("activities").select("session_id, is_published").in("session_id", ids),
      "count activities"
    ),
    q(supabase.from("participants").select("session_id").in("session_id", ids), "count participants"),
  ]);

  const stats = new Map(ids.map((id) => [id, { total: 0, published: 0, drafts: 0, participants: 0 }]));
  for (const a of activities) {
    const s = stats.get(a.session_id);
    if (!s) continue;
    s.total += 1;
    if (a.is_published) s.published += 1;
    else s.drafts += 1;
  }
  for (const p of participants) {
    const s = stats.get(p.session_id);
    if (s) s.participants += 1;
  }

  res.json({
    sessions: sessions.map((s) => ({ ...s, stats: stats.get(s.id) })),
  });
}

// GET /api/sessions/:id
async function getSession(req, res) {
  const session = await ownedSession(req.params.id, req.user.id);

  const [activities, participants, qaCount] = await Promise.all([
    q(
      supabase
        .from("activities")
        .select("*")
        .eq("session_id", session.id)
        .order("order_index", { ascending: true })
        .order("created_at", { ascending: true }),
      "load activities"
    ),
    q(
      supabase
        .from("participants")
        .select("id, name, total_score, joined_at")
        .eq("session_id", session.id)
        .order("total_score", { ascending: false }),
      "load participants"
    ),
    q(supabase.from("qa_feed").select("id").eq("session_id", session.id), "count qa"),
  ]);

  res.json({
    session,
    activities,
    participants,
    counts: {
      drafts: activities.filter((a) => !a.is_published).length,
      published: activities.filter((a) => a.is_published).length,
      participants: participants.length,
      questions: qaCount.length,
    },
  });
}

// PATCH /api/sessions/:id
async function updateSession(req, res) {
  const session = await ownedSession(req.params.id, req.user.id);
  const { title, description, activeCategories, pushMode } = req.body;

  const patch = {};
  if (title !== undefined) {
    if (!title.trim()) throw httpError(400, "Give the session a name.", { title: "Give the session a name." });
    patch.title = title.trim();
  }
  if (description !== undefined) patch.description = String(description).trim();
  if (activeCategories !== undefined) patch.active_categories = sanitizeCategories(activeCategories);
  // push_mode is only added to the patch if the column exists in DB
  if (pushMode !== undefined) patch.push_mode = pushMode === "bulk" ? "bulk" : "single";

  if (!Object.keys(patch).length) return res.json({ session });

  let updated;
  try {
    updated = await q(
      supabase.from("sessions").update(patch).eq("id", session.id).select("*").single(),
      "update session"
    );
  } catch (err) {
    // If push_mode column doesn't exist yet, retry without it
    if (err.message && err.message.includes("push_mode") && patch.push_mode !== undefined) {
      delete patch.push_mode;
      if (!Object.keys(patch).length) return res.json({ session });
      updated = await q(
        supabase.from("sessions").update(patch).eq("id", session.id).select("*").single(),
        "update session (fallback)"
      );
    } else {
      throw err;
    }
  }
  res.json({ session: updated });
}

// DELETE /api/sessions/:id
async function deleteSession(req, res) {
  const session = await ownedSession(req.params.id, req.user.id);
  // Clearing the FK first so the on-delete-set-null constraint can't block us.
  await q(
    supabase.from("sessions").update({ current_activity_id: null }).eq("id", session.id),
    "clear current activity"
  );
  // activities / participants / responses / qa_feed all cascade from here.
  await q(supabase.from("sessions").delete().eq("id", session.id), "delete session");
  res.json({ success: true });
}

// POST /api/sessions/:id/notes   (multipart file OR { notesText })
async function uploadNotes(req, res) {
  const session = await ownedSession(req.params.id, req.user.id);

  let notesText = "";
  let sourceName = "pasted text";

  if (req.file) {
    try {
      notesText = await extractTextFromFile(req.file.path);
      sourceName = req.file.originalname;
    } finally {
      // The text is what we need; the file itself is not worth keeping.
      await safeUnlink(req.file.path);
    }
  } else if (req.body.notesText) {
    notesText = String(req.body.notesText);
  } else {
    throw httpError(400, "Upload a file or paste your notes.");
  }

  if (!notesText.trim()) {
    throw httpError(400, "That file didn't contain any readable text. If it's a scanned PDF, try a text export.");
  }

  const append = req.body.append === "true" || req.body.append === true;
  const combined = append && session.source_notes_text
    ? `${session.source_notes_text}\n\n${notesText}`
    : notesText;

  const updated = await q(
    supabase
      .from("sessions")
      .update({ source_notes_text: combined })
      .eq("id", session.id)
      .select("id, source_notes_text")
      .single(),
    "save notes"
  );

  res.json({
    sessionId: updated.id,
    sourceName,
    characters: updated.source_notes_text.length,
    preview: updated.source_notes_text.slice(0, 500),
  });
}

// POST /api/sessions/:id/start
async function startSession(req, res) {
  const session = await ownedSession(req.params.id, req.user.id);
  if (session.status === "ended") throw httpError(400, "This session has already ended.");

  const published = await q(
    supabase.from("activities").select("id").eq("session_id", session.id).eq("is_published", true),
    "count published activities"
  );
  const wantsQuizOrPoll = (session.active_categories || []).some((c) => c === "quiz" || c === "poll");
  if (wantsQuizOrPoll && !published.length) {
    throw httpError(400, "Publish at least one question or poll before going live.");
  }

  const updated = await q(
    supabase.from("sessions").update({ status: "active" }).eq("id", session.id).select("*").single(),
    "start session"
  );

  realtime.emitSessionStatus({ sessionId: session.id, status: "active" });
  res.json({ session: updated });
}

// POST /api/sessions/:id/end
async function endSession(req, res) {
  const session = await ownedSession(req.params.id, req.user.id);

  if (session.current_activity_id) realtime.clearAutoClose(session.current_activity_id);

  const updated = await q(
    supabase
      .from("sessions")
      .update({
        status: "ended",
        ended_at: new Date().toISOString(),
        current_activity_id: null,
        activity_started_at: null,
      })
      .eq("id", session.id)
      .select("*")
      .single(),
    "end session"
  );

  realtime.emitSessionStatus({ sessionId: session.id, status: "ended" });
  res.json({ session: updated });
}

// GET /api/sessions/:id/live  — host presenter state on page load / refresh
async function getLiveState(req, res) {
  const session = await ownedSession(req.params.id, req.user.id);

  const [activities, participants] = await Promise.all([
    q(
      supabase
        .from("activities")
        .select("*")
        .eq("session_id", session.id)
        .eq("is_published", true)
        .order("order_index", { ascending: true }),
      "load published activities"
    ),
    q(
      supabase
        .from("participants")
        .select("id, name, total_score, joined_at")
        .eq("session_id", session.id)
        .order("total_score", { ascending: false })
        .order("joined_at", { ascending: true }),
      "load participants"
    ),
  ]);

  let endsAt = null;
  if (session.current_activity_id && session.activity_started_at) {
    const current = activities.find((a) => a.id === session.current_activity_id);
    if (current && !current.closed_at) {
      endsAt = new Date(session.activity_started_at).getTime() + current.timer_seconds * 1000;
    }
  }

  res.json({
    session,
    activities,
    participants,
    currentActivityId: session.current_activity_id,
    startedAt: session.activity_started_at ? new Date(session.activity_started_at).getTime() : null,
    endsAt,
    serverNow: Date.now(),
  });
}

// GET /api/sessions/:id/leaderboard
async function getSessionLeaderboard(req, res) {
  const session = await ownedSession(req.params.id, req.user.id);
  const { getDetailedLeaderboard } = require("../services/scoring.service");
  const leaderboard = await getDetailedLeaderboard(session.id);
  res.json({
    sessionId: session.id,
    leaderboard,
  });
}

module.exports = {
  ownedSession,
  createSession,
  listSessions,
  getSession,
  updateSession,
  deleteSession,
  uploadNotes,
  startSession,
  endSession,
  getLiveState,
  getSessionLeaderboard,
};
