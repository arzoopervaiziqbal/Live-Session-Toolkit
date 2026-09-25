const { Op, Sequelize } = require("sequelize");
const Activity = require("../models/Activity");
const Participant = require("../models/Participant");
const Response = require("../models/Response");
const { computeScore } = require("../services/scoring.service");
const { emitToSession } = require("../socket");

function extractCleanCode(raw) {
  if (!raw || typeof raw !== "string") return "";
  let str = raw.trim();
  if (str.includes("code=")) {
    try {
      const u = new URL(str.startsWith("http") ? str : `http://dummy.com/${str}`);
      const c = u.searchParams.get("code");
      if (c) return c.trim();
    } catch (_) {}
  }
  if (str.includes("/")) {
    const parts = str.split("/").filter(Boolean);
    str = parts[parts.length - 1].split("?")[0];
  }
  return str.replace(/^#/, "").trim();
}

async function findActivityByCode(rawCode) {
  const code = extractCleanCode(rawCode);
  if (!code) return null;

  // 1. Case-insensitive lookup on linkId
  let activity = await Activity.findOne({
    where: Sequelize.where(
      Sequelize.fn("lower", Sequelize.col("linkId")),
      code.toLowerCase()
    ),
  });

  // 2. Lookup by exact UUID on activity._id or activity.sessionId
  if (!activity) {
    activity = await Activity.findOne({
      where: {
        [Op.or]: [
          { _id: code },
          { sessionId: code },
        ],
      },
    });
  }

  // 3. Lookup by prefix if code is at least 6 characters (e.g. first segment of UUID)
  if (!activity && code.length >= 6) {
    activity = await Activity.findOne({
      where: {
        [Op.or]: [
          { _id: { [Op.like]: `${code}%` } },
          { sessionId: { [Op.like]: `${code}%` } },
        ],
      },
    });
  }

  return activity;
}

// GET /api/join/:linkId?guestId=xxx&name=xxx
async function getActivityByCode(req, res) {
  const activity = await findActivityByCode(req.params.linkId);
  if (!activity) {
    return res.status(404).json({ error: "No live session with that code." });
  }

  if (activity.status === "closed") {
    return res.status(400).json({ error: "This live session has been closed by the host." });
  }

  // Ensure session is published and available to join
  if (activity.status === "draft") {
    activity.status = "published";
    await activity.save();
  }

  // Don't leak correct answers to participants before they submit.
  const questions = activity.questions || [];
  const safeQuestions = questions.map(({ correctAnswer, ...rest }) => rest);

  const { guestId, name } = req.query;
  if (!guestId) return res.status(400).json({ error: "guestId is required." });

  const displayName = (name || "Guest").trim().slice(0, 60) || "Guest";

  let participant = await Participant.findOne({
    where: { activityId: activity._id, guestId },
  });
  if (!participant) {
    participant = await Participant.create({
      activityId: activity._id,
      guestId,
      displayName,
    });
  }

  const actJson = activity.toJSON ? activity.toJSON() : { ...activity };
  let parsedQaFeed = [];
  if (Array.isArray(actJson.qaFeed)) {
    parsedQaFeed = actJson.qaFeed;
  } else if (typeof actJson.qaFeed === "string") {
    try {
      const p = JSON.parse(actJson.qaFeed);
      if (Array.isArray(p)) parsedQaFeed = p;
    } catch (_) {}
  }
  actJson.qaFeed = parsedQaFeed;
  actJson.questions = safeQuestions;

  res.json({
    activity: actJson,
    participantId: participant._id,
    status: participant.status || "active",
    proctorViolations: participant.proctorViolations || [],
  });
}

// POST /api/join/:linkId/submit  body: { guestId, answers }
async function submitResponses(req, res) {
  const activity = await findActivityByCode(req.params.linkId);
  if (!activity) return res.status(404).json({ error: "No live session with that code." });

  const { guestId, answers } = req.body;
  if (!guestId) return res.status(400).json({ error: "guestId is required." });

  const participant = await Participant.findOne({
    where: { activityId: activity._id, guestId },
  });
  if (!participant) return res.status(400).json({ error: "Join the session before submitting." });

  if (participant.status === "disqualified") {
    return res.status(403).json({
      error: "You have been disqualified by the host for switching tabs or modifying the screen.",
      disqualified: true,
      result: {
        score: 0,
        total: (activity.questions || []).length,
        percentage: 0,
        disqualified: true,
        reason: "Disqualified by host due to screen cropping or tab switching violations.",
      },
    });
  }

  if (!answers || typeof answers !== "object") {
    return res.status(400).json({ error: "Answers are required." });
  }

  const scoreResult = computeScore(activity.questions, answers);
  const scoreByQuestion = Object.fromEntries(scoreResult.details.map((d) => [d.questionId, d.isCorrect]));

  try {
    // Clear any existing responses for this participant to avoid duplicate counting
    await Response.destroy({
      where: { activityId: activity._id, participantId: participant._id },
    });

    const docs = (activity.questions || []).map((q) => {
      const value =
        answers[q.questionId] !== undefined && answers[q.questionId] !== null
          ? answers[q.questionId]
          : "";
      return {
        activityId: activity._id,
        participantId: participant._id,
        questionId: q.questionId,
        answerValue: value,
        isCorrect: scoreByQuestion[q.questionId] ?? false,
      };
    });

    if (docs.length > 0) {
      await Response.bulkCreate(docs);
    }

    let parsedFeed = [];
    if (Array.isArray(activity.qaFeed)) {
      parsedFeed = activity.qaFeed;
    } else if (typeof activity.qaFeed === "string") {
      try {
        const p = JSON.parse(activity.qaFeed);
        if (Array.isArray(p)) parsedFeed = p;
      } catch (_) {}
    }

    res.json({
      result: {
        activityTitle: activity.title,
        participantName: participant.displayName,
        correct: scoreResult.correct,
        scored: scoreResult.scored,
        hasScore: scoreResult.hasScore,
        percentage: scoreResult.scored > 0 ? Math.round((scoreResult.correct / scoreResult.scored) * 100) : null,
        submittedAt: new Date().toISOString(),
        allowQa: Boolean(activity.allowQa),
        linkId: activity.linkId,
        participantId: participant._id,
        qaFeed: parsedFeed,
      },
    });
  } catch (err) {
    console.error("Error submitting responses:", err);
    res.status(500).json({ error: "Failed to save responses. Please try again." });
  }
}

// POST /api/join/:linkId/qa  body: { participantId, displayName, questionText, text }
async function postParticipantQuestion(req, res) {
  const activity = await findActivityByCode(req.params.linkId);
  if (!activity) return res.status(404).json({ error: "No live session with that code." });

  if (!activity.allowQa) {
    return res.status(400).json({ error: "Q&A is not allowed for this session." });
  }

  const { participantId, displayName, questionText, text: bodyText, message } = req.body;
  const text = String(questionText || bodyText || message || "").trim();
  if (!text) {
    return res.status(400).json({ error: "Please enter your question." });
  }

  const senderName = displayName || "Participant";
  const newQ = {
    id: `qa_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    participantId: participantId || null,
    participantName: senderName,
    displayName: senderName,
    text,
    questionText: text,
    answer: "",
    answerText: "",
    isAnswered: false,
    createdAt: new Date().toISOString(),
  };

  let currentFeed = [];
  if (Array.isArray(activity.qaFeed)) {
    currentFeed = activity.qaFeed;
  } else if (typeof activity.qaFeed === "string") {
    try {
      const parsed = JSON.parse(activity.qaFeed);
      if (Array.isArray(parsed)) currentFeed = parsed;
    } catch (_) {}
  }

  const updatedFeed = [...currentFeed, newQ];
  activity.qaFeed = updatedFeed;
  activity.changed("qaFeed", true);
  await activity.save();

  try {
    await Activity.update({ qaFeed: updatedFeed }, { where: { _id: activity._id } });
  } catch (dbErr) {
    console.warn("[join.controller] Activity.update fallback:", dbErr.message);
  }

  // Broadcast to all session aliases so host and participants receive it immediately
  const aliasRooms = new Set([
    String(activity.linkId || "").toLowerCase().trim(),
    String(activity._id || "").toLowerCase().trim(),
    String(activity.sessionId || "").toLowerCase().trim(),
    String(req.params.linkId || "").toLowerCase().trim(),
  ]);

  aliasRooms.forEach((r) => {
    if (r) {
      emitToSession(r, "qa-new-question", { item: newQ, qaFeed: updatedFeed });
    }
  });

  res.status(201).json({ success: true, item: newQ, qaFeed: updatedFeed });
}

// POST /api/join/:linkId/proctor-alert
async function reportProctorAlert(req, res) {
  const activity = await findActivityByCode(req.params.linkId);
  if (!activity) return res.status(404).json({ error: "Session not found." });

  const { guestId, participantId, displayName, violationType, message } = req.body;
  if (!guestId && !participantId) {
    return res.status(400).json({ error: "Participant identification required." });
  }

  let participant = null;
  if (guestId) {
    participant = await Participant.findOne({
      where: { activityId: activity._id, guestId: String(guestId) },
    });
  }
  if (!participant && participantId) {
    participant = await Participant.findOne({
      where: {
        activityId: activity._id,
        [Op.or]: [{ _id: String(participantId) }, { guestId: String(participantId) }],
      },
    });
  }
  if (!participant) {
    return res.status(404).json({ error: "Participant not found." });
  }

  let violations = [];
  if (Array.isArray(participant.proctorViolations)) {
    violations = [...participant.proctorViolations];
  } else if (typeof participant.proctorViolations === "string") {
    try {
      violations = JSON.parse(participant.proctorViolations) || [];
    } catch (_) {}
  }

  if (participant.status !== "disqualified") {
    participant.status = "locked";
  }

  const newAlert = {
    id: `viol-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    participantId: participant._id,
    guestId: participant.guestId,
    displayName: participant.displayName || displayName || "Student",
    violationType: violationType || "tab_switch",
    message: message || "Switched tab or altered screen dimensions during quiz.",
    status: participant.status,
    timestamp: new Date().toISOString(),
  };

  violations.push(newAlert);
  participant.proctorViolations = violations;
  participant.changed("proctorViolations", true);
  await participant.save();

  // Broadcast in real-time to host
  try {
    const aliasRooms = new Set([
      String(activity.linkId || "").toLowerCase().trim(),
      String(activity._id || "").toLowerCase().trim(),
      String(activity.sessionId || "").toLowerCase().trim(),
      String(req.params.linkId || "").toLowerCase().trim(),
    ]);

    aliasRooms.forEach((r) => {
      if (r) {
        emitToSession(r, "quiz-proctor-alert", newAlert);
      }
    });
    emitToSession("hosts", "quiz-proctor-alert", newAlert);
  } catch (err) {
    console.warn("[join.controller] emit proctor alert error:", err);
  }

  res.json({
    success: true,
    status: participant.status || "active",
    totalViolations: violations.length,
    alert: newAlert,
  });
}

module.exports = {
  getActivityByCode,
  submitResponses,
  postParticipantQuestion,
  reportProctorAlert,
};

