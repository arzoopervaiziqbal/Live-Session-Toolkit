"use client";
import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import Navbar from "../../../../../components/Navbar";
import {
  ResultChart,
  TimerRing,
  Leaderboard,
  QAFeed,
  Spinner,
  StatusPill,
  ParticipantList,
  ProctorRequestPanel,
  PushModeToggle,
  StudentScoreTable,
  PollVoteDetails,
} from "../../../../../components/LiveWidgets";
import { useAuthGuard } from "../../../../../lib/useAuthGuard";
import { useSessionSocket, useCountdown } from "../../../../../lib/useSession";
import { api } from "../../../../../lib/api";

export default function HostLivePage() {
  const router = useRouter();
  const { id } = useParams();
  const { user, logout, ready } = useAuthGuard();

  const [session, setSession] = useState(null);
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const [currentId, setCurrentId] = useState(null);
  const [endsAt, setEndsAt] = useState(null);
  const [tally, setTally] = useState(null);
  const [closed, setClosed] = useState(false);
  const [stats, setStats] = useState({ answered: 0, participantCount: 0 });
  const [leaderboard, setLeaderboard] = useState([]);
  const [qaItems, setQaItems] = useState([]);
  const [tab, setTab] = useState("run");
  const [redirecting, setRedirecting] = useState(false);

  // Feature 2: full participant list
  const [participantList, setParticipantList] = useState([]);

  // Feature 3: proctor requests
  const [proctorRequests, setProctorRequests] = useState([]);

  // Feature 1: push mode (single | bulk) + bulk progress
  const [pushMode, setPushMode] = useState("single");
  const [bulkIndex, setBulkIndex] = useState(null);
  const [bulkTotal, setBulkTotal] = useState(null);

  // Full student score list & poll vote breakdown
  const [detailedLeaderboard, setDetailedLeaderboard] = useState([]);
  const [pollDetails, setPollDetails] = useState(null);

  const current = useMemo(() => activities.find((a) => a.id === currentId) || null, [activities, currentId]);

  // ---- realtime handlers ----
  const handlers = {
    onActivityPushHost: ({ activity, endsAt: ends }) => {
      setCurrentId(activity.id);
      setEndsAt(ends);
      setTally(null);
      setClosed(false);
      setPollDetails(null);
      setStats((s) => ({ ...s, answered: 0 }));
    },
    onActivityEnded: ({ activityType, activityId, tally: t, leaderboard: rows, details }) => {
      setClosed(true);
      setEndsAt(null);
      if (t) setTally(t);
      if (rows && rows.length) {
        setLeaderboard(rows);
        setDetailedLeaderboard(rows);
      }
      if (details && (activityType === "poll" || current?.type === "poll")) {
        setPollDetails(details);
      }
    },
    onActivityClose: ({ activityId, tally: t }) => {
      setClosed(true);
      setEndsAt(null);
      if (t && t.activityId === activityId) setTally(t);
      api.getSessionLeaderboard(id).then((d) => {
        if (d?.leaderboard) {
          setLeaderboard(d.leaderboard);
          setDetailedLeaderboard(d.leaderboard);
        }
      }).catch(() => {});
      if (current?.type === "poll") {
        api.activityResults(activityId).then((d) => {
          if (d?.pollDetails) setPollDetails(d.pollDetails);
        }).catch(() => {});
      }
    },
    // Feature 1: bulk mode auto-advance notification
    onAutoNext: ({ activityId, index, total, endsAt: ends }) => {
      setCurrentId(activityId);
      setEndsAt(ends);
      setTally(null);
      setClosed(false);
      setStats((s) => ({ ...s, answered: 0 }));
      setBulkIndex(index);
      setBulkTotal(total);
    },
    onTally: (t) => setTally(t),
    onStats: (s) => setStats({ answered: s.answered, participantCount: s.participantCount }),
    onLeaderboard: ({ leaderboard: rows }) => setLeaderboard(rows),
    // Feature 2: presence now includes full participant list
    onPresence: ({ participantCount, participants }) => {
      setStats((s) => ({ ...s, participantCount }));
      if (participants) setParticipantList(participants);
    },
    onQaNew: ({ item }) => setQaItems((list) => [item, ...list]),
    onQaUpdate: ({ item }) =>
      setQaItems((list) =>
        item.deleted ? list.filter((i) => i.id !== item.id) : list.map((i) => (i.id === item.id ? item : i))
      ),
    // Feature 3: host receives proctor request
    onProctorRequest: (req) => {
      setProctorRequests((prev) => {
        // Avoid duplicate if same participant re-triggers
        const exists = prev.find((r) => r.participantId === req.participantId);
        if (exists) return prev;
        return [...prev, req];
      });
    },
  };

  const { connected, serverNow, socket } = useSessionSocket({
    sessionId: session?.id,
    role: "host",
    handlers,
  });

  const countdown = useCountdown(endsAt, serverNow);

  // ---- initial load ----
  const load = useCallback(async () => {
    try {
      const [live, qa] = await Promise.all([api.getLiveState(id), api.listQuestions(id)]);
      setSession(live.session);
      setActivities(live.activities);
      setCurrentId(live.currentActivityId);
      setEndsAt(live.endsAt);
      setQaItems(qa.items);
      setPushMode(live.session.push_mode || "single");
      setStats((s) => ({ ...s, participantCount: live.participants.length }));
      setParticipantList(
        live.participants.map((p) => ({
          id: p.id,
          name: p.name,
          joinedAt: p.joined_at,
          score: p.total_score,
          isOnline: false, // updated by presence events
        }))
      );

      let last = null;
      let rank = 0;
      setLeaderboard(
        live.participants.map((p, i) => {
          const r = p.total_score === last ? rank : i + 1;
          last = p.total_score;
          rank = r;
          return { rank: r, participantId: p.id, name: p.name, score: p.total_score };
        })
      );

      // Load full student score list with accuracy & submission times
      api.getSessionLeaderboard(id).then((d) => {
        if (d?.leaderboard) setDetailedLeaderboard(d.leaderboard);
      }).catch(() => {});

      // If active question is a closed poll, load its vote breakdown
      if (live.currentActivityId) {
        const act = live.activities.find((a) => a.id === live.currentActivityId);
        if (act?.type === "poll" && act.closed_at) {
          api.activityResults(live.currentActivityId).then((d) => {
            if (d?.pollDetails) setPollDetails(d.pollDetails);
          }).catch(() => {});
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  // ---- controls ----
  async function start() {
    setBusy(true);
    try {
      const { session: s } = await api.startSession(id);
      setSession(s);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function push(activity) {
    setBusy(true);
    setError(null);
    try {
      const data = await api.pushActivity(activity.id);
      setCurrentId(activity.id);
      setEndsAt(data.endsAt);
      setTally(null);
      setClosed(false);
      setPollDetails(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // Feature 1: start bulk — push the first question, bulk mode takes over from there
  async function startBulk() {
    const firstUnused = activities.find((a) => !a.closed_at);
    if (!firstUnused) return;
    setBulkIndex(1);
    setBulkTotal(activities.length);
    await push(firstUnused);
  }

  // Feature 1: change push mode via API
  async function changePushMode(mode) {
    setPushMode(mode);
    try {
      await api.updateSession(id, { pushMode: mode });
    } catch {
      /* non-critical */
    }
  }

  async function close() {
    setBusy(true);
    try {
      const data = await api.endActivity(currentId);
      setClosed(true);
      setEndsAt(null);
      if (data.tally) setTally(data.tally);
      if (data.leaderboard && data.leaderboard.length) {
        setLeaderboard(data.leaderboard);
        setDetailedLeaderboard(data.leaderboard);
      }
      if (data.pollDetails) setPollDetails(data.pollDetails);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function end() {
    if (!confirm("End the session? Participants stop answering and the report is finalised.")) return;
    setBusy(true);
    try {
      await api.endSession(id);
      setRedirecting(true);
      setTimeout(() => router.push(`/host/sessions/${id}/report`), 1500);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function toggleQa(item, field) {
    const patch = field === "answered" ? { isAnswered: !item.is_answered } : { isHighlighted: !item.is_highlighted };
    try {
      const { item: updated } = await api.updateQaItem(item.id, patch);
      setQaItems((list) => list.map((i) => (i.id === updated.id ? updated : i)));
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteQa(item) {
    try {
      await api.deleteQaItem(item.id);
      setQaItems((list) => list.filter((i) => i.id !== item.id));
    } catch (err) {
      setError(err.message);
    }
  }

  // Feature 3: host grants or rejects a proctor request
  function handleProctorDecision(participantId, granted) {
    setProctorRequests((prev) => prev.filter((r) => r.participantId !== participantId));
    socket?.current?.emit("proctor:decision", { participantId, granted });
  }

  if (!ready) return null;
  if (loading) return <Spinner label="Loading live room..." />;
  if (!session) return <div className="p-8"><div className="form-error">{error || "Session not found."}</div></div>;

  if (redirecting) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="card p-8 text-center max-w-sm w-full">
          <div className="text-4xl mb-4">🎉</div>
          <div className="font-display font-bold text-xl mb-2">Session Ended!</div>
          <p className="text-sm text-gray-500 mb-4">Loading the full report…</p>
          <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin mx-auto" />
        </div>
      </div>
    );
  }

  const joinUrl = typeof window !== "undefined" ? `${window.location.origin}/participant/join?code=${session.session_code}` : "";
  const unansweredCount = qaItems.filter((i) => !i.is_answered).length;
  const isBulk = pushMode === "bulk";
  const isActive = session.status === "active";

  return (
    <main className="min-h-screen">
      <Navbar
        userName={user?.name}
        onLogout={logout}
        right={
          <div className="flex items-center gap-2 text-xs">
            <span className={`w-2 h-2 rounded-full ${connected ? "bg-live animate-pulse" : "bg-amber-500"}`} />
            <span className="text-gray-500 hidden sm:inline">{connected ? "Live" : "Reconnecting"}</span>
          </div>
        }
      />

      <div className="max-w-6xl mx-auto px-5 py-6">
        {/* ---- header ---- */}
        <div className="flex justify-between items-start gap-4 mb-5 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 mb-1 flex-wrap">
              <h1 className="font-display text-xl font-bold truncate">{session.title}</h1>
              <StatusPill status={session.status} />
            </div>
            <div className="flex items-center gap-3 text-sm text-gray-500 flex-wrap">
              <span>
                Code <span className="font-mono tracking-widest text-primary text-base">{session.session_code}</span>
              </span>
              <button
                className="text-xs text-primary hover:underline"
                onClick={() => navigator.clipboard?.writeText(joinUrl)}
              >
                Copy join link
              </button>
              <span>{stats.participantCount} joined</span>
              {/* Proctor alert badge */}
              {proctorRequests.length > 0 && (
                <span className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded-full font-semibold">
                  ⚠️ {proctorRequests.length} alert{proctorRequests.length > 1 ? "s" : ""}
                </span>
              )}
            </div>
          </div>

          <div className="flex gap-2 shrink-0 flex-wrap items-center">
            {/* Feature 1: push mode toggle — only changeable when not in a live question */}
            {isActive && (
              <PushModeToggle
                mode={pushMode}
                onChange={changePushMode}
                disabled={busy || (!!currentId && !closed)}
              />
            )}
            {session.status === "draft" && (
              <button className="btn-live" disabled={busy} onClick={start}>
                Start session
              </button>
            )}
            {isActive && (
              <button className="btn-danger" disabled={busy} onClick={end}>
                End session
              </button>
            )}
            {session.status === "ended" && (
              <button className="btn-primary" onClick={() => router.push(`/host/sessions/${id}/report`)}>
                Open report
              </button>
            )}
          </div>
        </div>

        {error && <div className="form-error mb-4">{error}</div>}

        {/* Feature 3: Proctor alerts — pinned above the grid */}
        {proctorRequests.length > 0 && (
          <div className="mb-4">
            <ProctorRequestPanel
              requests={proctorRequests}
              onDecision={handleProctorDecision}
            />
          </div>
        )}

        {/* ---- mobile tabs ---- */}
        <div className="flex gap-1 p-1 bg-[#F5F5F2] dark:bg-[#0E1020] rounded-lg border border-[#E1E1DC] dark:border-[#2A2E52] mb-4 lg:hidden">
          {[
            ["run", "Run"],
            ["participants", `People (${stats.participantCount})`],
            ["qa", `Q&A${unansweredCount ? ` (${unansweredCount})` : ""}`],
            ["scores", "Scores"],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex-1 text-xs py-2 rounded-md ${tab === key ? "bg-primary text-white" : "text-gray-500"}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="grid lg:grid-cols-3 gap-5">
          {/* ---- main column ---- */}
          <div className={`lg:col-span-2 space-y-5 ${tab !== "run" ? "hidden lg:block" : ""}`}>

            {/* Feature 1: Bulk mode progress bar */}
            {isBulk && bulkTotal && (
              <div className="card px-4 py-3 flex items-center gap-3">
                <span className="text-xs text-gray-500 font-medium shrink-0">Bulk progress</span>
                <div className="flex-1 h-2 rounded-full bg-[#E1E1DC] dark:bg-[#2A2E52] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-500"
                    style={{ width: `${Math.round(((bulkIndex || 0) / bulkTotal) * 100)}%` }}
                  />
                </div>
                <span className="text-xs font-display font-bold tabular-nums shrink-0">
                  {bulkIndex || "—"} / {bulkTotal}
                </span>
              </div>
            )}

            {/* current question */}
            {current ? (
              <div className="card p-5">
                {/* Distinct Completion Banner */}
                {closed && current.type === "quiz" && (
                  <div className="bg-gradient-to-r from-amber-500/15 via-primary/10 to-amber-500/15 border border-amber-500/40 rounded-xl p-4 mb-4 flex items-center justify-between gap-3 shadow-sm">
                    <div className="flex items-center gap-3">
                      <span className="text-3xl">🏆</span>
                      <div>
                        <div className="font-display font-bold text-base text-gray-900 dark:text-gray-100">Quiz Ended</div>
                        <div className="text-xs text-gray-500">Question closed. Submissions are locked and student scores are calculated below.</div>
                      </div>
                    </div>
                    <span className="chip border-primary/40 text-primary font-bold px-3 py-1">Ended</span>
                  </div>
                )}
                {closed && current.type === "poll" && (
                  <div className="bg-gradient-to-r from-blue-500/15 via-primary/10 to-blue-500/15 border border-blue-500/40 rounded-xl p-4 mb-4 flex items-center justify-between gap-3 shadow-sm">
                    <div className="flex items-center gap-3">
                      <span className="text-3xl">📊</span>
                      <div>
                        <div className="font-display font-bold text-base text-gray-900 dark:text-gray-100">Poll Ended</div>
                        <div className="text-xs text-gray-500">Voting is complete. Final percentage breakdown and student choices are displayed below.</div>
                      </div>
                    </div>
                    <span className="chip border-blue-500/40 text-blue-600 dark:text-blue-400 font-bold px-3 py-1">Ended</span>
                  </div>
                )}

                <div className="flex items-start gap-4 mb-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className="chip chip-on capitalize">{current.type}</span>
                      {closed ? (
                        <span className="chip font-semibold">closed</span>
                      ) : (
                        <span className="chip border-live/40 text-live">live now</span>
                      )}
                      {isBulk && bulkTotal && (
                        <span className="chip text-gray-500">
                          Q {bulkIndex || "?"} of {bulkTotal}
                        </span>
                      )}
                    </div>
                    <div className="font-display font-semibold text-lg">{current.question}</div>
                  </div>

                  {!closed && endsAt && (
                    <TimerRing seconds={countdown.seconds} totalSeconds={current.timer_seconds} />
                  )}
                </div>

                <div className="flex items-center gap-4 text-sm text-gray-500 mb-4 flex-wrap">
                  <span>
                    <span className="font-display font-bold text-primary text-lg">{stats.answered}</span> of{" "}
                    {stats.participantCount} answered
                  </span>
                  {current.type === "quiz" && closed && current.correct_answer && (
                    <span className="text-live font-semibold">Answer: {current.correct_answer}</span>
                  )}
                </div>

                <ResultChart tally={tally} revealCorrect={closed} />

                {!closed && (
                  <button className="btn-secondary mt-4 font-semibold text-sm py-2.5 px-4 shadow-sm" disabled={busy} onClick={close}>
                    {current?.type === "quiz" ? "⏹ End Quiz & Reveal" : "⏹ End Poll & Reveal"}
                  </button>
                )}

                {/* Feature 1: Single mode — "Next Question" shortcut when closed */}
                {closed && !isBulk && (() => {
                  const nextIdx = activities.findIndex((a) => a.id === currentId);
                  const next = activities[nextIdx + 1];
                  return next ? (
                    <button className="btn-primary mt-3" disabled={busy} onClick={() => push(next)}>
                      Next Question →
                    </button>
                  ) : null;
                })()}

                {/* Full Student Score List when Quiz ends */}
                {closed && current.type === "quiz" && (
                  <div className="mt-6 pt-4 border-t border-[#E1E1DC] dark:border-[#2A2E52]">
                    <StudentScoreTable
                      rows={detailedLeaderboard.length ? detailedLeaderboard : leaderboard}
                      title="Quiz Student Score List"
                    />
                  </div>
                )}

                {/* Individual Student Votes when Poll ends */}
                {closed && current.type === "poll" && pollDetails && (
                  <div className="mt-6 pt-4 border-t border-[#E1E1DC] dark:border-[#2A2E52]">
                    <PollVoteDetails details={pollDetails} options={current.options || []} />
                  </div>
                )}
              </div>
            ) : (
              <div className="card p-8 text-center">
                <div className="font-display font-semibold mb-1.5">Nothing on screen yet</div>
                <p className="text-sm text-gray-500">
                  {session.status === "draft"
                    ? "Start the session, then push your first question."
                    : isBulk
                    ? "Click \"Start Bulk\" to push all questions automatically."
                    : "Pick a question below and push it to everyone."}
                </p>
                {isActive && isBulk && !currentId && activities.length > 0 && (
                  <button className="btn-live mt-4" disabled={busy} onClick={startBulk}>
                    ▶ Start Bulk Quiz
                  </button>
                )}
              </div>
            )}

            {/* question queue — hidden in bulk mode (auto-managed) */}
            {!isBulk && (
              <div>
                <h2 className="font-display font-semibold mb-2.5">
                  Questions ({activities.length})
                </h2>

                {!activities.length ? (
                  <div className="card p-6 text-center text-sm text-gray-500">
                    Nothing published yet.{" "}
                    <button className="text-primary hover:underline" onClick={() => router.push(`/host/sessions/${id}/review`)}>
                      Go build your quiz
                    </button>
                  </div>
                ) : (
                  <div className="grid gap-2">
                    {activities.map((a, i) => {
                      const isCurrent = a.id === currentId;
                      const used = Boolean(a.closed_at) && !isCurrent;
                      return (
                        <div
                          key={a.id}
                          className={`card p-3 flex items-center gap-3 ${isCurrent ? "border-live" : ""} ${
                            used ? "opacity-55" : ""
                          }`}
                        >
                          <span className="font-display font-bold text-xs text-gray-400 w-5 shrink-0">{i + 1}</span>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm truncate">{a.question}</div>
                            <div className="text-[11px] text-gray-500 flex gap-2">
                              <span className="capitalize">{a.type}</span>
                              <span>{a.timer_seconds}s</span>
                              {used && <span>done</span>}
                            </div>
                          </div>
                          <button
                            className={isCurrent ? "btn-secondary shrink-0" : "btn-primary shrink-0"}
                            disabled={busy || session.status !== "active" || (isCurrent && !closed)}
                            onClick={() => push(a)}
                          >
                            {isCurrent && !closed ? "On screen" : used || isCurrent ? "Re-run" : "Push"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Bulk mode: summary list (read-only queue) */}
            {isBulk && activities.length > 0 && (
              <div>
                <h2 className="font-display font-semibold mb-2.5">
                  Bulk Queue ({activities.length} questions)
                </h2>
                <div className="grid gap-1.5">
                  {activities.map((a, i) => {
                    const isCurrent = a.id === currentId;
                    const done = Boolean(a.closed_at) && !isCurrent;
                    return (
                      <div
                        key={a.id}
                        className={`flex items-center gap-3 px-3 py-2 rounded-lg border text-sm ${
                          isCurrent
                            ? "border-live bg-live/5"
                            : done
                            ? "border-[#E1E1DC] dark:border-[#2A2E52] opacity-50"
                            : "border-[#E1E1DC] dark:border-[#2A2E52]"
                        }`}
                      >
                        <span className="w-5 shrink-0 text-center font-bold text-xs text-gray-400">{i + 1}</span>
                        <span className="flex-1 truncate">{a.question}</span>
                        <span className="text-[11px] text-gray-400 shrink-0">
                          {isCurrent ? "▶ Live" : done ? "✓ Done" : `${a.timer_seconds}s`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* ---- side column ---- */}
          <div className="space-y-5">
            {/* Feature 2: participant list */}
            <div className={tab !== "participants" ? "hidden lg:block" : ""}>
              <ParticipantList
                participants={participantList}
                totalCount={stats.participantCount}
              />
            </div>

            <div className={tab !== "scores" ? "hidden lg:block" : ""}>
              <Leaderboard rows={leaderboard} limit={10} />
            </div>

            {(session.active_categories || []).includes("qa") && (
              <div className={`card p-4 ${tab !== "qa" ? "hidden lg:block" : ""}`}>
                <div className="flex justify-between items-center mb-3">
                  <span className="font-display font-semibold text-sm">Q&amp;A</span>
                  {unansweredCount > 0 && (
                    <span className="chip chip-on">{unansweredCount} open</span>
                  )}
                </div>
                <div className="max-h-[520px] overflow-y-auto pr-1">
                  <QAFeed
                    items={qaItems}
                    isHost
                    onToggleAnswered={(item) => toggleQa(item, "answered")}
                    onToggleHighlight={(item) => toggleQa(item, "highlight")}
                    onDelete={deleteQa}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
