const { supabase, q } = require("../config/db");
const { httpError } = require("../middleware/error");
const { normaliseCode } = require("../utils/sessionCode");
const { gradeAnswer, awardPoints, getLeaderboard, getActivityTally } = require("../services/scoring.service");
const realtime = require("../realtime/gateway");

async function findSessionByCode(rawCode) {
  const code = normaliseCode(rawCode);
  if (!code) return null;
  return q(
    supabase.from("sessions").select("*").eq("session_code", code).maybeSingle(),
    "find session by code"
  );
}

/** Strips the answer key before anything goes over the wire to a participant. */
function safeActivity(activity) {
  if (!activity) return null;
  const { correct_answer, ...rest } = activity;
  return rest;
}

// POST /api/join   body: { code, name, guestId }
async function joinSession(req, res) {
  const { code, name, guestId } = req.body;

  if (!guestId || typeof guestId !== "string") {
    throw httpError(400, "guestId is required.");
  }

  const session = await findSessionByCode(code);
  if (!session) throw httpError(404, "No session with that code. Check the code and try again.");
  if (session.status === "ended") throw httpError(400, "This session has already ended.");

  const displayName = String(name || "").trim().slice(0, 60) || "Guest";

  // Upsert on (session_id, guest_id) so a reload or reconnect rejoins the same
  // participant row and keeps the score, rather than creating a duplicate.
  let participant = await q(
    supabase
      .from("participants")
      .select("*")
      .eq("session_id", session.id)
      .eq("guest_id", guestId)
      .maybeSingle(),
    "find participant"
  );

  if (participant) {
    if (participant.name !== displayName) {
      participant = await q(
        supabase
          .from("participants")
          .update({ name: displayName, last_seen_at: new Date().toISOString() })
          .eq("id", participant.id)
          .select("*")
          .single(),
        "update participant name"
      );
    }
  } else {
    participant = await q(
      supabase
        .from("participants")
        .insert({ session_id: session.id, guest_id: guestId, name: displayName })
        .select("*")
        .single(),
      "create participant"
    );
  }

  // Whatever is open right now, with the remaining time, so a late joiner or a
  // reconnecting device lands mid-question instead of on a blank screen.
  let currentActivity = null;
  let endsAt = null;
  if (session.current_activity_id && session.activity_started_at) {
    const activity = await q(
      supabase.from("activities").select("*").eq("id", session.current_activity_id).maybeSingle(),
      "load current activity"
    );
    if (activity && !activity.closed_at) {
      currentActivity = safeActivity(activity);
      endsAt = new Date(session.activity_started_at).getTime() + activity.timer_seconds * 1000;
    }
  }

  // Which questions this device has already answered — the offline queue uses
  // this to avoid re-sending something the server already has.
  const answered = await q(
    supabase.from("responses").select("activity_id").eq("participant_id", participant.id),
    "load answered activities"
  );

  // Load all published activities for this session (safely stripped of correct_answer)
  const publishedActivities = await q(
    supabase
      .from("activities")
      .select("id, session_id, type, question, options, timer_seconds, difficulty, points, order_index, created_at")
      .eq("session_id", session.id)
      .eq("is_published", true)
      .order("order_index", { ascending: true })
      .order("created_at", { ascending: true }),
    "load published activities for participant"
  );

  realtime.emitPresence(session.id);

  res.json({
    session: {
      id: session.id,
      title: session.title,
      sessionCode: session.session_code,
      status: session.status,
      activeCategories: session.active_categories,
    },
    participant: {
      id: participant.id,
      name: participant.name,
      totalScore: participant.total_score,
    },
    currentActivity,
    activities: (publishedActivities || []).map(safeActivity),
    endsAt,
    answeredActivityIds: answered.map((r) => r.activity_id),
    serverNow: Date.now(),
  });
}

// GET /api/join/:code  — lightweight pre-join lookup for the join screen
async function lookupSession(req, res) {
  const session = await findSessionByCode(req.params.code);
  if (!session) throw httpError(404, "No session with that code.");

  res.json({
    session: {
      id: session.id,
      title: session.title,
      sessionCode: session.session_code,
      status: session.status,
      activeCategories: session.active_categories,
    },
  });
}

/**
 * POST /api/join/:sessionId/responses
 * body: { participantId, activityId, answer, clientToken, responseTimeMs }
 *
 * Idempotent by clientToken. The offline queue can retry the same submission
 * as many times as it needs to; the unique index turns a replay into the same
 * 200 response instead of a second score.
 */
async function submitResponse(req, res) {
  const { participantId, activityId, answer, clientToken, responseTimeMs } = req.body;

  if (!participantId || !activityId || !clientToken) {
    throw httpError(400, "participantId, activityId, and clientToken are required.");
  }
  if (answer === undefined || answer === null || String(answer).trim() === "") {
    throw httpError(400, "An answer is required.");
  }

  const participant = await q(
    supabase.from("participants").select("*").eq("id", participantId).maybeSingle(),
    "load participant"
  );
  if (!participant) throw httpError(404, "Join the session before answering.");
  if (participant.session_id !== req.params.sessionId) {
    throw httpError(403, "That participant belongs to a different session.");
  }

  // Replay of something already accepted — acknowledge and stop.
  // Two explicit lookups rather than a string-built .or() filter, so a
  // participant-supplied token can never be interpolated into filter syntax.
  const [byToken, byPair] = await Promise.all([
    q(
      supabase.from("responses").select("*").eq("client_token", String(clientToken)).maybeSingle(),
      "check duplicate token"
    ),
    q(
      supabase
        .from("responses")
        .select("*")
        .eq("activity_id", activityId)
        .eq("participant_id", participantId)
        .maybeSingle(),
      "check existing answer"
    ),
  ]);
  const existing = byToken || byPair;

  if (existing) {
    return res.json({
      duplicate: true,
      result: {
        isCorrect: existing.is_correct,
        pointsAwarded: existing.points_awarded,
        totalScore: participant.total_score,
      },
    });
  }

  const activity = await q(
    supabase.from("activities").select("*").eq("id", activityId).maybeSingle(),
    "load activity for grading"
  );
  if (!activity) throw httpError(404, "That question no longer exists.");
  if (activity.session_id !== participant.session_id) {
    throw httpError(403, "That question belongs to a different session.");
  }

  // Graded the instant it arrives — no batch pass at the end (PRD 9.1).
  const { isCorrect, points } = gradeAnswer(activity, answer);

  let inserted;
  try {
    inserted = await q(
      supabase
        .from("responses")
        .insert({
          activity_id: activityId,
          participant_id: participantId,
          answer: String(answer),
          is_correct: isCorrect,
          points_awarded: points,
          response_time_ms: Number.isFinite(parseInt(responseTimeMs, 10))
            ? parseInt(responseTimeMs, 10)
            : null,
          client_token: clientToken,
        })
        .select("*")
        .single(),
      "save response"
    );
  } catch (err) {
    // Two devices racing the same token, or a retry that overlapped the first
    // request. The row exists either way, so report success.
    if (err.code === "23505") {
      return res.json({
        duplicate: true,
        result: { isCorrect, pointsAwarded: 0, totalScore: participant.total_score },
      });
    }
    throw err;
  }

  const totalScore = await awardPoints(participantId, points);

  // Fan out the consequences of this one answer.
  const sessionId = participant.session_id;
  const [tally, leaderboard, participantCount, answeredRows] = await Promise.all([
    getActivityTally(activity),
    getLeaderboard(sessionId),
    q(supabase.from("participants").select("id").eq("session_id", sessionId), "count participants"),
    q(supabase.from("responses").select("id").eq("activity_id", activityId), "count answers"),
  ]);

  realtime.emitTally({ sessionId, tally: activity.type === "poll" ? tally : maskTally(tally, activity) });
  realtime.emitAnswerStats({
    sessionId,
    activityId,
    answered: answeredRows.length,
    participantCount: participantCount.length,
  });
  realtime.emitLeaderboard({ sessionId, leaderboard });
  realtime.emitScore({
    sessionId,
    participantId,
    totalScore,
    lastResult: { activityId, isCorrect, pointsAwarded: points },
  });

  res.status(201).json({
    response: { id: inserted.id, submittedAt: inserted.submitted_at },
    result: { isCorrect, pointsAwarded: points, totalScore },
  });
}

/**
 * While a quiz question is still open, the live bar chart must not reveal which
 * option is correct — so counts go out but the answer flag does not.
 */
function maskTally(tally, activity) {
  if (activity.closed_at) return tally;
  return {
    ...tally,
    results: tally.results.map((r) => ({ ...r, isCorrect: null })),
  };
}

/**
 * POST /api/join/:sessionId/responses/batch
 * body: { participantId, responses: [{ activityId, answer, clientToken, responseTimeMs }] }
 *
 * The offline queue flushes through here when a device comes back online, so a
 * participant who lost signal for three questions catches up in one round-trip.
 */
async function submitBatch(req, res) {
  const { participantId, responses } = req.body;
  if (!participantId || !Array.isArray(responses)) {
    throw httpError(400, "participantId and a responses array are required.");
  }
  if (responses.length > 100) throw httpError(400, "Too many queued responses in one batch.");

  const results = [];
  for (const item of responses) {
    // Re-enter the single-submit path per item so grading, scoring, and the
    // realtime fan-out stay in exactly one place.
    const fakeReq = { params: req.params, body: { participantId, ...item } };
    const captured = {};
    const fakeRes = {
      status(code) {
        captured.status = code;
        return this;
      },
      json(payload) {
        captured.payload = payload;
        return this;
      },
    };
    try {
      await submitResponse(fakeReq, fakeRes);
      results.push({ clientToken: item.clientToken, ok: true, ...captured.payload });
    } catch (err) {
      results.push({ clientToken: item.clientToken, ok: false, error: err.message, status: err.status || 500 });
    }
  }

  const participant = await q(
    supabase.from("participants").select("total_score").eq("id", participantId).maybeSingle(),
    "read participant score"
  );

  res.json({
    accepted: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    totalScore: participant ? participant.total_score : null,
    results,
  });
}

// GET /api/join/:sessionId/me?participantId=...
async function getParticipantState(req, res) {
  const { participantId } = req.query;
  if (!participantId) throw httpError(400, "participantId is required.");

  const participant = await q(
    supabase.from("participants").select("*").eq("id", participantId).maybeSingle(),
    "load participant"
  );
  if (!participant) throw httpError(404, "Participant not found.");

  const [responses, leaderboard, activities] = await Promise.all([
    q(
      supabase
        .from("responses")
        .select("activity_id, answer, is_correct, points_awarded, response_time_ms, submitted_at")
        .eq("participant_id", participantId),
      "load my responses"
    ),
    getLeaderboard(participant.session_id),
    q(
      supabase
        .from("activities")
        .select("id, type, question, options, correct_answer, timer_seconds, points, order_index")
        .eq("session_id", participant.session_id)
        .eq("is_published", true)
        .order("order_index", { ascending: true })
        .order("created_at", { ascending: true }),
      "load activities for results review"
    ),
  ]);

  const myRank = leaderboard.find((r) => r.participantId === participantId);

  res.json({
    participant: {
      id: participant.id,
      name: participant.name,
      totalScore: participant.total_score,
    },
    rank: myRank ? myRank.rank : null,
    outOf: leaderboard.length,
    responses,
    activities: activities || [],
    leaderboard,
  });
}

module.exports = {
  joinSession,
  lookupSession,
  submitResponse,
  submitBatch,
  getParticipantState,
  findSessionByCode,
};
