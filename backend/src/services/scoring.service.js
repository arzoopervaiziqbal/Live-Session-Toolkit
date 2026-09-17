const { supabase, q } = require("../config/db");

/**
 * Rule-based grading. Multiple choice is either right or wrong — no AI needed,
 * which is what keeps grading instant and reproducible (PRD 6.2 / 9.1).
 */
function gradeAnswer(activity, answer) {
  if (activity.type !== "quiz" || !activity.correct_answer) {
    // Polls have no right answer; is_correct stays null so reports can tell
    // "ungraded" apart from "graded and wrong".
    return { isCorrect: null, points: 0 };
  }
  const submitted = String(answer ?? "").trim();
  const correct = String(activity.correct_answer).trim();
  const isCorrect = submitted.toLowerCase() === correct.toLowerCase();
  return { isCorrect, points: isCorrect ? activity.points ?? 10 : 0 };
}

/**
 * Adds points to a participant atomically via the increment_participant_score
 * SQL function, so simultaneous submissions can't clobber each other.
 * Falls back to a read-modify-write if the function hasn't been installed.
 */
async function awardPoints(participantId, points) {
  if (!points) {
    const rows = await q(
      supabase.from("participants").select("total_score").eq("id", participantId).single(),
      "read participant score"
    );
    return rows.total_score;
  }

  const { data, error } = await supabase.rpc("increment_participant_score", {
    p_participant_id: participantId,
    p_points: points,
  });

  if (!error && typeof data === "number") return data;

  const current = await q(
    supabase.from("participants").select("total_score").eq("id", participantId).single(),
    "read participant score"
  );
  const next = (current.total_score || 0) + points;
  await q(
    supabase.from("participants").update({ total_score: next }).eq("id", participantId),
    "update participant score"
  );
  return next;
}

/** Ranked scoreboard with standard competition ranking (1,2,2,4). */
async function getLeaderboard(sessionId, limit = null) {
  let builder = supabase
    .from("participants")
    .select("id, name, total_score, joined_at")
    .eq("session_id", sessionId)
    .order("total_score", { ascending: false })
    .order("joined_at", { ascending: true });

  if (limit) builder = builder.limit(limit);

  const rows = await q(builder, "load leaderboard");

  let lastScore = null;
  let lastRank = 0;
  return rows.map((row, index) => {
    const rank = row.total_score === lastScore ? lastRank : index + 1;
    lastScore = row.total_score;
    lastRank = rank;
    return {
      rank,
      participantId: row.id,
      name: row.name,
      score: row.total_score,
    };
  });
}

/** Vote tallies for a poll or quiz, shaped for the bar chart on both screens. */
async function getActivityTally(activity) {
  const responses = await q(
    supabase.from("responses").select("answer").eq("activity_id", activity.id),
    "load responses for tally"
  );

  const counts = new Map();
  for (const option of activity.options || []) counts.set(String(option), 0);
  for (const r of responses) {
    const key = String(r.answer);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const total = responses.length;
  const results = [...counts.entries()].map(([option, count]) => ({
    option,
    count,
    percentage: total ? Math.round((count / total) * 1000) / 10 : 0,
    isCorrect:
      activity.type === "quiz" && activity.correct_answer
        ? option.toLowerCase() === String(activity.correct_answer).toLowerCase()
        : null,
  }));

  return { activityId: activity.id, total, results };
}

/** Detailed student score list with accuracy, correct counts, and submission time */
async function getDetailedLeaderboard(sessionId) {
  const [participants, activities] = await Promise.all([
    q(
      supabase
        .from("participants")
        .select("id, name, total_score, joined_at")
        .eq("session_id", sessionId)
        .order("total_score", { ascending: false })
        .order("joined_at", { ascending: true }),
      "load participants for detailed leaderboard"
    ),
    q(
      supabase
        .from("activities")
        .select("id, type, points")
        .eq("session_id", sessionId)
        .eq("is_published", true),
      "load session activities"
    ),
  ]);

  const activityIds = activities.map((a) => a.id);
  const quizActivityIds = new Set(activities.filter((a) => a.type === "quiz").map((a) => a.id));

  const responses = activityIds.length
    ? await q(
        supabase
          .from("responses")
          .select("id, activity_id, participant_id, answer, is_correct, points_awarded, submitted_at, response_time_ms")
          .in("activity_id", activityIds),
        "load responses for detailed leaderboard"
      )
    : [];

  const byParticipant = new Map();
  for (const r of responses) {
    if (!byParticipant.has(r.participant_id)) byParticipant.set(r.participant_id, []);
    byParticipant.get(r.participant_id).push(r);
  }

  let lastScore = null;
  let lastRank = 0;

  return participants.map((p, index) => {
    const pResponses = byParticipant.get(p.id) || [];
    const quizResponses = pResponses.filter((r) => quizActivityIds.has(r.activity_id) && r.is_correct !== null);
    const correctCount = quizResponses.filter((r) => r.is_correct === true).length;
    const attemptedCount = quizResponses.length;
    const incorrectCount = attemptedCount - correctCount;
    const accuracy = attemptedCount > 0 ? Math.round((correctCount / attemptedCount) * 1000) / 10 : 0;

    let latestSubmissionTime = null;
    for (const r of pResponses) {
      if (r.submitted_at) {
        if (!latestSubmissionTime || new Date(r.submitted_at) > new Date(latestSubmissionTime)) {
          latestSubmissionTime = r.submitted_at;
        }
      }
    }

    const rank = p.total_score === lastScore ? lastRank : index + 1;
    lastScore = p.total_score;
    lastRank = rank;

    return {
      rank,
      participantId: p.id,
      name: p.name,
      score: p.total_score,
      accuracy,
      correctCount,
      incorrectCount,
      attemptedCount,
      totalQuizzes: quizActivityIds.size,
      submissionTime: latestSubmissionTime || p.joined_at,
      joinedAt: p.joined_at,
    };
  });
}

/** Individual student votes for a closed poll */
async function getPollStudentVotes(activityId, sessionId) {
  const [participants, responses] = await Promise.all([
    q(
      supabase.from("participants").select("id, name, joined_at").eq("session_id", sessionId),
      "load participants for poll"
    ),
    q(
      supabase.from("responses").select("participant_id, answer, submitted_at").eq("activity_id", activityId),
      "load poll responses"
    ),
  ]);

  const respMap = new Map();
  for (const r of responses) {
    respMap.set(r.participant_id, {
      selectedOption: r.answer,
      votedAt: r.submitted_at,
    });
  }

  const studentVotes = participants.map((p) => {
    const vote = respMap.get(p.id);
    return {
      participantId: p.id,
      name: p.name,
      selectedOption: vote ? vote.selectedOption : null,
      hasVoted: Boolean(vote),
      votedAt: vote ? vote.votedAt : null,
    };
  });

  return {
    totalJoined: participants.length,
    totalVotes: responses.length,
    percentageVoted: participants.length ? Math.round((responses.length / participants.length) * 100) : 0,
    studentVotes,
  };
}

module.exports = {
  gradeAnswer,
  awardPoints,
  getLeaderboard,
  getDetailedLeaderboard,
  getActivityTally,
  getPollStudentVotes,
};
