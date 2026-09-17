"use client";
import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import SettingsMenu from "../../../../components/SettingsMenu";
import {
  ResultChart,
  TimerRing,
  Leaderboard,
  QAFeed,
  QAComposer,
  Spinner,
  ConnectionBanner,
  SuspendedOverlay,
} from "../../../../components/LiveWidgets";
import { useSessionSocket, useCountdown, useProctor } from "../../../../lib/useSession";
import { api, getGuestId, newClientToken } from "../../../../lib/api";
import { submitAnswer, startAutoSync, listPending } from "../../../../lib/offlineQueue";

export default function ParticipantRoom() {
  const router = useRouter();
  const { code } = useParams();

  const [session, setSession] = useState(null);
  const [participant, setParticipant] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Activities & Quiz state
  const [activities, setActivities] = useState([]);
  const [activity, setActivity] = useState(null);
  const [activeQuizIndex, setActiveQuizIndex] = useState(0);
  const [isAdvancing, setIsAdvancing] = useState(false);
  const [quizCompleted, setQuizCompleted] = useState(false);

  const [endsAt, setEndsAt] = useState(null);
  const [selected, setSelected] = useState(null);
  const [submitState, setSubmitState] = useState("idle"); // idle | sending | sent | queued
  const [tally, setTally] = useState(null);
  const [revealed, setRevealed] = useState(false);

  // Hidden during answering — revealed only at End of Quiz
  const [score, setScore] = useState(0);
  const [answeredIds, setAnsweredIds] = useState([]);
  const [answeredMap, setAnsweredMap] = useState({}); // { [actId]: { answer, isCorrect, pointsAwarded } }
  const [summaryData, setSummaryData] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const [leaderboard, setLeaderboard] = useState([]);
  const [qaItems, setQaItems] = useState([]);
  const [tab, setTab] = useState("live");

  const [online, setOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);

  const questionShownAt = useRef(null);

  const quizActivities = useMemo(
    () => activities.filter((a) => a.type === "quiz"),
    [activities]
  );

  // ---- online/offline ----
  useEffect(() => {
    setOnline(navigator.onLine);
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  // ---- load final summary ----
  const loadFinalSummary = useCallback(async () => {
    if (!session?.id || !participant?.id) return;
    setSummaryLoading(true);
    try {
      const data = await api.participantState(session.id, participant.id);
      if (data) {
        if (data.participant?.totalScore !== undefined) {
          setScore(data.participant.totalScore);
        }
        if (data.leaderboard) {
          setLeaderboard(data.leaderboard);
        }

        const acts = data.activities?.length ? data.activities : activities;
        const qActs = acts.filter((a) => a.type === "quiz");
        const respMap = {};
        (data.responses || []).forEach((r) => {
          respMap[r.activity_id] = r;
        });

        const breakdown = qActs.map((act) => {
          const resp = respMap[act.id];
          const localAns = answeredMap[act.id];
          const studentAnswer = resp?.answer || localAns?.answer || null;
          const isCorrect = resp ? resp.is_correct : localAns ? localAns.isCorrect : null;
          const points = resp ? resp.points_awarded : localAns ? localAns.pointsAwarded : 0;

          return {
            id: act.id,
            question: act.question,
            options: act.options,
            correctAnswer: act.correct_answer,
            studentAnswer,
            isCorrect,
            points,
          };
        });

        const correctCount = breakdown.filter((b) => b.isCorrect).length;
        const total = breakdown.length;
        const accuracy = total > 0 ? Math.round((correctCount / total) * 100) : 0;

        setSummaryData({
          score: data.participant?.totalScore ?? score,
          rank: data.rank,
          outOf: data.outOf || (data.leaderboard || []).length,
          correctCount,
          total,
          accuracy,
          breakdown,
        });
      }
    } catch (err) {
      console.error("loadFinalSummary error:", err);
    } finally {
      setSummaryLoading(false);
    }
  }, [session?.id, participant?.id, activities, answeredMap, score]);

  useEffect(() => {
    if (quizCompleted && session?.id && participant?.id) {
      loadFinalSummary();
    }
  }, [quizCompleted, session?.id, participant?.id, loadFinalSummary]);

  // ---- join ----
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const name = localStorage.getItem("lst_display_name") || "Guest";
        const data = await api.joinSession({ code, name, guestId: getGuestId() });
        if (cancelled) return;

        setSession(data.session);
        setParticipant(data.participant);
        setScore(data.participant.totalScore || 0);

        const published = data.activities || (data.currentActivity ? [data.currentActivity] : []);
        setActivities(published);

        const answeredList = data.answeredActivityIds || [];
        setAnsweredIds(answeredList);

        const qList = published.filter((a) => a.type === "quiz");
        const firstUnanswered = qList.findIndex((a) => !answeredList.includes(a.id));

        if (qList.length > 0 && firstUnanswered === -1 && answeredList.length >= qList.length) {
          // All questions already completed
          setQuizCompleted(true);
          setActivity(null);
        } else if (firstUnanswered !== -1) {
          setActiveQuizIndex(firstUnanswered);
          setActivity(qList[firstUnanswered]);
          questionShownAt.current = Date.now();
        } else if (data.currentActivity) {
          setActivity(data.currentActivity);
          setEndsAt(data.endsAt);
          questionShownAt.current = Date.now();
          if (answeredList.includes(data.currentActivity.id)) {
            setSubmitState("sent");
          }
        }

        const qa = await api.listQuestions(data.session.id);
        if (!cancelled) setQaItems(qa.items);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code]);

  // ---- offline queue auto-retry ----
  useEffect(() => {
    if (!session || !participant) return;

    const refreshPending = async () => {
      const items = await listPending(session.id);
      setPendingCount(items.filter((i) => i.participantId === participant.id).length);
    };
    refreshPending();

    const stop = startAutoSync({
      sessionId: session.id,
      participantId: participant.id,
      onSync: (result) => {
        setPendingCount(result.remaining);
        if (result.totalScore !== null && quizCompleted) setScore(result.totalScore);
        if (result.accepted > 0 && submitState === "queued") setSubmitState("sent");
      },
    });

    return stop;
  }, [session, participant, submitState, quizCompleted]);

  // ---- realtime ----
  const handlers = {
    onActivityPush: ({ activity: next, endsAt: ends }) => {
      setActivities((prev) => {
        const exists = prev.some((a) => a.id === next.id);
        return exists ? prev.map((a) => (a.id === next.id ? next : a)) : [...prev, next];
      });
      setActivity(next);
      setEndsAt(ends);
      setSelected(null);
      setSubmitState(answeredIds.includes(next.id) ? "sent" : "idle");
      setTally(null);
      setRevealed(false);
      setQuizCompleted(false);
      setTab("live");
      questionShownAt.current = Date.now();
    },
    onActivityEnded: ({ activityType, activityId, tally: t, leaderboard: rows, details }) => {
      setRevealed(true);
      setEndsAt(null);
      if (t) setTally(t);
      if (rows && rows.length) setLeaderboard(rows);
      setQuizCompleted(true);
      loadFinalSummary();
    },
    onActivityClose: ({ activityId, tally: t, correctAnswer: answer }) => {
      setRevealed(true);
      setEndsAt(null);
      if (t) setTally(t);
      setQuizCompleted(true);
      loadFinalSummary();
    },
    onTally: (t) => setTally(t),
    onLeaderboard: ({ leaderboard: rows }) => setLeaderboard(rows),
    onScore: ({ participantId, totalScore, lastResult }) => {
      // Score is revealed only at the end of the quiz
      if (participant && participantId === participant.id && quizCompleted) {
        setScore(totalScore);
      }
    },
    onQaNew: ({ item }) => setQaItems((list) => [item, ...list]),
    onQaUpdate: ({ item }) =>
      setQaItems((list) =>
        item.deleted ? list.filter((i) => i.id !== item.id) : list.map((i) => (i.id === item.id ? item : i))
      ),
    onSessionStatus: ({ status }) => {
      setSession((s) => (s ? { ...s, status } : s));
      if (status === "ended") {
        setActivity(null);
        setEndsAt(null);
        setQuizCompleted(true);
        loadFinalSummary();
      }
    },
    onProctorResumed: () => handleResumed(),
    onProctorRejected: () => handleRejected(),
  };

  const { connected, serverNow, socket } = useSessionSocket({
    sessionId: session?.id,
    role: "participant",
    participantId: participant?.id,
    handlers,
  });

  const { suspended, rejectedByHost, handleResumed, handleRejected } = useProctor({
    sessionId: session?.id,
    participantId: participant?.id,
    socket,
    enabled: Boolean(activity && !quizCompleted && submitState !== "sent"),
    gracePeriodMs: 2000,
  });

  const countdown = useCountdown(endsAt, serverNow);
  const timeUp = Boolean(endsAt) && countdown.expired;

  // ---- submit answer in background (Hidden Feedback) ----
  const send = useCallback(
    async (answer) => {
      if (!activity || !participant || !session) return;
      if (suspended) return;

      setSubmitState("sending");
      setError(null);

      const responseTimeMs = questionShownAt.current ? Date.now() - questionShownAt.current : null;

      try {
        const outcome = await submitAnswer({
          sessionId: session.id,
          participantId: participant.id,
          activityId: activity.id,
          answer,
          clientToken: newClientToken(),
          responseTimeMs,
        });

        setAnsweredIds((ids) => [...ids, activity.id]);

        if (outcome.status === "sent") {
          setSubmitState("sent");
          if (outcome.result) {
            setAnsweredMap((prev) => ({
              ...prev,
              [activity.id]: {
                answer,
                isCorrect: outcome.result.isCorrect,
                pointsAwarded: outcome.result.pointsAwarded,
                totalScore: outcome.result.totalScore,
              },
            }));
            // NOTE: Live feedback and points are intentionally kept hidden until quiz completion
          }
        } else {
          setSubmitState("queued");
          const items = await listPending(session.id);
          setPendingCount(items.filter((i) => i.participantId === participant.id).length);
        }
      } catch (err) {
        setSubmitState("idle");
        setError(err.message);
      }
    },
    [activity, participant, session, suspended]
  );

  // ---- Auto-Advance on Selection ----
  const handleSelectOption = (option) => {
    if (submitState === "sending" || isAdvancing || suspended || timeUp) return;

    setIsAdvancing(true);
    setSelected(option);

    // 1. Submit answer in background immediately
    send(option);

    // 2. Auto-advance to next question automatically without waiting for a manual click!
    setTimeout(() => {
      if (activity?.type === "quiz" && quizActivities.length > 0) {
        const nextIdx = activeQuizIndex + 1;
        if (nextIdx < quizActivities.length) {
          // Advance to next question instantly
          setActiveQuizIndex(nextIdx);
          setActivity(quizActivities[nextIdx]);
          setSelected(null);
          setSubmitState("idle");
          setIsAdvancing(false);
          questionShownAt.current = Date.now();
        } else {
          // All questions attempted! Transition to End-of-Quiz Result Summary
          setQuizCompleted(true);
          setIsAdvancing(false);
          setActivity(null);
        }
      } else {
        setIsAdvancing(false);
      }
    }, 240);
  };

  async function askQuestion(text) {
    try {
      await api.postQuestion(session.id, { participantId: participant.id, questionText: text });
    } catch (err) {
      setError(err.message);
    }
  }

  // ---- render ----
  if (loading) return <Spinner label="Joining session..." />;

  if (error && !session) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6">
        <div className="card p-6 max-w-sm w-full text-center">
          <div className="form-error mb-4">{error}</div>
          <button className="btn-primary" onClick={() => router.replace("/participant/join")}>
            Try another code
          </button>
        </div>
      </main>
    );
  }

  const isQuiz = activity?.type === "quiz";
  const locked = submitState === "sent" || submitState === "queued" || submitState === "sending" || isAdvancing;

  // Compute summary stats for the end screen
  const summaryScore = summaryData?.score ?? score;
  const summaryRank = summaryData?.rank;
  const summaryTotal = summaryData?.total ?? quizActivities.length;
  const summaryCorrect = summaryData?.correctCount ?? Object.values(answeredMap).filter((a) => a.isCorrect).length;
  const summaryAccuracy =
    summaryData?.accuracy ??
    (summaryTotal > 0 ? Math.round((summaryCorrect / summaryTotal) * 100) : 0);
  const summaryReview = summaryData?.breakdown ?? quizActivities.map((act) => {
    const ans = answeredMap[act.id];
    return {
      id: act.id,
      question: act.question,
      options: act.options,
      correctAnswer: act.correct_answer,
      studentAnswer: ans?.answer || null,
      isCorrect: ans?.isCorrect ?? null,
      points: ans?.pointsAwarded || 0,
    };
  });

  return (
    <main className="min-h-screen pb-8">
      {suspended && <SuspendedOverlay rejectedByHost={rejectedByHost} />}

      {/* Header bar: Hides live points during answering */}
      <div className="flex justify-between items-center px-5 py-3.5 border-b border-[#E1E1DC] dark:border-[#2A2E52] bg-white dark:bg-[#171A33] sticky top-0 z-30 shadow-xs">
        <div className="min-w-0">
          <div className="font-display font-bold text-sm truncate">{session.title}</div>
          <div className="text-[11px] text-gray-500 flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-live" : "bg-amber-500"}`} />
            {participant.name}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {quizCompleted || session.status === "ended" ? (
            <div className="text-right animate-in fade-in duration-300">
              <div className="font-display font-bold text-xl leading-none tabular-nums text-primary">{summaryScore}</div>
              <div className="text-[10px] text-gray-500 font-medium">total points</div>
            </div>
          ) : (
            <div className="text-right">
              <span className="text-xs font-semibold text-primary/90 bg-primary/10 border border-primary/20 px-2.5 py-1 rounded-full">
                {quizActivities.length > 0
                  ? `Question ${activeQuizIndex + 1} of ${quizActivities.length}`
                  : "Quiz Active"}
              </span>
            </div>
          )}
          <SettingsMenu />
        </div>
      </div>

      <div className="max-w-lg mx-auto px-5 py-5 space-y-4">
        <ConnectionBanner online={online} connected={connected} pending={pendingCount} />
        {error && <div className="form-error">{error}</div>}

        {/* ------------------------------------------------------------- */}
        {/* END-OF-QUIZ RESULT SUMMARY: Only shown after all attempted   */}
        {/* ------------------------------------------------------------- */}
        {quizCompleted || session.status === "ended" ? (
          <div className="space-y-5 animate-in fade-in slide-in-from-bottom-3 duration-400">
            {/* Celebration Hero Card */}
            <div className="card p-6 text-center relative overflow-hidden shadow-sm">
              <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-primary via-purple-500 to-emerald-500" />

              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-400/20 to-primary/20 border border-amber-500/30 flex items-center justify-center text-3xl mx-auto mb-3 shadow-inner">
                {summaryRank === 1 ? "🥇" : summaryRank === 2 ? "🥈" : summaryRank === 3 ? "🥉" : "🏆"}
              </div>

              <h2 className="font-display font-bold text-2xl mb-1 text-gray-900 dark:text-gray-100">
                Quiz Completed!
              </h2>
              <p className="text-xs text-gray-500 mb-5">
                All questions have been attempted. Here is your final performance breakdown!
              </p>

              {/* Big Total Score Display */}
              <div className="mb-6 p-4 rounded-xl bg-gradient-to-b from-primary/5 to-primary/10 border border-primary/20">
                <div className="text-[11px] font-bold tracking-widest text-primary uppercase mb-1">
                  Final Total Score
                </div>
                <div className="font-display font-extrabold text-4xl tabular-nums text-primary mb-1">
                  {summaryScore}
                </div>
                <div className="text-xs text-gray-500 font-medium">points earned</div>
              </div>

              {/* Metric Highlights Grid */}
              <div className="grid grid-cols-3 gap-3 mb-2">
                <div className="bg-[#F5F5F2] dark:bg-[#0E1020] rounded-xl p-3 border border-[#E1E1DC] dark:border-[#2A2E52]">
                  <div className="text-xs text-gray-500 mb-0.5">Accuracy</div>
                  <div className="font-display font-bold text-lg tabular-nums text-emerald-600 dark:text-emerald-400">
                    {summaryAccuracy != null ? `${summaryAccuracy}%` : "—"}
                  </div>
                </div>
                <div className="bg-[#F5F5F2] dark:bg-[#0E1020] rounded-xl p-3 border border-[#E1E1DC] dark:border-[#2A2E52]">
                  <div className="text-xs text-gray-500 mb-0.5">Correct</div>
                  <div className="font-display font-bold text-lg tabular-nums text-gray-900 dark:text-gray-100">
                    {summaryCorrect} / {summaryTotal}
                  </div>
                </div>
                <div className="bg-[#F5F5F2] dark:bg-[#0E1020] rounded-xl p-3 border border-[#E1E1DC] dark:border-[#2A2E52]">
                  <div className="text-xs text-gray-500 mb-0.5">Class Rank</div>
                  <div className="font-display font-bold text-lg tabular-nums text-primary">
                    {summaryRank ? `#${summaryRank}` : "—"}
                  </div>
                </div>
              </div>
            </div>

            {/* Question-by-Question Detailed Review */}
            <div className="card p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-display font-bold text-sm text-gray-900 dark:text-gray-100 flex items-center gap-1.5">
                    <span>📝 Question Breakdown</span>
                  </h3>
                  <p className="text-[11px] text-gray-500">Review your answers and correct solutions</p>
                </div>
                <span className="chip border-gray-200 dark:border-gray-700 text-xs font-semibold">
                  {summaryCorrect} / {summaryTotal} correct
                </span>
              </div>

              {summaryLoading ? (
                <div className="py-6 text-center text-xs text-gray-500">
                  <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                  Finalizing question results...
                </div>
              ) : (
                <div className="space-y-3">
                  {summaryReview.map((item, idx) => {
                    const isCorrect = item.isCorrect;
                    return (
                      <div
                        key={item.id || idx}
                        className={`p-3.5 rounded-xl border transition-all ${
                          isCorrect
                            ? "border-emerald-500/50 bg-emerald-500/[0.04] dark:border-emerald-500/40 dark:bg-emerald-500/[0.06]"
                            : "border-rose-300 dark:border-rose-900/50 bg-rose-50/50 dark:bg-rose-950/20"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <span className="font-display font-bold text-xs text-gray-400">
                            Question #{idx + 1}
                          </span>
                          <span
                            className={`text-[11px] font-bold px-2 py-0.5 rounded-md flex items-center gap-1 ${
                              isCorrect
                                ? "bg-emerald-600 text-white shadow-xs"
                                : "bg-rose-600 text-white shadow-xs"
                            }`}
                          >
                            {isCorrect ? `✓ Correct (+${item.points} pts)` : "✕ Incorrect (0 pts)"}
                          </span>
                        </div>

                        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2.5">
                          {item.question}
                        </div>

                        <div className="space-y-1 text-xs">
                          <div className="flex items-start gap-2">
                            <span className="text-gray-500 font-medium w-24 shrink-0">Your Answer:</span>
                            <span
                              className={`font-semibold ${
                                isCorrect
                                  ? "text-emerald-700 dark:text-emerald-400"
                                  : "text-rose-700 dark:text-rose-400 line-through"
                              }`}
                            >
                              {item.studentAnswer || "(No answer selected)"}
                            </span>
                          </div>

                          {!isCorrect && item.correctAnswer && (
                            <div className="flex items-start gap-2 pt-0.5">
                              <span className="text-emerald-700 dark:text-emerald-400 font-bold w-24 shrink-0">
                                Correct Answer:
                              </span>
                              <span className="font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-100/70 dark:bg-emerald-950/50 px-2 py-0.5 rounded">
                                {item.correctAnswer}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Class Leaderboard */}
            {leaderboard.length > 0 && (
              <div className="card p-5">
                <div className="font-display font-bold text-sm mb-3 flex items-center justify-between">
                  <span>🏆 Class Leaderboard</span>
                  <span className="text-xs text-gray-500 font-normal">{leaderboard.length} participants</span>
                </div>
                <div className="space-y-1.5 max-h-60 overflow-y-auto">
                  {leaderboard.map((row) => {
                    const isMe = row.participantId === participant?.id;
                    return (
                      <div
                        key={row.participantId}
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border text-xs sm:text-sm transition-colors ${
                          isMe
                            ? "border-primary bg-primary/10 ring-1 ring-primary/30 font-bold"
                            : "border-[#E1E1DC] dark:border-[#2A2E52]"
                        }`}
                      >
                        <span className="w-7 text-center font-display font-bold shrink-0">
                          {row.rank === 1 ? "🥇" : row.rank === 2 ? "🥈" : row.rank === 3 ? "🥉" : `#${row.rank}`}
                        </span>
                        <span className="flex-1 truncate">
                          {row.name} {isMe && <span className="text-primary text-xs font-normal">(you)</span>}
                        </span>
                        <span className="tabular-nums font-bold text-primary shrink-0">{row.score} pts</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="text-center pt-2">
              <Link href="/participant/join" className="btn-secondary inline-block text-xs">
                ← Join another session
              </Link>
            </div>
          </div>
        ) : (
          <>
            {/* ---- tabs ---- */}
            {(session.activeCategories || []).includes("qa") && (
              <div className="flex gap-1 p-1 bg-[#F5F5F2] dark:bg-[#0E1020] rounded-lg border border-[#E1E1DC] dark:border-[#2A2E52]">
                {[
                  ["live", "Live Quiz"],
                  ["qa", "Q&A"],
                  ["scores", "Scores"],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setTab(key)}
                    className={`flex-1 text-xs py-2 rounded-md transition-colors ${
                      tab === key ? "bg-primary text-white font-semibold" : "text-gray-500"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            {/* ---- Live Question Attempt (Hidden Feedback & Auto-Advance) ---- */}
            {tab === "live" &&
              (!activity ? (
                <div className="card p-10 text-center">
                  <div className="w-10 h-10 rounded-full border-2 border-primary border-t-transparent animate-spin mx-auto mb-4" />
                  <div className="font-display font-semibold mb-1">You&apos;re in</div>
                  <p className="text-sm text-gray-500">Waiting for the next question to begin...</p>
                </div>
              ) : (
                <div className="card p-5 shadow-xs">
                  {/* Progress and Question Header */}
                  {quizActivities.length > 0 && (
                    <div className="mb-4">
                      <div className="flex items-center justify-between text-xs text-gray-500 mb-1.5">
                        <span className="font-semibold text-primary">
                          Question {activeQuizIndex + 1} of {quizActivities.length}
                        </span>
                        <span className="capitalize text-[11px] font-medium chip !py-0.5">
                          {activity.type}
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary transition-all duration-300 rounded-full"
                          style={{
                            width: `${Math.round(((activeQuizIndex + 1) / quizActivities.length) * 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                  )}

                  <div className="flex items-start gap-4 mb-5">
                    <div className="flex-1 min-w-0">
                      <div className="font-display font-semibold text-lg leading-snug">
                        {activity.question}
                      </div>
                    </div>
                    {endsAt && !revealed && (
                      <TimerRing seconds={countdown.seconds} totalSeconds={activity.timer_seconds} size={54} />
                    )}
                  </div>

                  {/* Options List with Instant Auto-Advance on Click */}
                  <div className="space-y-2.5">
                    {(activity.options || []).map((option, idx) => {
                      const isSelected = selected === option;
                      return (
                        <button
                          key={idx}
                          disabled={locked || timeUp || suspended}
                          onClick={() => handleSelectOption(option)}
                          className={`w-full text-left px-4 py-3.5 rounded-xl border text-sm transition-all duration-150 flex items-center justify-between gap-3 ${
                            isSelected
                              ? "border-primary bg-primary/15 text-primary font-semibold ring-2 ring-primary/40 scale-[0.99]"
                              : "border-[#E1E1DC] dark:border-[#2A2E52] hover:border-primary/60 hover:bg-gray-50 dark:hover:bg-gray-800/40"
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <span
                              className={`w-6 h-6 rounded-lg text-xs font-bold flex items-center justify-center shrink-0 border ${
                                isSelected
                                  ? "bg-primary text-white border-primary"
                                  : "bg-gray-100 dark:bg-gray-800 text-gray-500 border-gray-200 dark:border-gray-700"
                              }`}
                            >
                              {String.fromCharCode(65 + idx)}
                            </span>
                            <span className="truncate">{option}</span>
                          </div>
                          {isSelected && isAdvancing && (
                            <span className="text-xs font-bold text-primary shrink-0 animate-pulse">
                              Advancing...
                            </span>
                          )}
                        </button>
                      );
                    })}

                    <div className="text-xs text-center pt-2 text-gray-400">
                      {isAdvancing ? "Next question loading..." : "Select an option to auto-advance"}
                    </div>
                  </div>
                </div>
              ))}

            {/* ---- Q&A tab ---- */}
            {tab === "qa" && (
              <div className="space-y-3">
                <QAComposer onSubmit={askQuestion} placeholder="Ask the host a question..." />
                <QAFeed items={qaItems} />
              </div>
            )}

            {/* ---- Scores tab ---- */}
            {tab === "scores" && <Leaderboard rows={leaderboard} highlightId={participant.id} />}
          </>
        )}
      </div>
    </main>
  );
}

