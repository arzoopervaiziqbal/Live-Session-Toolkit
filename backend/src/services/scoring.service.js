// Helper to determine the correct answer for a question.
// Supports direct correctAnswer and also options with "(Correct Answer)" or "[correct]".
function getEffectiveCorrectAnswer(q) {
  if (
    q.correctAnswer !== undefined &&
    q.correctAnswer !== null &&
    String(q.correctAnswer).trim() !== ""
  ) {
    return String(q.correctAnswer).trim();
  }
  if (Array.isArray(q.options)) {
    const match = q.options.find((opt) =>
      /\(correct answer\)|\(correct\)|\[correct\]/i.test(String(opt))
    );
    if (match) return String(match).trim();
  }
  return null;
}

// Computes a quiz score by comparing submitted answers to each question's correctAnswer.
// answersByQuestionId: { [questionId]: answerValue }
function computeScore(questions, answersByQuestionId) {
  let correct = 0;
  let scored = 0;

  const details = (questions || []).map((q) => {
    const effCorrect = getEffectiveCorrectAnswer(q);
    const isScorable = effCorrect !== null || q.type === "mcq";

    if (!isScorable) {
      return { questionId: q.questionId, type: q.type, isCorrect: null };
    }

    scored += 1;
    const studentAns = answersByQuestionId ? answersByQuestionId[q.questionId] : undefined;
    const isCorrect =
      effCorrect !== null &&
      studentAns !== undefined &&
      studentAns !== null &&
      String(studentAns).trim().toLowerCase() === effCorrect.toLowerCase();

    if (isCorrect) correct += 1;
    return { questionId: q.questionId, type: q.type, isCorrect, correctAnswer: effCorrect };
  });

  return { correct, scored, hasScore: scored > 0, details };
}

module.exports = { computeScore, getEffectiveCorrectAnswer };
