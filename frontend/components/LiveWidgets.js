"use client";
import { useState } from "react";

// ---------------------------------------------------------------------------
// Poll / answer distribution bar chart (PRD 6.3)
// ---------------------------------------------------------------------------
export function ResultChart({ tally, revealCorrect = false, myAnswer = null, compact = false }) {
  if (!tally || !tally.results?.length) {
    return <div className="text-sm text-gray-500 py-4">No votes yet.</div>;
  }

  const max = Math.max(1, ...tally.results.map((r) => r.count));

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      {tally.results.map((r) => {
        const isCorrect = revealCorrect && r.isCorrect === true;
        const isMine = myAnswer !== null && String(myAnswer) === String(r.option);
        const width = Math.round((r.count / max) * 100);

        return (
          <div key={r.option}>
            <div className="flex justify-between items-center text-sm mb-1 gap-2">
              <span className="flex items-center gap-1.5 min-w-0">
                <span className="truncate">{r.option}</span>
                {isCorrect && <span className="text-live text-xs shrink-0">✓ correct</span>}
                {isMine && <span className="text-primary text-xs shrink-0">• your answer</span>}
              </span>
              <span className="tabular-nums text-xs text-gray-500 shrink-0">
                {r.count} · {r.percentage}%
              </span>
            </div>
            <div className="h-2.5 rounded-full bg-[#E1E1DC] dark:bg-[#2A2E52] overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  isCorrect ? "bg-live" : isMine ? "bg-primary" : "bg-primary/45"
                }`}
                style={{ width: `${width}%` }}
              />
            </div>
          </div>
        );
      })}
      <div className="text-xs text-gray-500 pt-1">
        {tally.total} response{tally.total === 1 ? "" : "s"}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Countdown ring — drives urgency without a layout shift each tick
// ---------------------------------------------------------------------------
export function TimerRing({ seconds, totalSeconds, size = 72 }) {
  const fraction = totalSeconds ? Math.max(0, Math.min(1, seconds / totalSeconds)) : 0;
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const urgent = seconds <= 5 && seconds > 0;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth="5"
          className="stroke-[#E1E1DC] dark:stroke-[#2A2E52]"
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth="5"
          fill="none"
          strokeLinecap="round"
          className={urgent ? "stroke-red-500" : "stroke-primary"}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
          style={{ transition: "stroke-dashoffset 200ms linear" }}
        />
      </svg>
      <div
        className={`absolute inset-0 flex items-center justify-center font-display font-bold tabular-nums ${
          urgent ? "text-red-500" : ""
        }`}
        style={{ fontSize: size / 3 }}
      >
        {Math.max(0, seconds)}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------
export function Leaderboard({ rows = [], highlightId = null, limit = 10, title = "Leaderboard" }) {
  const shown = rows.slice(0, limit);

  return (
    <div className="card p-4">
      <div className="font-display font-semibold text-sm mb-3">{title}</div>
      {!shown.length ? (
        <div className="text-sm text-gray-500">No scores yet.</div>
      ) : (
        <div className="space-y-1.5">
          {shown.map((row) => {
            const isMe = highlightId && row.participantId === highlightId;
            return (
              <div
                key={row.participantId}
                className={`flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm ${
                  isMe ? "bg-primary/10 border border-primary/30" : ""
                }`}
              >
                <span
                  className={`w-6 text-center font-display font-bold text-xs ${
                    row.rank === 1 ? "text-live" : "text-gray-400"
                  }`}
                >
                  {row.rank}
                </span>
                <span className="flex-1 truncate">
                  {row.name}
                  {isMe && <span className="text-primary text-xs ml-1.5">you</span>}
                </span>
                <span className="tabular-nums font-semibold">{row.score}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live Q&A feed (PRD 6.4)
// ---------------------------------------------------------------------------
export function QAFeed({ items = [], isHost = false, onToggleAnswered, onToggleHighlight, onDelete }) {
  if (!items.length) {
    return <div className="text-sm text-gray-500 py-4 text-center">No questions yet.</div>;
  }

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div
          key={item.id}
          className={`card p-3 ${
            item.is_highlighted ? "border-live bg-live/5" : ""
          } ${item.is_answered ? "opacity-60" : ""}`}
        >
          <div className="flex justify-between items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="text-xs font-semibold">{item.participant_name}</span>
                <span className="text-[11px] text-gray-400">
                  {new Date(item.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
                {item.is_highlighted && (
                  <span className="text-[10px] uppercase tracking-wide text-live font-semibold">pinned</span>
                )}
                {item.is_answered && (
                  <span className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">answered</span>
                )}
              </div>
              <div className="text-sm break-words">{item.question_text}</div>
            </div>

            {isHost && (
              <div className="flex gap-1 shrink-0">
                <button
                  onClick={() => onToggleHighlight?.(item)}
                  title={item.is_highlighted ? "Unpin" : "Pin for everyone"}
                  className="text-sm px-1.5 py-0.5 rounded hover:bg-[#F5F5F2] dark:hover:bg-[#0E1020]"
                >
                  {item.is_highlighted ? "📌" : "📍"}
                </button>
                <button
                  onClick={() => onToggleAnswered?.(item)}
                  title={item.is_answered ? "Mark unanswered" : "Mark answered"}
                  className="text-sm px-1.5 py-0.5 rounded hover:bg-[#F5F5F2] dark:hover:bg-[#0E1020]"
                >
                  {item.is_answered ? "↺" : "✓"}
                </button>
                <button
                  onClick={() => onDelete?.(item)}
                  title="Remove"
                  className="text-sm px-1.5 py-0.5 rounded hover:bg-red-50 dark:hover:bg-red-950/30 text-gray-400 hover:text-red-500"
                >
                  ✕
                </button>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function QAComposer({ onSubmit, disabled = false, placeholder = "Ask a question..." }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      await onSubmit(value);
      setText("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex gap-2">
      <input
        className="field flex-1"
        value={text}
        maxLength={1000}
        disabled={disabled || busy}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
      />
      <button className="btn-primary" onClick={send} disabled={disabled || busy || !text.trim()}>
        {busy ? "..." : "Send"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status banners
// ---------------------------------------------------------------------------
export function ConnectionBanner({ online, connected, pending = 0 }) {
  if (online && connected && !pending) return null;

  let tone = "bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-200";
  let message = "Reconnecting to the live session...";

  if (!online) {
    tone = "bg-red-50 dark:bg-red-950/30 border-red-300 dark:border-red-800 text-red-700 dark:text-red-300";
    message =
      pending > 0
        ? `You're offline. ${pending} answer${pending === 1 ? "" : "s"} saved on this device and will send automatically.`
        : "You're offline. Your answers will be saved on this device and sent when you're back.";
  } else if (pending > 0) {
    message = `Syncing ${pending} saved answer${pending === 1 ? "" : "s"}...`;
  }

  return <div className={`border rounded-lg px-3 py-2 text-xs font-medium ${tone}`}>{message}</div>;
}

export function Spinner({ label = "Loading..." }) {
  return (
    <div className="flex items-center justify-center gap-2.5 py-10 text-sm text-gray-500">
      <span className="w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      {label}
    </div>
  );
}

export function StatusPill({ status }) {
  const styles = {
    draft: "bg-gray-100 dark:bg-[#0E1020] text-gray-500 border-[#E1E1DC] dark:border-[#2A2E52]",
    active: "bg-live/10 text-live border-live/40",
    ended: "bg-gray-100 dark:bg-[#0E1020] text-gray-400 border-[#E1E1DC] dark:border-[#2A2E52]",
  };
  return (
    <span
      className={`text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded-full border ${
        styles[status] || styles.draft
      }`}
    >
      {status === "active" && <span className="inline-block w-1.5 h-1.5 rounded-full bg-live mr-1 animate-pulse" />}
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Live participant list with online status dots (Feature 2)
// ---------------------------------------------------------------------------
export function ParticipantList({ participants = [], totalCount = 0 }) {
  const online = participants.filter((p) => p.isOnline);
  const offline = participants.filter((p) => !p.isOnline);
  const sorted = [...online, ...offline];

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="font-display font-semibold text-sm">Participants</span>
        <div className="flex items-center gap-1.5 text-xs">
          <span className="w-2 h-2 rounded-full bg-live inline-block" />
          <span className="text-gray-500">{online.length} online</span>
          <span className="text-gray-300 dark:text-gray-600 mx-1">·</span>
          <span className="text-gray-500">{totalCount} joined</span>
        </div>
      </div>

      {!sorted.length ? (
        <div className="text-sm text-gray-400 text-center py-3">
          Waiting for participants to join…
        </div>
      ) : (
        <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
          {sorted.map((p) => (
            <div key={p.id} className="flex items-center gap-2.5 py-1.5 px-2 rounded-lg hover:bg-[#F5F5F2] dark:hover:bg-[#0E1020] transition-colors">
              {/* Avatar initial */}
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                p.isOnline
                  ? "bg-primary/15 text-primary"
                  : "bg-gray-100 dark:bg-[#2A2E52] text-gray-400"
              }`}>
                {(p.name || "?")[0].toUpperCase()}
              </div>

              <div className="flex-1 min-w-0">
                <div className="text-sm truncate font-medium">{p.name}</div>
                <div className="text-[10px] text-gray-400">
                  {p.isOnline ? (
                    <span className="text-live">● online</span>
                  ) : (
                    <span>● offline</span>
                  )}
                  {p.joinedAt && (
                    <span className="ml-1.5">
                      joined {new Date(p.joinedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  )}
                </div>
              </div>

              {p.score > 0 && (
                <span className="text-xs font-semibold tabular-nums text-primary shrink-0">
                  {p.score}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Proctor approval panel shown to the host (Feature 3)
// ---------------------------------------------------------------------------
export function ProctorRequestPanel({ requests = [], onDecision }) {
  if (!requests.length) return null;

  return (
    <div className="card p-4 border-amber-400/60 dark:border-amber-600/60 bg-amber-50/60 dark:bg-amber-950/20">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-amber-500 text-base">⚠️</span>
        <span className="font-display font-semibold text-sm text-amber-800 dark:text-amber-300">
          Proctor Alerts ({requests.length})
        </span>
      </div>
      <div className="space-y-2">
        {requests.map((req) => (
          <div
            key={req.participantId}
            className="flex items-center gap-3 bg-white dark:bg-[#171A33] rounded-lg px-3 py-2.5 border border-amber-200 dark:border-amber-800"
          >
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold truncate">{req.name}</div>
              <div className="text-[11px] text-gray-500 capitalize">
                {req.reason === "tab_hidden" ? "Switched tabs" : "Left the window"}
                {req.suspendedAt && (
                  <span className="ml-1.5">
                    at {new Date(req.suspendedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </span>
                )}
              </div>
            </div>
            <div className="flex gap-1.5 shrink-0">
              <button
                onClick={() => onDecision(req.participantId, true)}
                className="text-xs px-2.5 py-1 rounded-md bg-live/10 text-live border border-live/30 hover:bg-live/20 font-semibold transition-colors"
              >
                Grant
              </button>
              <button
                onClick={() => onDecision(req.participantId, false)}
                className="text-xs px-2.5 py-1 rounded-md bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 hover:bg-red-100 font-semibold transition-colors"
              >
                Reject
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Push mode toggle — Single vs Bulk (Feature 1)
// ---------------------------------------------------------------------------
export function PushModeToggle({ mode = "single", onChange, disabled = false }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500 font-medium shrink-0">Push mode</span>
      <div className="flex gap-0.5 p-0.5 bg-[#F5F5F2] dark:bg-[#0E1020] rounded-lg border border-[#E1E1DC] dark:border-[#2A2E52]">
        {[
          ["single", "Single"],
          ["bulk", "Bulk"],
        ].map(([val, label]) => (
          <button
            key={val}
            disabled={disabled}
            onClick={() => onChange?.(val)}
            className={`text-xs px-3 py-1 rounded-md font-medium transition-colors ${
              mode === val
                ? "bg-primary text-white shadow-sm"
                : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quiz Suspended overlay shown to participant (Feature 3)
// ---------------------------------------------------------------------------
export function SuspendedOverlay({ rejectedByHost }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="card max-w-sm w-full mx-4 p-8 text-center">
        <div className="text-5xl mb-4">{rejectedByHost ? "🚫" : "⏸️"}</div>
        <h2 className="font-display font-bold text-xl mb-2">
          {rejectedByHost ? "Re-entry Denied" : "Quiz Suspended"}
        </h2>
        {rejectedByHost ? (
          <p className="text-sm text-gray-500">
            The host has not approved your re-entry. Please contact your instructor.
          </p>
        ) : (
          <>
            <p className="text-sm text-gray-500 mb-4">
              Your quiz was paused because you left this window. Waiting for host approval to continue.
            </p>
            <div className="flex items-center justify-center gap-2 text-primary">
              <span className="w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              <span className="text-sm font-medium">Awaiting host approval…</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Full Student Score List / Table for Host
// ---------------------------------------------------------------------------
export function StudentScoreTable({ rows = [], title = "Student Score List" }) {
  const [sortBy, setSortBy] = useState("score"); // 'score' | 'name' | 'accuracy'
  const [query, setQuery] = useState("");

  const formatTime = (iso) => {
    if (!iso) return "—";
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch {
      return "—";
    }
  };

  const filtered = rows.filter((r) =>
    (r.name || "").toLowerCase().includes(query.toLowerCase())
  );

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === "name") return (a.name || "").localeCompare(b.name || "");
    if (sortBy === "accuracy") return (b.accuracy || 0) - (a.accuracy || 0);
    return (b.score || 0) - (a.score || 0);
  });

  return (
    <div className="card p-5">
      <div className="flex justify-between items-center gap-3 mb-4 flex-wrap">
        <div>
          <div className="font-display font-bold text-base">{title}</div>
          <div className="text-xs text-gray-500">{rows.length} participant{rows.length === 1 ? "" : "s"} ranked</div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="text"
            placeholder="Filter student..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="input text-xs py-1.5 px-2.5 w-36 sm:w-44"
          />

          <div className="flex items-center gap-1 bg-[#F5F5F2] dark:bg-[#0E1020] p-1 rounded-lg border border-[#E1E1DC] dark:border-[#2A2E52]">
            <button
              onClick={() => setSortBy("score")}
              className={`text-xs px-2.5 py-1 rounded font-medium transition-colors ${
                sortBy === "score"
                  ? "bg-primary text-white shadow-sm"
                  : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
              }`}
            >
              Highest Score
            </button>
            <button
              onClick={() => setSortBy("name")}
              className={`text-xs px-2.5 py-1 rounded font-medium transition-colors ${
                sortBy === "name"
                  ? "bg-primary text-white shadow-sm"
                  : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
              }`}
            >
              Name (A-Z)
            </button>
          </div>
        </div>
      </div>

      {!sorted.length ? (
        <div className="text-center py-8 text-sm text-gray-500">
          {query ? "No students match your filter." : "No student submissions recorded yet."}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs sm:text-sm">
            <thead>
              <tr className="border-b border-[#E1E1DC] dark:border-[#2A2E52] text-gray-500 text-xs uppercase font-medium">
                <th className="pb-2.5 pr-3">Rank</th>
                <th className="pb-2.5 pr-4">Student</th>
                <th className="pb-2.5 pr-4">Score</th>
                <th className="pb-2.5 pr-4">Accuracy</th>
                <th className="pb-2.5 pr-4">Correct / Total</th>
                <th className="pb-2.5">Submission Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E1E1DC]/50 dark:divide-[#2A2E52]/50">
              {sorted.map((row) => {
                const rankBadge =
                  row.rank === 1 ? "🥇 #1" : row.rank === 2 ? "🥈 #2" : row.rank === 3 ? "🥉 #3" : `#${row.rank}`;
                const accuracy = Number.isFinite(row.accuracy) ? row.accuracy : 0;
                const accColor =
                  accuracy >= 80
                    ? "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/30"
                    : accuracy >= 50
                    ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30"
                    : "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30";

                return (
                  <tr key={row.participantId} className="hover:bg-[#F5F5F2]/50 dark:hover:bg-[#13162A]/50 transition-colors">
                    <td className="py-2.5 pr-3 font-display font-bold whitespace-nowrap">
                      <span className={row.rank <= 3 ? "text-primary" : "text-gray-500"}>{rankBadge}</span>
                    </td>
                    <td className="py-2.5 pr-4 font-medium whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                          {(row.name || "?")[0].toUpperCase()}
                        </span>
                        <span className="truncate max-w-[150px] sm:max-w-[200px]">{row.name}</span>
                      </div>
                    </td>
                    <td className="py-2.5 pr-4 whitespace-nowrap font-display font-bold text-primary">
                      {row.score} <span className="text-[10px] text-gray-500 font-normal">pts</span>
                    </td>
                    <td className="py-2.5 pr-4 whitespace-nowrap">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold border ${accColor}`}>
                        {accuracy}%
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 whitespace-nowrap text-xs">
                      <span className="font-semibold text-gray-900 dark:text-gray-100">
                        {row.correctCount ?? 0}
                      </span>
                      <span className="text-gray-400"> / {row.attemptedCount ?? row.totalQuizzes ?? 0}</span>
                      {row.incorrectCount !== undefined && (
                        <span className="text-[11px] text-gray-400 block">
                          ({row.incorrectCount} wrong)
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 whitespace-nowrap text-xs text-gray-500 tabular-nums">
                      {formatTime(row.submissionTime)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Poll Vote Details for Host
// ---------------------------------------------------------------------------
export function PollVoteDetails({ details, options = [] }) {
  const [query, setQuery] = useState("");
  const [filterOption, setFilterOption] = useState("all");

  if (!details) return null;

  const { totalJoined = 0, totalVotes = 0, percentageVoted = 0, studentVotes = [] } = details;

  const filtered = studentVotes.filter((s) => {
    const matchesQuery = (s.name || "").toLowerCase().includes(query.toLowerCase());
    const matchesOption = filterOption === "all" || (filterOption === "none" ? !s.hasVoted : s.selectedOption === filterOption);
    return matchesQuery && matchesOption;
  });

  const formatTime = (iso) => {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch {
      return "—";
    }
  };

  return (
    <div className="card p-5 mt-4">
      <div className="flex justify-between items-start gap-4 mb-4 flex-wrap">
        <div>
          <div className="font-display font-bold text-base mb-1">Student Vote Breakdown</div>
          <div className="flex items-center gap-3 text-xs text-gray-500">
            <span>
              Votes Cast: <strong className="text-primary font-display font-bold text-sm">{totalVotes}</strong> / {totalJoined}
            </span>
            <span className="chip border-primary/30 text-primary font-semibold">
              {percentageVoted}% Turnout
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="text"
            placeholder="Find student..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="input text-xs py-1.5 px-2.5 w-32 sm:w-40"
          />
          <select
            value={filterOption}
            onChange={(e) => setFilterOption(e.target.value)}
            className="input text-xs py-1.5 px-2"
          >
            <option value="all">All votes</option>
            <option value="none">Did not vote</option>
            {options.map((opt) => (
              <option key={opt} value={opt}>
                Option: {opt.slice(0, 20)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!filtered.length ? (
        <div className="text-center py-6 text-sm text-gray-500">No student votes matching filter.</div>
      ) : (
        <div className="overflow-x-auto max-h-72 overflow-y-auto">
          <table className="w-full text-left text-xs sm:text-sm">
            <thead className="sticky top-0 bg-[#FAFAFA] dark:bg-[#1A1D36] z-10">
              <tr className="border-b border-[#E1E1DC] dark:border-[#2A2E52] text-gray-500 text-xs uppercase font-medium">
                <th className="pb-2 pr-4">Student</th>
                <th className="pb-2 pr-4">Selected Option</th>
                <th className="pb-2">Voted At</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E1E1DC]/50 dark:divide-[#2A2E52]/50">
              {filtered.map((s) => (
                <tr key={s.participantId} className="hover:bg-[#F5F5F2]/50 dark:hover:bg-[#13162A]/50">
                  <td className="py-2 pr-4 font-medium whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                        {(s.name || "?")[0].toUpperCase()}
                      </span>
                      <span>{s.name}</span>
                    </div>
                  </td>
                  <td className="py-2 pr-4 whitespace-nowrap">
                    {s.hasVoted ? (
                      <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold bg-primary/10 text-primary border border-primary/30">
                        {s.selectedOption}
                      </span>
                    ) : (
                      <span className="inline-block px-2 py-0.5 rounded-full text-xs text-gray-400 bg-gray-100 dark:bg-gray-800">
                        No vote cast
                      </span>
                    )}
                  </td>
                  <td className="py-2 whitespace-nowrap text-xs text-gray-500 tabular-nums">
                    {formatTime(s.votedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}


