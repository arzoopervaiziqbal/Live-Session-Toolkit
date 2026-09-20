"use client";
import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Navbar from "../../../../components/Navbar";
import { useLang } from "../../../../contexts/LangContext";
import { api } from "../../../../lib/api";

const QUESTION_TIME_LIMIT = 60; // 60 seconds per question

export default function AttemptPage() {
  const { t } = useLang();
  const params = useParams();
  const router = useRouter();

  const [guestName, setGuestName] = useState("");
  const [guestId, setGuestId] = useState(null);
  const [activity, setActivity] = useState(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState(QUESTION_TIME_LIMIT);
  const [answers, setAnswers] = useState({});
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [timedOutNotice, setTimedOutNotice] = useState(false);

  // Keep refs up-to-date for interval callback
  const answersRef = useRef(answers);
  answersRef.current = answers;

  const currentIndexRef = useRef(currentIndex);
  currentIndexRef.current = currentIndex;

  const activityRef = useRef(activity);
  activityRef.current = activity;

  const submittingRef = useRef(submitting);
  submittingRef.current = submitting;

  useEffect(() => {
    const storedGuestId = sessionStorage.getItem("sp_guest_id");
    const storedName = sessionStorage.getItem("sp_guest_name");
    if (!storedGuestId) {
      router.replace("/participant/join");
      return;
    }
    setGuestId(storedGuestId);
    setGuestName(storedName || "");
    api
      .joinByCode(params.code, storedGuestId, storedName || "Guest")
      .then((data) => setActivity(data.activity))
      .catch(() => router.replace("/participant/join"));
  }, [params.code, router]);

  // Reset timer when question index changes
  useEffect(() => {
    setTimeLeft(QUESTION_TIME_LIMIT);
    setTimedOutNotice(false);
  }, [currentIndex]);

  // 60-second Countdown Timer per question
  useEffect(() => {
    if (!activity || submitting) return;

    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          // Time expired for this question!
          handleTimeExpired();
          return QUESTION_TIME_LIMIT;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [activity, submitting]);

  function handleTimeExpired() {
    const act = activityRef.current;
    if (!act || !act.questions || submittingRef.current) return;

    const cur = currentIndexRef.current;
    if (cur < act.questions.length - 1) {
      // Auto-advance to next question
      setTimedOutNotice(true);
      setCurrentIndex((prev) => prev + 1);
    } else {
      // Final question time expired: auto submit!
      executeSubmit(answersRef.current);
    }
  }

  function setAnswer(qId, value) {
    setAnswers((prev) => ({ ...prev, [qId]: value }));
  }

  async function executeSubmit(answersToSubmit) {
    if (submittingRef.current) return;
    setSubmitting(true);
    setError("");

    try {
      const data = await api.submitAnswers(params.code, guestId, answersToSubmit);
      sessionStorage.setItem("sp_last_result", JSON.stringify(data.result));
      router.push("/participant/result");
    } catch (err) {
      setError(err.body?.error || "Couldn't submit answers. Please try again.");
      setSubmitting(false);
    }
  }

  async function handleManualSubmit() {
    executeSubmit(answers);
  }

  function goToNext() {
    if (!activity?.questions) return;
    if (currentIndex < activity.questions.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    } else {
      handleManualSubmit();
    }
  }

  function goToPrev() {
    if (currentIndex > 0) {
      setCurrentIndex((prev) => prev - 1);
    }
  }

  if (!activity || !activity.questions || activity.questions.length === 0) {
    return (
      <main className="min-h-screen">
        <Navbar userName={guestName || undefined} logoutLabel={undefined} />
        <div className="max-w-lg mx-auto px-6 py-16 text-center text-sm text-gray-400">
          Loading quiz questions…
        </div>
      </main>
    );
  }

  const currentQ = activity.questions[currentIndex];
  const isLastQuestion = currentIndex === activity.questions.length - 1;
  const progressPercent = ((QUESTION_TIME_LIMIT - timeLeft) / QUESTION_TIME_LIMIT) * 100;
  const timerUrgent = timeLeft <= 10;
  const timerWarning = timeLeft <= 20 && timeLeft > 10;

  return (
    <main className="min-h-screen pb-16 bg-[#FAFAF9] dark:bg-[#080915]">
      <Navbar userName={guestName || undefined} logoutLabel={undefined} />

      <div className="max-w-xl mx-auto px-4 sm:px-6 py-8">
        {/* Quiz Title & Header */}
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">
              {activity.type || "Quiz"} • {activity.difficulty || "Medium"}
            </span>
            <h1 className="font-display text-xl font-bold text-gray-900 dark:text-gray-100">
              {activity.title}
            </h1>
          </div>

          {/* 60s Countdown Timer Badge */}
          <div
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-mono font-bold transition-all duration-300 shadow-xs ${
              timerUrgent
                ? "bg-rose-500/15 border-rose-500/40 text-rose-600 animate-pulse scale-105"
                : timerWarning
                ? "bg-amber-500/15 border-amber-500/40 text-amber-600"
                : "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
            }`}
            title="60 seconds for this question"
          >
            <span className="text-sm">{timerUrgent ? "🔥" : "⏱️"}</span>
            <span>{timeLeft}s</span>
          </div>
        </div>

        {/* 60s Depleting Progress Bar */}
        <div className="w-full bg-[#E1E1DC] dark:bg-[#1B1E3F] h-2 rounded-full overflow-hidden mb-6">
          <div
            className={`h-full transition-all duration-1000 ease-linear rounded-full ${
              timerUrgent
                ? "bg-rose-500"
                : timerWarning
                ? "bg-amber-500"
                : "bg-emerald-500"
            }`}
            style={{ width: `${100 - progressPercent}%` }}
          />
        </div>

        {/* Question Progress Tracker Pills */}
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">
            Question {currentIndex + 1} of {activity.questions.length}
          </span>
          <div className="flex items-center gap-1.5">
            {activity.questions.map((q, idx) => {
              const hasAnswer = answers[q.questionId] !== undefined && answers[q.questionId] !== "";
              const isCurrent = idx === currentIndex;

              return (
                <button
                  key={q.questionId || idx}
                  type="button"
                  onClick={() => setCurrentIndex(idx)}
                  className={`w-6 h-6 rounded-full text-[11px] font-mono font-bold flex items-center justify-center transition-all ${
                    isCurrent
                      ? "ring-2 ring-primary ring-offset-2 bg-primary text-white scale-110"
                      : hasAnswer
                      ? "bg-emerald-500/20 text-emerald-600 border border-emerald-500/30"
                      : "bg-[#E1E1DC] dark:bg-[#1B1E3F] text-gray-400"
                  }`}
                  title={`Go to Question ${idx + 1}`}
                >
                  {idx + 1}
                </button>
              );
            })}
          </div>
        </div>

        {/* Timed-out Toast Alert */}
        {timedOutNotice && (
          <div className="mb-4 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 text-xs flex items-center justify-between">
            <span>⏱️ Time expired! Advanced to Question {currentIndex + 1}.</span>
            <button
              type="button"
              onClick={() => setTimedOutNotice(false)}
              className="text-amber-700 dark:text-amber-300 font-bold ml-2"
            >
              ✕
            </button>
          </div>
        )}

        {/* Active Question Card */}
        <div className="card p-6 mb-6 shadow-sm border border-[#E1E1DC] dark:border-[#2A2E52] bg-white dark:bg-[#12142B]">
          <div className="flex items-start gap-2 mb-4">
            <span className="font-mono text-xs font-bold px-2 py-0.5 rounded-md bg-primary/10 text-primary shrink-0">
              Q{currentIndex + 1}
            </span>
            <h2 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100 leading-snug">
              {currentQ.questionText}
            </h2>
          </div>

          {/* MCQ / Poll Options */}
          {(currentQ.type === "mcq" || currentQ.type === "poll") && (
            <div className="grid gap-2.5">
              {currentQ.options.map((opt, oi) => {
                const isSelected = answers[currentQ.questionId] === opt;

                return (
                  <div
                    key={oi}
                    onClick={() => setAnswer(currentQ.questionId, opt)}
                    className={`cursor-pointer text-xs sm:text-sm px-4 py-3 rounded-xl border transition-all flex items-center justify-between ${
                      isSelected
                        ? "border-primary bg-primary/10 text-primary font-medium shadow-xs ring-1 ring-primary"
                        : "border-[#E1E1DC] dark:border-[#2A2E52] hover:border-primary/50 hover:bg-[#F9F9F8] dark:hover:bg-[#1B1E3F]/40"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={`w-6 h-6 rounded-full flex items-center justify-center font-mono text-xs font-bold shrink-0 ${
                          isSelected
                            ? "bg-primary text-white"
                            : "bg-[#F0F0EB] dark:bg-[#1B1E3F] text-gray-500"
                        }`}
                      >
                        {String.fromCharCode(65 + oi)}
                      </span>
                      <span>{opt}</span>
                    </div>

                    {isSelected && <span className="text-primary font-bold text-sm">✓</span>}
                  </div>
                );
              })}
            </div>
          )}

          {/* Rating Scale (1 to 5) */}
          {currentQ.type === "rating" && (
            <div className="py-3">
              <div className="text-xs text-gray-500 mb-2">Select your rating from 1 to 5:</div>
              <div className="flex gap-3 justify-center sm:justify-start">
                {[1, 2, 3, 4, 5].map((n) => {
                  const isSelected = answers[currentQ.questionId] === n;

                  return (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setAnswer(currentQ.questionId, n)}
                      className={`w-12 h-12 flex flex-col items-center justify-center rounded-xl border cursor-pointer font-bold text-sm transition-all ${
                        isSelected
                          ? "border-primary bg-primary text-white shadow-xs scale-105"
                          : "border-[#E1E1DC] dark:border-[#2A2E52] hover:border-primary"
                      }`}
                    >
                      <span>{n}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Open Text Input */}
          {currentQ.type === "open_text" && (
            <div className="pt-2">
              <label className="label text-xs">Your Answer</label>
              <textarea
                className="field text-xs sm:text-sm"
                rows={4}
                placeholder="Type your response here..."
                value={answers[currentQ.questionId] || ""}
                onChange={(e) => setAnswer(currentQ.questionId, e.target.value)}
              />
            </div>
          )}
        </div>

        {/* Urgent Timer Alert Banner */}
        {timerUrgent && (
          <div className="mb-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs font-medium flex items-center justify-between animate-pulse">
            <span>⚠️ Hurry! Only {timeLeft} seconds remaining for this question.</span>
          </div>
        )}

        {error && <div className="error-text mb-4">{error}</div>}

        {/* Navigation & Submit Action Bar */}
        <div className="flex items-center justify-between gap-3 pt-2">
          <button
            type="button"
            className="btn-secondary text-xs py-2.5 px-4"
            onClick={goToPrev}
            disabled={currentIndex === 0 || submitting}
          >
            ← Previous
          </button>

          <div className="flex items-center gap-2">
            {isLastQuestion ? (
              <button
                type="button"
                className="btn-primary text-xs sm:text-sm py-2.5 px-6 font-bold flex items-center gap-2 shadow-sm"
                onClick={handleManualSubmit}
                disabled={submitting}
              >
                <span>{submitting ? "Submitting…" : "Submit Quiz 🎉"}</span>
              </button>
            ) : (
              <button
                type="button"
                className="btn-primary text-xs sm:text-sm py-2.5 px-5 font-semibold flex items-center gap-1.5 shadow-sm"
                onClick={goToNext}
                disabled={submitting}
              >
                <span>Next Question →</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
