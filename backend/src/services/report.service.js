const { supabase, q } = require("../config/db");
const { toCsv } = require("../utils/csv");

/**
 * Builds the one consolidated view of everything that happened in a session:
 * scoreboard, per-question breakdown, poll summary, and the full Q&A log
 * (PRD 9.2). Pulled in four batched queries rather than per-participant loops.
 */
async function buildSessionReport(session) {
  const [activities, participants, qaItems] = await Promise.all([
    q(
      supabase
        .from("activities")
        .select("*")
        .eq("session_id", session.id)
        .eq("is_published", true)
        .order("order_index", { ascending: true }),
      "report: activities"
    ),
    q(
      supabase
        .from("participants")
        .select("*")
        .eq("session_id", session.id)
        .order("total_score", { ascending: false })
        .order("joined_at", { ascending: true }),
      "report: participants"
    ),
    q(
      supabase
        .from("qa_feed")
        .select("*")
        .eq("session_id", session.id)
        .order("created_at", { ascending: true }),
      "report: qa"
    ),
  ]);

  const activityIds = activities.map((a) => a.id);
  const responses = activityIds.length
    ? await q(
        supabase.from("responses").select("*").in("activity_id", activityIds),
        "report: responses"
      )
    : [];

  const quizzes = activities.filter((a) => a.type === "quiz");
  const polls = activities.filter((a) => a.type === "poll");

  const totalPossible = quizzes.reduce((sum, a) => sum + (a.points ?? 10), 0);

  // ---- index responses once, read many times ----
  const byParticipant = new Map();
  const byActivity = new Map();
  for (const r of responses) {
    if (!byParticipant.has(r.participant_id)) byParticipant.set(r.participant_id, []);
    byParticipant.get(r.participant_id).push(r);
    if (!byActivity.has(r.activity_id)) byActivity.set(r.activity_id, []);
    byActivity.get(r.activity_id).push(r);
  }

  // ---- ranked scoreboard ----
  let lastScore = null;
  let lastRank = 0;
  const scoreboard = participants.map((p, index) => {
    const mine = byParticipant.get(p.id) || [];
    const graded = mine.filter((r) => r.is_correct !== null);
    const correct = graded.filter((r) => r.is_correct).length;

    const rank = p.total_score === lastScore ? lastRank : index + 1;
    lastScore = p.total_score;
    lastRank = rank;

    return {
      rank,
      participantId: p.id,
      name: p.name,
      score: p.total_score,
      totalPossible,
      percentage: totalPossible ? Math.round((p.total_score / totalPossible) * 1000) / 10 : 0,
      attempted: graded.length,
      correct,
      // Accuracy over what they actually attempted — a participant who joined
      // late isn't penalised for questions that had already closed.
      accuracy: graded.length ? Math.round((correct / graded.length) * 1000) / 10 : 0,
      quizzesAvailable: quizzes.length,
      joinedAt: p.joined_at,
    };
  });

  // ---- question-by-question breakdown ----
  function tallyFor(activity) {
    const rows = byActivity.get(activity.id) || [];
    const counts = new Map((activity.options || []).map((o) => [String(o), 0]));
    for (const r of rows) counts.set(String(r.answer), (counts.get(String(r.answer)) || 0) + 1);

    const total = rows.length;
    return {
      total,
      results: [...counts.entries()].map(([option, count]) => ({
        option,
        count,
        percentage: total ? Math.round((count / total) * 1000) / 10 : 0,
        isCorrect:
          activity.type === "quiz" && activity.correct_answer
            ? option.toLowerCase() === String(activity.correct_answer).toLowerCase()
            : null,
      })),
    };
  }

  const questionBreakdown = quizzes.map((a, index) => {
    const rows = byActivity.get(a.id) || [];
    const correct = rows.filter((r) => r.is_correct).length;
    const times = rows.map((r) => r.response_time_ms).filter((t) => Number.isFinite(t));

    return {
      number: index + 1,
      activityId: a.id,
      question: a.question,
      options: a.options,
      correctAnswer: a.correct_answer,
      difficulty: a.difficulty,
      points: a.points ?? 10,
      responses: rows.length,
      correct,
      incorrect: rows.length - correct,
      correctRate: rows.length ? Math.round((correct / rows.length) * 1000) / 10 : 0,
      averageResponseMs: times.length ? Math.round(times.reduce((a2, b) => a2 + b, 0) / times.length) : null,
      distribution: tallyFor(a).results,
    };
  });

  const pollSummary = polls.map((a, index) => {
    const tally = tallyFor(a);
    return {
      number: index + 1,
      activityId: a.id,
      question: a.question,
      votes: tally.total,
      results: tally.results,
    };
  });

  // ---- Q&A transcript ----
  const transcript = qaItems.map((item) => ({
    id: item.id,
    name: item.participant_name,
    text: item.question_text,
    isAnswered: item.is_answered,
    isHighlighted: item.is_highlighted,
    createdAt: item.created_at,
  }));

  // ---- headline numbers ----
  const gradedResponses = responses.filter((r) => r.is_correct !== null);
  const hardest = [...questionBreakdown].sort((a, b) => a.correctRate - b.correctRate)[0] || null;

  return {
    session: {
      id: session.id,
      title: session.title,
      description: session.description,
      sessionCode: session.session_code,
      status: session.status,
      activeCategories: session.active_categories,
      createdAt: session.created_at,
      endedAt: session.ended_at,
    },
    summary: {
      participants: participants.length,
      quizQuestions: quizzes.length,
      polls: polls.length,
      totalResponses: responses.length,
      questionsAsked: qaItems.length,
      questionsAnswered: qaItems.filter((i) => i.is_answered).length,
      totalPossible,
      averageScore: participants.length
        ? Math.round((participants.reduce((s, p) => s + p.total_score, 0) / participants.length) * 10) / 10
        : 0,
      averageAccuracy: gradedResponses.length
        ? Math.round((gradedResponses.filter((r) => r.is_correct).length / gradedResponses.length) * 1000) / 10
        : 0,
      hardestQuestion: hardest ? { question: hardest.question, correctRate: hardest.correctRate } : null,
    },
    scoreboard,
    questionBreakdown,
    pollSummary,
    transcript,
  };
}

/**
 * Flattens the report into a single CSV with labelled sections, so a host can
 * open one file and see scores, questions, polls, and comments together.
 */
function reportToCsv(report) {
  const rows = [];
  const blank = () => rows.push([]);

  rows.push(["AI-POWERED LIVE SESSION TOOLKIT — SESSION REPORT"]);
  rows.push(["Session", report.session.title]);
  rows.push(["Code", report.session.sessionCode]);
  rows.push(["Status", report.session.status]);
  rows.push(["Generated", new Date().toISOString()]);
  blank();

  rows.push(["SUMMARY"]);
  rows.push(["Participants", report.summary.participants]);
  rows.push(["Quiz questions", report.summary.quizQuestions]);
  rows.push(["Polls", report.summary.polls]);
  rows.push(["Total responses", report.summary.totalResponses]);
  rows.push(["Questions asked", report.summary.questionsAsked]);
  rows.push(["Average score", `${report.summary.averageScore} / ${report.summary.totalPossible}`]);
  rows.push(["Average accuracy %", report.summary.averageAccuracy]);
  blank();

  rows.push(["SCOREBOARD"]);
  rows.push(["Rank", "Name", "Score", "Out of", "Percentage %", "Attempted", "Correct", "Accuracy %"]);
  for (const p of report.scoreboard) {
    rows.push([p.rank, p.name, p.score, p.totalPossible, p.percentage, p.attempted, p.correct, p.accuracy]);
  }
  blank();

  rows.push(["QUESTION BREAKDOWN"]);
  rows.push(["#", "Question", "Correct answer", "Difficulty", "Responses", "Correct", "Incorrect", "Correct rate %"]);
  for (const qb of report.questionBreakdown) {
    rows.push([
      qb.number,
      qb.question,
      qb.correctAnswer,
      qb.difficulty,
      qb.responses,
      qb.correct,
      qb.incorrect,
      qb.correctRate,
    ]);
  }
  blank();

  rows.push(["ANSWER DISTRIBUTION"]);
  rows.push(["#", "Question", "Option", "Is correct", "Votes", "Share %"]);
  for (const qb of report.questionBreakdown) {
    for (const d of qb.distribution) {
      rows.push([qb.number, qb.question, d.option, d.isCorrect ? "YES" : "", d.count, d.percentage]);
    }
  }
  blank();

  rows.push(["POLL RESULTS"]);
  rows.push(["#", "Poll question", "Option", "Votes", "Share %"]);
  for (const poll of report.pollSummary) {
    for (const r of poll.results) {
      rows.push([poll.number, poll.question, r.option, r.count, r.percentage]);
    }
  }
  blank();

  rows.push(["Q&A TRANSCRIPT"]);
  rows.push(["Time", "Participant", "Question / comment", "Answered", "Highlighted"]);
  for (const t of report.transcript) {
    rows.push([
      t.createdAt,
      t.name,
      t.text,
      t.isAnswered ? "YES" : "NO",
      t.isHighlighted ? "YES" : "NO",
    ]);
  }

  return toCsv(rows);
}

module.exports = { buildSessionReport, reportToCsv };
