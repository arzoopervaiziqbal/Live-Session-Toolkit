const { supabase, q } = require("../config/db");
const { httpError } = require("../middleware/error");
const { ownedSession } = require("./session.controller");
const { generateActivities, clampQuestionCount } = require("../services/ai.service");
const {
  getActivityTally,
  getLeaderboard,
  getDetailedLeaderboard,
  getPollStudentVotes,
} = require("../services/scoring.service");
const { VALID_DIFFICULTIES } = require("../utils/validators");
const realtime = require("../realtime/gateway");

async function ownedActivity(activityId, hostId) {
  const activity = await q(
    supabase.from("activities").select("*").eq("id", activityId).maybeSingle(),
    "load activity"
  );
  if (!activity) throw httpError(404, "Question not found.");
  const session = await ownedSession(activity.session_id, hostId);
  return { activity, session };
}

async function nextOrderIndex(sessionId) {
  const rows = await q(
    supabase
      .from("activities")
      .select("order_index")
      .eq("session_id", sessionId)
      .order("order_index", { ascending: false })
      .limit(1),
    "read max order index"
  );
  return rows.length ? rows[0].order_index + 1 : 0;
}

// ---------------------------------------------------------------------------
// AI generation
// ---------------------------------------------------------------------------

// POST /api/sessions/:sessionId/activities/generate
async function generate(req, res) {
  const session = await ownedSession(req.params.sessionId, req.user.id);

  const notesText = (req.body.notesText || session.source_notes_text || "").trim();
  if (!notesText) throw httpError(400, "Upload or paste your session material before generating.");

  const type = req.body.type === "poll" ? "poll" : "quiz";
  const difficulty = VALID_DIFFICULTIES.includes(req.body.difficulty) ? req.body.difficulty : "medium";
  const questionCount = clampQuestionCount(req.body.questionCount);
  const language = typeof req.body.language === "string" ? req.body.language : "English";
  const fileHash = req.body.fileHash || undefined;

  let items;
  try {
    items = await generateActivities({
      type,
      notesText,
      difficulty,
      language,
      questionCount,
      fileHash,
    });
  } catch (err) {
    if (
      err.status === 429 ||
      err.isQuotaExhausted ||
      (err.message && (err.message.toLowerCase().includes("quota") || err.message.toLowerCase().includes("rate limit")))
    ) {
      console.warn(`[activity.controller] AI quota/rate-limit error: ${err.message}`);
      return res.status(429).json({
        success: false,
        error: "AI service quota temporarily exhausted. Please try again in a few minutes or provide questions manually.",
      });
    }
    throw err;
  }

  let orderIndex = await nextOrderIndex(session.id);
  const rows = items.map((item) => ({
    session_id: session.id,
    type: item.type,
    question: item.question,
    options: item.options,
    correct_answer: item.correct_answer,
    timer_seconds: item.timer_seconds,
    difficulty: item.difficulty,
    // Everything lands as an unpublished draft. Nothing reaches a participant
    // until the host has reviewed it (PRD 6.1).
    is_published: false,
    ai_generated: true,
    order_index: orderIndex++,
  }));

  const created = await q(
    supabase.from("activities").insert(rows).select("*"),
    "save generated drafts"
  );

  // Persist the notes so a later "generate more" doesn't need a re-upload.
  if (req.body.notesText && req.body.notesText.trim() !== session.source_notes_text) {
    await q(
      supabase.from("sessions").update({ source_notes_text: notesText }).eq("id", session.id),
      "save notes"
    );
  }

  res.status(201).json({
    success: true,
    activities: created,
    requested: questionCount,
    generated: created.length,
  });
}

// ---------------------------------------------------------------------------
// Draft review: list / create / edit / delete / publish
// ---------------------------------------------------------------------------

// GET /api/sessions/:sessionId/activities?status=draft|published|all
async function listActivities(req, res) {
  const session = await ownedSession(req.params.sessionId, req.user.id);

  let builder = supabase
    .from("activities")
    .select("*")
    .eq("session_id", session.id)
    .order("order_index", { ascending: true })
    .order("created_at", { ascending: true });

  if (req.query.status === "draft") builder = builder.eq("is_published", false);
  if (req.query.status === "published") builder = builder.eq("is_published", true);

  const activities = await q(builder, "list activities");
  res.json({ activities });
}

// POST /api/sessions/:sessionId/activities   — manual question
async function createActivity(req, res) {
  const session = await ownedSession(req.params.sessionId, req.user.id);

  const type = req.body.type === "poll" ? "poll" : "quiz";
  const options = Array.isArray(req.body.options) && req.body.options.length
    ? req.body.options.map((o) => String(o))
    : ["", "", "", ""];

  const activity = await q(
    supabase
      .from("activities")
      .insert({
        session_id: session.id,
        type,
        question: String(req.body.question || "").trim(),
        options,
        correct_answer: type === "quiz" ? req.body.correctAnswer || null : null,
        timer_seconds: Math.min(600, Math.max(5, parseInt(req.body.timerSeconds, 10) || 30)),
        difficulty: VALID_DIFFICULTIES.includes(req.body.difficulty) ? req.body.difficulty : "medium",
        is_published: false,
        ai_generated: false,
        order_index: await nextOrderIndex(session.id),
      })
      .select("*")
      .single(),
    "create activity"
  );

  res.status(201).json({ activity });
}

// PATCH /api/activities/:id
async function updateActivity(req, res) {
  const { activity } = await ownedActivity(req.params.id, req.user.id);
  const { question, options, correctAnswer, timerSeconds, difficulty, orderIndex, type } = req.body;

  const patch = {};

  if (type !== undefined) {
    if (!["quiz", "poll"].includes(type)) throw httpError(400, "Type must be quiz or poll.");
    patch.type = type;
    if (type === "poll") patch.correct_answer = null;
  }

  if (question !== undefined) {
    if (!String(question).trim()) {
      throw httpError(400, "The question can't be empty.", { question: "The question can't be empty." });
    }
    patch.question = String(question).trim();
  }

  if (options !== undefined) {
    if (!Array.isArray(options)) throw httpError(400, "Options must be a list.");
    const cleaned = options.map((o) => String(o).trim()).filter(Boolean);
    if (cleaned.length < 2) {
      throw httpError(400, "Give at least two answer options.", { options: "Give at least two answer options." });
    }
    patch.options = cleaned;
  }

  if (correctAnswer !== undefined) {
    patch.correct_answer =
      correctAnswer === null || !String(correctAnswer).trim() ? null : String(correctAnswer).trim();
  }

  if (timerSeconds !== undefined) {
    const t = parseInt(timerSeconds, 10);
    if (!Number.isFinite(t) || t < 5 || t > 600) {
      throw httpError(400, "Timer must be between 5 and 600 seconds.", {
        timerSeconds: "Timer must be between 5 and 600 seconds.",
      });
    }
    patch.timer_seconds = t;
  }

  if (difficulty !== undefined) {
    if (!VALID_DIFFICULTIES.includes(difficulty)) throw httpError(400, "Choose a valid difficulty.");
    patch.difficulty = difficulty;
  }

  if (orderIndex !== undefined) patch.order_index = parseInt(orderIndex, 10) || 0;

  // A quiz question is only gradeable if the answer key is one of the options.
  const finalType = patch.type ?? activity.type;
  const finalOptions = patch.options ?? activity.options;
  const finalCorrect = patch.correct_answer !== undefined ? patch.correct_answer : activity.correct_answer;

  if (finalType === "quiz" && finalCorrect) {
    const match = finalOptions.find((o) => String(o).trim().toLowerCase() === String(finalCorrect).trim().toLowerCase());
    if (!match) {
      throw httpError(400, "The correct answer must be one of the options.", {
        correctAnswer: "The correct answer must be one of the options.",
      });
    }
    patch.correct_answer = match; // snap to exact option text
  }

  const updated = await q(
    supabase.from("activities").update(patch).eq("id", activity.id).select("*").single(),
    "update activity"
  );

  res.json({ activity: updated });
}

// DELETE /api/activities/:id
async function deleteActivity(req, res) {
  const { activity, session } = await ownedActivity(req.params.id, req.user.id);

  if (session.current_activity_id === activity.id) {
    throw httpError(400, "That question is live right now. Close it before deleting.");
  }

  await q(supabase.from("activities").delete().eq("id", activity.id), "delete activity");
  res.json({ success: true });
}

// POST /api/sessions/:sessionId/activities/publish   body: { activityIds?: [] }
async function publishActivities(req, res) {
  const session = await ownedSession(req.params.sessionId, req.user.id);

  let builder = supabase
    .from("activities")
    .update({ is_published: true })
    .eq("session_id", session.id)
    .eq("is_published", false);

  if (Array.isArray(req.body.activityIds) && req.body.activityIds.length) {
    builder = builder.in("id", req.body.activityIds);
  }

  // Refuse to publish anything a participant couldn't actually answer.
  const candidates = await q(
    supabase
      .from("activities")
      .select("*")
      .eq("session_id", session.id)
      .eq("is_published", false),
    "load drafts"
  );

  const targets = Array.isArray(req.body.activityIds) && req.body.activityIds.length
    ? candidates.filter((a) => req.body.activityIds.includes(a.id))
    : candidates;

  const invalid = targets.filter((a) => {
    const hasQuestion = a.question && a.question.trim().length > 0;
    const validOptions = (a.options || []).filter((o) => String(o).trim().length > 0);
    const hasOptions = validOptions.length >= 2;
    const hasCorrectAnswer =
      a.type !== "quiz" ||
      (a.correct_answer &&
        String(a.correct_answer).trim().length > 0 &&
        validOptions.some((o) => String(o).trim().toLowerCase() === String(a.correct_answer).trim().toLowerCase()));

    return !hasQuestion || !hasOptions || !hasCorrectAnswer;
  });

  if (invalid.length) {
    const errorDetails = invalid.map((a) => {
      const missing = [];
      if (!a.question || !a.question.trim()) missing.push("question text");
      const validOptions = (a.options || []).filter((o) => String(o).trim().length > 0);
      if (validOptions.length < 2) missing.push(`at least 2 options (has ${validOptions.length})`);
      if (a.type === "quiz") {
        if (!a.correct_answer || !String(a.correct_answer).trim()) {
          missing.push("a correct answer marked");
        } else if (!validOptions.some((o) => String(o).trim().toLowerCase() === String(a.correct_answer).trim().toLowerCase())) {
          missing.push("correct answer matching one of the options");
        }
      }
      return `"${(a.question || 'Untitled').slice(0, 30)}" (${missing.join(", ")})`;
    });

    throw httpError(
      400,
      `${invalid.length} question${invalid.length === 1 ? "" : "s"} need attention before publishing: ${errorDetails.join("; ")}`,
      { invalidIds: invalid.map((a) => a.id) }
    );
  }

  const published = await q(builder.select("*"), "publish activities");
  res.json({ published: published.length, activities: published });
}

// POST /api/activities/:id/unpublish
async function unpublishActivity(req, res) {
  const { activity } = await ownedActivity(req.params.id, req.user.id);
  const updated = await q(
    supabase.from("activities").update({ is_published: false }).eq("id", activity.id).select("*").single(),
    "unpublish activity"
  );
  res.json({ activity: updated });
}

// ---------------------------------------------------------------------------
// Live control: push and close
// ---------------------------------------------------------------------------

// POST /api/activities/:id/push
async function pushActivity(req, res) {
  const { activity, session } = await ownedActivity(req.params.id, req.user.id);

  if (session.status !== "active") throw httpError(400, "Start the session before pushing a question.");
  if (!activity.is_published) throw httpError(400, "Publish this question before pushing it live.");

  // Close whatever is still open so two questions can never run at once.
  if (session.current_activity_id && session.current_activity_id !== activity.id) {
    await closeActivityInternal({
      sessionId: session.id,
      activityId: session.current_activity_id,
      reason: "superseded",
    });
  }

  const startedAtIso = new Date().toISOString();

  await q(
    supabase
      .from("activities")
      .update({ closed_at: null })
      .eq("id", activity.id),
    "reopen activity"
  );

  await q(
    supabase
      .from("sessions")
      .update({ current_activity_id: activity.id, activity_started_at: startedAtIso })
      .eq("id", session.id),
    "set current activity"
  );

  const { startedAt, endsAt } = realtime.pushActivity({
    sessionId: session.id,
    activity: { ...activity, closed_at: null },
    startedAt: new Date(startedAtIso).getTime(),
  });

  res.json({ activity, startedAt, endsAt, serverNow: Date.now() });
}

/**
 * Shared close path. Called by the host endpoint and by the realtime
 * auto-close timer, so both produce identical state and identical broadcasts.
 */
async function closeActivityInternal({ sessionId, activityId, reason = "host" }) {
  const activity = await q(
    supabase.from("activities").select("*").eq("id", activityId).maybeSingle(),
    "load activity to close"
  );
  if (!activity || activity.closed_at) return null;

  await q(
    supabase.from("activities").update({ closed_at: new Date().toISOString() }).eq("id", activityId),
    "close activity"
  );

  const session = await q(
    supabase.from("sessions").select("*").eq("id", sessionId).maybeSingle(),
    "load session on close"
  );
  if (session && session.current_activity_id === activityId) {
    await q(
      supabase
        .from("sessions")
        .update({ current_activity_id: null, activity_started_at: null })
        .eq("id", sessionId),
      "clear current activity"
    );
  }

  const [tally, detailedLeaderboard, pollDetails] = await Promise.all([
    getActivityTally(activity),
    getDetailedLeaderboard(sessionId),
    activity.type === "poll" ? getPollStudentVotes(activityId, sessionId) : Promise.resolve(null),
  ]);

  realtime.emitActivityEnded({
    sessionId,
    activityId,
    activityType: activity.type,
    tally,
    leaderboard: detailedLeaderboard,
    details: activity.type === "poll" ? pollDetails : { correctAnswer: activity.correct_answer },
  });

  // ---- Bulk mode: auto-push next unpushed published activity ----
  if (session && session.push_mode === "bulk" && session.status === "active") {
    try {
      const allPublished = await q(
        supabase
          .from("activities")
          .select("*")
          .eq("session_id", sessionId)
          .eq("is_published", true)
          .order("order_index", { ascending: true })
          .order("created_at", { ascending: true }),
        "load published for bulk advance"
      );

      // Find next activity that hasn't been closed yet and isn't the current one
      const next = allPublished.find((a) => !a.closed_at && a.id !== activityId);

      if (next) {
        const startedAtIso = new Date().toISOString();

        await q(
          supabase.from("activities").update({ closed_at: null }).eq("id", next.id),
          "reopen next activity"
        );

        await q(
          supabase
            .from("sessions")
            .update({ current_activity_id: next.id, activity_started_at: startedAtIso })
            .eq("id", sessionId),
          "set next activity in bulk"
        );

        const { startedAt, endsAt } = realtime.pushActivity({
          sessionId,
          activity: { ...next, closed_at: null },
          startedAt: new Date(startedAtIso).getTime(),
        });

        const currentIndex = allPublished.findIndex((a) => a.id === next.id);
        realtime.emitAutoNext({
          sessionId,
          activity: next,
          startedAt,
          endsAt,
          index: currentIndex + 1,
          total: allPublished.length,
        });
      }
    } catch (err) {
      console.error("[activity] bulk auto-advance failed:", err.message);
    }
  }

  return { activity, tally, leaderboard: detailedLeaderboard, pollDetails, reason };
}


// POST /api/activities/:id/end  (and POST /api/activities/:id/close)
async function endActivity(req, res) {
  const { activity, session } = await ownedActivity(req.params.id, req.user.id);
  const result = await closeActivityInternal({
    sessionId: session.id,
    activityId: activity.id,
    reason: "host",
  });

  const [tally, detailedLeaderboard, pollDetails] = await Promise.all([
    getActivityTally(activity),
    getDetailedLeaderboard(session.id),
    activity.type === "poll" ? getPollStudentVotes(activity.id, session.id) : Promise.resolve(null),
  ]);

  res.json({
    success: true,
    status: "ended",
    activity: result?.activity || { ...activity, closed_at: activity.closed_at || new Date().toISOString() },
    activityType: activity.type,
    tally: result?.tally || tally,
    leaderboard: detailedLeaderboard,
    pollDetails,
  });
}

// Keep closeActivity as alias
const closeActivity = endActivity;

// GET /api/activities/:id/results
async function getActivityResults(req, res) {
  const { activity, session } = await ownedActivity(req.params.id, req.user.id);
  const [tally, detailedLeaderboard, pollDetails] = await Promise.all([
    getActivityTally(activity),
    getDetailedLeaderboard(session.id),
    activity.type === "poll" ? getPollStudentVotes(activity.id, session.id) : Promise.resolve(null),
  ]);
  res.json({
    activity,
    tally,
    leaderboard: detailedLeaderboard,
    pollDetails,
  });
}

module.exports = {
  listActivities,
  generate,
  createActivity,
  updateActivity,
  deleteActivity,
  publishActivities,
  unpublishActivity,
  pushActivity,
  closeActivity,
  endActivity,
  closeActivityInternal,
  getActivityResults,
};
