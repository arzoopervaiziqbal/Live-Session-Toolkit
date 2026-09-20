// const Session = require("../models/Session");
// const Activity = require("../models/Activity");
// const Participant = require("../models/Participant");
// const Response = require("../models/Response");
// const { generateLinkCode } = require("../utils/generateLink");
// const { extractTextFromFile } = require("../services/fileParser.service");
// const { generateQuestions, clampQuestionCount } = require("../services/ai.service");

// const VALID_CATEGORIES = ["quiz", "poll", "feedback", "qa"];
// const VALID_DIFFICULTIES = ["easy", "medium", "hard"];

// async function createActivity(req, res) {
//   const session = await Session.findOne({ where: { _id: req.params.sessionId, hostId: req.user.id } });
//   if (!session) return res.status(404).json({ error: "Session not found." });

//   const { title, type, difficulty } = req.body;
//   if (!VALID_CATEGORIES.includes(type)) {
//     return res.status(400).json({ errors: { type: "Choose a valid activity type." } });
//   }
//   const chosenDifficulty = VALID_DIFFICULTIES.includes(difficulty) ? difficulty : "medium";

//   const activity = await Activity.create({
//     sessionId: session._id,
//     hostId: req.user.id,
//     type,
//     title: title && title.trim() ? title.trim() : session.title,
//     difficulty: chosenDifficulty,
//     linkId: generateLinkCode(),
//     questions: [],
//     status: "draft",
//   });

//   res.status(201).json({ activity });
// }

// async function uploadNotes(req, res) {
//   const activity = await Activity.findOne({ where: { _id: req.params.id, hostId: req.user.id } });
//   if (!activity) return res.status(404).json({ error: "Activity not found." });

//   let notesText = "";
//   if (req.file) {
//     notesText = await extractTextFromFile(req.file.path);
//   } else if (req.body.notesText) {
//     notesText = req.body.notesText;
//   } else {
//     return res.status(400).json({ error: "Upload a file or provide notesText." });
//   }

//   activity.sourceNotesText = notesText;
//   await activity.save();
//   res.json({ activity });
// }

// async function updateActivity(req, res) {
//   const activity = await Activity.findOne({ where: { _id: req.params.id, hostId: req.user.id } });
//   if (!activity) return res.status(404).json({ error: "Activity not found." });

//   const { title, difficulty, expiresAt } = req.body;
//   if (title !== undefined) {
//     if (typeof title !== "string" || !title.trim()) {
//       return res.status(400).json({ errors: { title: "Give the quiz a name." } });
//     }
//     activity.title = title.trim();
//   }
//   if (difficulty !== undefined) {
//     if (!VALID_DIFFICULTIES.includes(difficulty)) {
//       return res.status(400).json({ errors: { difficulty: "Choose a valid difficulty." } });
//     }
//     activity.difficulty = difficulty;
//   }
//   if (expiresAt !== undefined) {
//     if (expiresAt && Number.isNaN(new Date(expiresAt).getTime())) {
//       return res.status(400).json({ errors: { expiresAt: "Choose a valid date." } });
//     }
//     activity.expiresAt = expiresAt || null;
//   }

//   await activity.save();
//   res.json({ activity });
// }

// async function generate(req, res) {
//   const activity = await Activity.findOne({ where: { _id: req.params.id, hostId: req.user.id } });
//   if (!activity) return res.status(404).json({ error: "Activity not found." });

//   if (!activity.sourceNotesText || !activity.sourceNotesText.trim()) {
//     return res.status(400).json({ error: "Upload or paste notes before generating." });
//   }

//   try {
//     const questions = await generateQuestions({
//       category: activity.type,
//       difficulty: activity.difficulty,
//       notesText: activity.sourceNotesText,
//       language: req.body.language || "English",
//       questionCount: clampQuestionCount(req.body.questionCount),
//     });
//     activity.questions = questions;
//     await activity.save();
//     res.json({ activity });
//   } catch (err) {
//     res.status(502).json({ error: err.message });
//   }
// }

// async function updateQuestion(req, res) {
//   const activity = await Activity.findOne({ where: { _id: req.params.id, hostId: req.user.id } });
//   if (!activity) return res.status(404).json({ error: "Activity not found." });

//   const questions = activity.questions || [];
//   const question = questions.find((q) => q.questionId === req.params.qId);
//   if (!question) return res.status(404).json({ error: "Question not found." });

//   const { questionText, options, correctAnswer } = req.body;
//   if (questionText !== undefined) question.questionText = questionText;
//   if (options !== undefined) question.options = options;
//   if (correctAnswer !== undefined) question.correctAnswer = correctAnswer;

//   activity.questions = [...questions];
//   await activity.save();
//   res.json({ activity });
// }

// async function addQuestion(req, res) {
//   const activity = await Activity.findOne({ where: { _id: req.params.id, hostId: req.user.id } });
//   if (!activity) return res.status(404).json({ error: "Activity not found." });

//   const questions = activity.questions || [];
//   const defaultType = activity.type === "quiz" ? "mcq" : activity.type === "poll" ? "poll" : "open_text";
//   questions.push({
//     questionId: `q${questions.length + 1}_${Date.now().toString(36)}`,
//     type: defaultType,
//     questionText: "",
//     options: defaultType === "mcq" || defaultType === "poll" ? ["", "", "", ""] : [],
//     correctAnswer: null,
//     orderIndex: questions.length,
//     aiGenerated: false,
//   });
//   activity.questions = questions;
//   await activity.save();
//   res.json({ activity });
// }

// async function removeQuestion(req, res) {
//   const activity = await Activity.findOne({ where: { _id: req.params.id, hostId: req.user.id } });
//   if (!activity) return res.status(404).json({ error: "Activity not found." });

//   activity.questions = (activity.questions || []).filter((q) => q.questionId !== req.params.qId);
//   await activity.save();
//   res.json({ activity });
// }

// async function publish(req, res) {
//   const activity = await Activity.findOne({ where: { _id: req.params.id, hostId: req.user.id } });
//   if (!activity) return res.status(404).json({ error: "Activity not found." });
//   if (!activity.questions || activity.questions.length === 0) {
//     return res.status(400).json({ error: "Add at least one question before publishing." });
//   }
//   activity.status = "published";
//   await activity.save();
//   res.json({ activity });
// }

// async function closeActivity(req, res) {
//   const activity = await Activity.findOne({ where: { _id: req.params.id, hostId: req.user.id } });
//   if (!activity) return res.status(404).json({ error: "Activity not found." });
//   activity.status = "closed";
//   await activity.save();
//   res.json({ activity });
// }

// async function getResults(req, res) {
//   const activity = await Activity.findOne({ where: { _id: req.params.id, hostId: req.user.id } });
//   if (!activity) return res.status(404).json({ error: "Activity not found." });

//   const participants = await Participant.findAll({ where: { activityId: activity._id } });
//   const responses = await Response.findAll({ where: { activityId: activity._id } });

//   const byQuestion = {};
//   (activity.questions || []).forEach((q) => {
//     byQuestion[q.questionId] = { questionText: q.questionText, type: q.type, answers: [] };
//   });
//   responses.forEach((r) => {
//     if (byQuestion[r.questionId]) {
//       byQuestion[r.questionId].answers.push({ value: r.answerValue, isCorrect: r.isCorrect });
//     }
//   });

//   res.json({
//     activity,
//     totalParticipants: participants.length,
//     totalResponses: responses.length,
//     byQuestion,
//   });
// }

// async function exportCsv(req, res) {
//   const activity = await Activity.findOne({ where: { _id: req.params.id, hostId: req.user.id } });
//   if (!activity) return res.status(404).json({ error: "Activity not found." });

//   const participants = await Participant.findAll({ where: { activityId: activity._id } });
//   const responses = await Response.findAll({ where: { activityId: activity._id } });
//   const participantById = new Map(participants.map((p) => [String(p._id), p]));

//   const rows = [["Participant", "Question ID", "Answer", "Correct", "Submitted At"]];
//   responses.forEach((r) => {
//     const p = participantById.get(String(r.participantId));
//     rows.push([
//       p ? p.displayName : "Unknown",
//       r.questionId,
//       JSON.stringify(r.answerValue),
//       r.isCorrect === null ? "" : String(r.isCorrect),
//       r.submittedAt ? new Date(r.submittedAt).toISOString() : "",
//     ]);
//   });

//   const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");

//   res.setHeader("Content-Type", "text/csv");
//   res.setHeader("Content-Disposition", `attachment; filename="activity-${activity.linkId}-results.csv"`);
//   res.send(csv);
// }

// module.exports = {
//   createActivity,
//   uploadNotes,
//   generate,
//   updateQuestion,
//   addQuestion,
//   removeQuestion,
//   publish,
//   closeActivity,
//   getResults,
//   updateActivity,
// };


const Session = require("../models/Session");
const Activity = require("../models/Activity");
const Participant = require("../models/Participant");
const Response = require("../models/Response");
const { generateLinkCode } = require("../utils/generateLink");
const { extractTextFromFile } = require("../services/fileParser.service");
const { generateQuestions, clampQuestionCount } = require("../services/ai.service");
const { getEffectiveCorrectAnswer } = require("../services/scoring.service");

const VALID_CATEGORIES = ["quiz", "poll", "feedback", "qa"];
const VALID_DIFFICULTIES = ["easy", "medium", "hard"];

async function createActivity(req, res) {
  const session = await Session.findOne({ where: { _id: req.params.sessionId, hostId: req.user.id } });
  if (!session) return res.status(404).json({ error: "Session not found." });

  const { title, type, difficulty } = req.body;
  if (!VALID_CATEGORIES.includes(type)) {
    return res.status(400).json({ errors: { type: "Choose a valid activity type." } });
  }
  const chosenDifficulty = VALID_DIFFICULTIES.includes(difficulty) ? difficulty : "medium";

  const activity = await Activity.create({
    sessionId: session._id,
    hostId: req.user.id,
    type,
    title: title && title.trim() ? title.trim() : session.title,
    difficulty: chosenDifficulty,
    linkId: generateLinkCode(),
    questions: [],
    status: "draft",
  });

  res.status(201).json({ activity });
}

async function uploadNotes(req, res) {
  const activity = await Activity.findOne({ where: { _id: req.params.id, hostId: req.user.id } });
  if (!activity) return res.status(404).json({ error: "Activity not found." });

  let notesText = "";
  if (req.file) {
    notesText = await extractTextFromFile(req.file.path);
  } else if (req.body.notesText) {
    notesText = req.body.notesText;
  } else {
    return res.status(400).json({ error: "Upload a file or provide notesText." });
  }

  activity.sourceNotesText = notesText;
  await activity.save();
  res.json({ activity });
}

async function generate(req, res) {
  const activity = await Activity.findOne({ where: { _id: req.params.id, hostId: req.user.id } });
  if (!activity) return res.status(404).json({ error: "Activity not found." });

  const notesText = req.body.notesText || activity.sourceNotesText;
  if (!notesText || !notesText.trim()) {
    return res.status(400).json({ error: "Upload or paste notes before generating." });
  }

  if (req.body.notesText && req.body.notesText.trim()) {
    activity.sourceNotesText = req.body.notesText.trim();
  }

  try {
    const questions = await generateQuestions({
      category: activity.type,
      difficulty: activity.difficulty,
      notesText: notesText,
      language: req.body.language || "English",
      questionCount: clampQuestionCount(req.body.questionCount),
    });

    if (req.body.append) {
      const existing = activity.questions || [];
      const shaped = questions.map((q, idx) => ({
        ...q,
        questionId: `q${existing.length + idx + 1}_${Date.now().toString(36)}_${idx}`,
        orderIndex: existing.length + idx,
      }));
      activity.questions = [...existing, ...shaped];
    } else {
      activity.questions = questions;
    }

    await activity.save();
    res.json({ activity });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
}

async function updateActivity(req, res) {
  const activity = await Activity.findOne({ where: { _id: req.params.id, hostId: req.user.id } });
  if (!activity) return res.status(404).json({ error: "Activity not found." });

  const { title, difficulty, expiresAt } = req.body;
  if (title !== undefined) {
    if (typeof title !== "string" || !title.trim()) {
      return res.status(400).json({ errors: { title: "Give the quiz a name." } });
    }
    activity.title = title.trim();
  }
  if (difficulty !== undefined) {
    if (!VALID_DIFFICULTIES.includes(difficulty)) {
      return res.status(400).json({ errors: { difficulty: "Choose a valid difficulty." } });
    }
    activity.difficulty = difficulty;
  }
  if (expiresAt !== undefined) {
    if (expiresAt && Number.isNaN(new Date(expiresAt).getTime())) {
      return res.status(400).json({ errors: { expiresAt: "Choose a valid date." } });
    }
    activity.expiresAt = expiresAt || null;
  }

  await activity.save();
  res.json({ activity });
}

async function updateQuestion(req, res) {
  const activity = await Activity.findOne({ where: { _id: req.params.id, hostId: req.user.id } });
  if (!activity) return res.status(404).json({ error: "Activity not found." });

  const questions = activity.questions || [];
  const question = questions.find((q) => q.questionId === req.params.qId);
  if (!question) return res.status(404).json({ error: "Question not found." });

  const { questionText, options, correctAnswer } = req.body;
  if (questionText !== undefined) question.questionText = questionText;
  if (options !== undefined) question.options = options;
  if (correctAnswer !== undefined) question.correctAnswer = correctAnswer;

  activity.questions = [...questions];
  await activity.save();
  res.json({ activity });
}

async function addQuestion(req, res) {
  const activity = await Activity.findOne({ where: { _id: req.params.id, hostId: req.user.id } });
  if (!activity) return res.status(404).json({ error: "Activity not found." });

  const count = Math.min(20, Math.max(1, parseInt(req.body.count || 1, 10)));
  const questions = [...(activity.questions || [])];
  const defaultType = activity.type === "quiz" ? "mcq" : activity.type === "poll" ? "poll" : "open_text";

  for (let i = 0; i < count; i++) {
    questions.push({
      questionId: `q${questions.length + 1}_${Date.now().toString(36)}_${i}`,
      type: defaultType,
      questionText: "",
      options: defaultType === "mcq" || defaultType === "poll" ? ["", "", "", ""] : [],
      correctAnswer: null,
      orderIndex: questions.length,
      aiGenerated: false,
    });
  }
  activity.questions = questions;
  await activity.save();
  res.json({ activity });
}

async function removeQuestion(req, res) {
  const activity = await Activity.findOne({ where: { _id: req.params.id, hostId: req.user.id } });
  if (!activity) return res.status(404).json({ error: "Activity not found." });

  activity.questions = (activity.questions || []).filter((q) => q.questionId !== req.params.qId);
  await activity.save();
  res.json({ activity });
}

async function publish(req, res) {
  const activity = await Activity.findOne({ where: { _id: req.params.id, hostId: req.user.id } });
  if (!activity) return res.status(404).json({ error: "Activity not found." });
  if (!activity.questions || activity.questions.length === 0) {
    return res.status(400).json({ error: "Add at least one question before publishing." });
  }
  activity.status = "published";
  await activity.save();
  res.json({ activity });
}

async function closeActivity(req, res) {
  const activity = await Activity.findOne({ where: { _id: req.params.id, hostId: req.user.id } });
  if (!activity) return res.status(404).json({ error: "Activity not found." });
  activity.status = "closed";
  await activity.save();
  res.json({ activity });
}

async function getResults(req, res) {
  const activity = await Activity.findOne({ where: { _id: req.params.id, hostId: req.user.id } });
  if (!activity) return res.status(404).json({ error: "Activity not found." });

  const participants = await Participant.findAll({
    where: { activityId: activity._id },
    order: [["joinedAt", "DESC"]],
  });
  const responses = await Response.findAll({
    where: { activityId: activity._id },
    order: [["submittedAt", "ASC"]],
  });

  const byQuestion = {};
  (activity.questions || []).forEach((q) => {
    byQuestion[q.questionId] = { questionText: q.questionText, type: q.type, correctAnswer: q.correctAnswer, answers: [] };
  });
  responses.forEach((r) => {
    if (byQuestion[r.questionId]) {
      byQuestion[r.questionId].answers.push({ value: r.answerValue, isCorrect: r.isCorrect, participantId: r.participantId });
    }
  });

  // Group responses by participant
  const responsesByParticipant = new Map();
  responses.forEach((r) => {
    const pId = String(r.participantId);
    if (!responsesByParticipant.has(pId)) {
      responsesByParticipant.set(pId, []);
    }
    responsesByParticipant.get(pId).push(r);
  });

  const scorableQuestions = (activity.questions || []).filter(
    (q) => getEffectiveCorrectAnswer(q) !== null || q.type === "mcq"
  );
  const totalScorable = scorableQuestions.length > 0
    ? scorableQuestions.length
    : (activity.questions ? activity.questions.length : 0);

  const students = participants.map((p) => {
    const pResponses = responsesByParticipant.get(String(p._id)) || [];
    const isDone = pResponses.length > 0;
    const responseByQId = new Map(pResponses.map((r) => [r.questionId, r]));

    let correctCount = 0;
    (activity.questions || []).forEach((q) => {
      const resp = responseByQId.get(q.questionId);
      if (!resp) return;

      const effCorrect = getEffectiveCorrectAnswer(q);
      const isCorrectFlag = resp.isCorrect === true || resp.isCorrect === 1 || resp.isCorrect === "true";
      const matchesAnswer =
        effCorrect !== null &&
        resp.answerValue !== undefined &&
        resp.answerValue !== null &&
        String(resp.answerValue).trim().toLowerCase() === effCorrect.toLowerCase();

      if (isCorrectFlag || matchesAnswer) {
        correctCount += 1;
      }
    });

    const studentAnswers = (activity.questions || []).map((q) => {
      const resp = responseByQId.get(q.questionId);
      return {
        questionId: q.questionId,
        questionText: q.questionText,
        type: q.type,
        options: q.options || [],
        answerValue: resp ? resp.answerValue : null,
        isCorrect: resp ? resp.isCorrect : null,
        correctAnswer: q.correctAnswer || null,
      };
    });

    const latestSubmission = pResponses.length > 0
      ? pResponses.reduce((latest, r) => (!latest || new Date(r.submittedAt) > new Date(latest) ? r.submittedAt : latest), null)
      : null;

    const percentage = totalScorable > 0 ? Math.round((correctCount / totalScorable) * 100) : 0;

    return {
      participantId: p._id,
      displayName: p.displayName,
      guestId: p.guestId,
      joinedAt: p.joinedAt,
      isDone,
      submittedAt: latestSubmission,
      score: {
        correct: correctCount,
        total: totalScorable,
        percentage,
      },
      answers: studentAnswers,
    };
  });

  const completedStudents = students.filter((s) => s.isDone);
  const averageScore = completedStudents.length > 0 && totalScorable > 0
    ? Math.round(
        completedStudents.reduce((sum, s) => sum + (s.score.percentage || 0), 0) / completedStudents.length
      )
    : 0;

  res.json({
    activity,
    totalParticipants: participants.length,
    totalResponses: responses.length,
    completedParticipants: completedStudents.length,
    pendingParticipants: participants.length - completedStudents.length,
    averageScore,
    byQuestion,
    students,
  });
}

async function exportCsv(req, res) {
  const activity = await Activity.findOne({ where: { _id: req.params.id, hostId: req.user.id } });
  if (!activity) return res.status(404).json({ error: "Activity not found." });

  const participants = await Participant.findAll({ where: { activityId: activity._id } });
  const responses = await Response.findAll({ where: { activityId: activity._id } });
  const participantById = new Map(participants.map((p) => [String(p._id), p]));

  const rows = [["Participant", "Question ID", "Answer", "Correct", "Submitted At"]];
  responses.forEach((r) => {
    const p = participantById.get(String(r.participantId));
    rows.push([
      p ? p.displayName : "Unknown",
      r.questionId,
      JSON.stringify(r.answerValue),
      r.isCorrect === null ? "" : String(r.isCorrect),
      r.submittedAt ? new Date(r.submittedAt).toISOString() : "",
    ]);
  });

  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="activity-${activity.linkId}-results.csv"`);
  res.send(csv);
}

module.exports = {
  createActivity,
  uploadNotes,
  generate,
  updateActivity,
  updateQuestion,
  addQuestion,
  removeQuestion,
  publish,
  closeActivity,
  getResults,
  exportCsv,
};