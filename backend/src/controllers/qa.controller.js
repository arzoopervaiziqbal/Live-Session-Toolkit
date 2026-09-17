const { supabase, q } = require("../config/db");
const { httpError } = require("../middleware/error");
const { ownedSession } = require("./session.controller");
const realtime = require("../realtime/gateway");

const MAX_QUESTION_LENGTH = 1000;

// GET /api/sessions/:sessionId/qa   (public — participants read the same feed)
async function listQuestions(req, res) {
  const session = await q(
    supabase.from("sessions").select("id").eq("id", req.params.sessionId).maybeSingle(),
    "load session for qa"
  );
  if (!session) throw httpError(404, "Session not found.");

  let builder = supabase
    .from("qa_feed")
    .select("*")
    .eq("session_id", session.id)
    .order("is_highlighted", { ascending: false })
    .order("created_at", { ascending: false });

  if (req.query.answered === "false") builder = builder.eq("is_answered", false);
  if (req.query.highlighted === "true") builder = builder.eq("is_highlighted", true);

  const items = await q(builder, "list qa");
  res.json({ items });
}

// POST /api/sessions/:sessionId/qa   body: { participantId, questionText }
async function postQuestion(req, res) {
  const { participantId, questionText } = req.body;

  const text = String(questionText || "").trim();
  if (!text) throw httpError(400, "Type your question first.");
  if (text.length > MAX_QUESTION_LENGTH) {
    throw httpError(400, `Keep it under ${MAX_QUESTION_LENGTH} characters.`);
  }

  const session = await q(
    supabase.from("sessions").select("*").eq("id", req.params.sessionId).maybeSingle(),
    "load session for qa post"
  );
  if (!session) throw httpError(404, "Session not found.");
  if (session.status === "ended") throw httpError(400, "This session has ended.");
  if (!(session.active_categories || []).includes("qa")) {
    throw httpError(400, "Q&A is switched off for this session.");
  }

  let participantName = "Guest";
  let linkedParticipantId = null;

  if (participantId) {
    const participant = await q(
      supabase.from("participants").select("id, name, session_id").eq("id", participantId).maybeSingle(),
      "load participant for qa"
    );
    if (participant && participant.session_id === session.id) {
      linkedParticipantId = participant.id;
      participantName = participant.name;
    }
  }

  const item = await q(
    supabase
      .from("qa_feed")
      .insert({
        session_id: session.id,
        participant_id: linkedParticipantId,
        participant_name: participantName,
        question_text: text,
      })
      .select("*")
      .single(),
    "post question"
  );

  realtime.emitQaNew({ sessionId: session.id, item });
  res.status(201).json({ item });
}

// PATCH /api/qa/:id   body: { isAnswered?, isHighlighted? }   (host only)
async function updateQuestion(req, res) {
  const item = await q(
    supabase.from("qa_feed").select("*").eq("id", req.params.id).maybeSingle(),
    "load qa item"
  );
  if (!item) throw httpError(404, "Question not found.");

  await ownedSession(item.session_id, req.user.id);

  const patch = {};
  if (req.body.isAnswered !== undefined) patch.is_answered = Boolean(req.body.isAnswered);
  if (req.body.isHighlighted !== undefined) patch.is_highlighted = Boolean(req.body.isHighlighted);
  if (!Object.keys(patch).length) return res.json({ item });

  const updated = await q(
    supabase.from("qa_feed").update(patch).eq("id", item.id).select("*").single(),
    "update qa item"
  );

  realtime.emitQaUpdate({ sessionId: item.session_id, item: updated });
  res.json({ item: updated });
}

// DELETE /api/qa/:id   (host only — for moderation)
async function deleteQuestion(req, res) {
  const item = await q(
    supabase.from("qa_feed").select("*").eq("id", req.params.id).maybeSingle(),
    "load qa item"
  );
  if (!item) throw httpError(404, "Question not found.");

  await ownedSession(item.session_id, req.user.id);
  await q(supabase.from("qa_feed").delete().eq("id", item.id), "delete qa item");

  realtime.emitQaUpdate({ sessionId: item.session_id, item: { ...item, deleted: true } });
  res.json({ success: true });
}

module.exports = { listQuestions, postQuestion, updateQuestion, deleteQuestion };
