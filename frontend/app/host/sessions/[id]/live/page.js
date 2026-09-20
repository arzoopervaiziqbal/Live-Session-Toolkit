"use client";
import { useEffect, useState } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import Navbar from "../../../../../components/Navbar";
import { useLang } from "../../../../../contexts/LangContext";
import { useAuthGuard } from "../../../../../lib/useAuthGuard";
import { api, API_URL, getToken } from "../../../../../lib/api";

export default function LivePage() {
  const { t } = useLang();
  const { user, logout, ready } = useAuthGuard("host", "/host/login");
  const searchParams = useSearchParams();
  const router = useRouter();
  const activityId = searchParams.get("activity");

  const [results, setResults] = useState(null);
  const [copied, setCopied] = useState(false);
  const [filter, setFilter] = useState("all"); // 'all' | 'done' | 'pending'
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (!ready || !activityId) return;
    let isMounted = true;

    async function poll() {
      try {
        const data = await api.getResults(activityId);
        if (isMounted) setResults(data);
      } catch (err) {
        console.error("Error polling results:", err);
      }
    }

    poll();
    const interval = setInterval(poll, 3000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [ready, activityId]);

  if (!ready || !results) {
    return (
      <main className="min-h-screen">
        <Navbar userName={user?.name} onLogout={logout} logoutLabel={t.logout_btn} />
        <div className="max-w-4xl mx-auto px-6 py-16 text-center text-sm text-gray-400">
          Loading live session data…
        </div>
      </main>
    );
  }

  const link = `${typeof window !== "undefined" ? window.location.origin : ""}/participant/join?code=${results.activity.linkId}`;

  function copyLink() {
    navigator.clipboard?.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function handleExportCsv() {
    const token = getToken("host");
    const exportUrl = `${API_URL}/activities/${activityId}/export`;
    // Trigger download with auth header via fetch blob
    fetch(exportUrl, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.blob())
      .then((blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `session-${results.activity.linkId}-results.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      })
      .catch((err) => console.error("Export failed", err));
  }

  const allStudents = results.students || [];
  const completedCount = results.completedParticipants || allStudents.filter((s) => s.isDone).length;
  const pendingCount = results.pendingParticipants || (allStudents.length - completedCount);
  const avgScore = results.averageScore || 0;

  const filteredStudents = allStudents.filter((s) => {
    if (filter === "done" && !s.isDone) return false;
    if (filter === "pending" && s.isDone) return false;
    if (searchQuery.trim()) {
      return s.displayName.toLowerCase().includes(searchQuery.toLowerCase().trim());
    }
    return true;
  });

  return (
    <main className="min-h-screen pb-16 bg-[#FAFAF9] dark:bg-[#080915]">
      <Navbar userName={user?.name} onLogout={logout} logoutLabel={t.logout_btn} />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        {/* Top Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs font-mono font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                Live Quiz Session
              </span>
            </div>
            <h1 className="font-display text-2xl font-bold">{results.activity.title || t.published_title}</h1>
            <p className="text-xs text-gray-500">
              Live monitoring of student participants and quiz completion status
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-secondary text-xs flex items-center gap-1.5"
              onClick={handleExportCsv}
            >
              <span>📥</span> Export CSV
            </button>
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() => router.push("/host/dashboard")}
            >
              {t.back_btn || "Back to Dashboard"}
            </button>
          </div>
        </div>

        {/* Join Code & Share Box */}
        <div className="card p-5 mb-6 shadow-sm border border-[#E1E1DC] dark:border-[#2A2E52] bg-white dark:bg-[#12142B]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex-1 min-w-[200px]">
              <div className="text-xs text-gray-400 font-medium mb-1">Participant Join Link</div>
              <div className="font-mono text-xs sm:text-sm bg-[#F5F5F2] dark:bg-[#0E1020] border border-[#E1E1DC] dark:border-[#2A2E52] rounded-lg px-3 py-2 select-all break-all">
                {link}
              </div>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <div className="text-right">
                <div className="text-[11px] text-gray-400 uppercase font-medium">Join Code</div>
                <div className="font-mono text-xl font-bold text-primary tracking-widest">{results.activity.linkId}</div>
              </div>

              <button
                type="button"
                className="btn-primary flex items-center gap-1.5 py-2 px-3.5 text-xs shadow-xs"
                onClick={copyLink}
              >
                <span>{copied ? "✓" : "📋"}</span>
                <span>{copied ? t.copied : t.copy_link}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Live Metric Cards Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          <div className="card p-4 bg-white dark:bg-[#12142B] border border-[#E1E1DC] dark:border-[#2A2E52]">
            <div className="text-[11px] text-gray-500 font-medium mb-1">Total Joined</div>
            <div className="font-display text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100">
              {results.totalParticipants}
            </div>
            <div className="text-[11px] text-gray-400">students connected</div>
          </div>

          <div className="card p-4 bg-white dark:bg-[#12142B] border border-emerald-500/30">
            <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium mb-1 flex items-center gap-1">
              <span>✓</span> Completed Quiz
            </div>
            <div className="font-display text-2xl sm:text-3xl font-bold text-emerald-600 dark:text-emerald-400">
              {completedCount}
            </div>
            <div className="text-[11px] text-gray-400">done with quiz</div>
          </div>

          <div className="card p-4 bg-white dark:bg-[#12142B] border border-amber-500/30">
            <div className="text-[11px] text-amber-600 dark:text-amber-400 font-medium mb-1 flex items-center gap-1">
              <span>⏳</span> In Progress
            </div>
            <div className="font-display text-2xl sm:text-3xl font-bold text-amber-600 dark:text-amber-400">
              {pendingCount}
            </div>
            <div className="text-[11px] text-gray-400">currently attempting</div>
          </div>

          <div className="card p-4 bg-white dark:bg-[#12142B] border border-primary/30">
            <div className="text-[11px] text-primary font-medium mb-1 flex items-center gap-1">
              <span>📊</span> Avg Score
            </div>
            <div className="font-display text-2xl sm:text-3xl font-bold text-primary">
              {completedCount > 0 ? `${avgScore}%` : "—"}
            </div>
            <div className="text-[11px] text-gray-400">from completed quizzes</div>
          </div>
        </div>

        {/* Live Student Roster Section */}
        <div className="card p-6 bg-white dark:bg-[#12142B] border border-[#E1E1DC] dark:border-[#2A2E52] shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-4 border-b border-[#E1E1DC] dark:border-[#2A2E52]">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-display text-lg font-bold">Students & Participants</h2>
                <span className="text-[11px] text-gray-400 font-mono bg-[#F0F0EB] dark:bg-[#1B1E3F] px-2 py-0.5 rounded-full">
                  Auto-syncing
                </span>
              </div>
              <p className="text-xs text-gray-500">
                Track which participants are done with the quiz and view their scores
              </p>
            </div>

            {/* Filter Tabs & Search */}
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                placeholder="Search student..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="field text-xs py-1.5 px-3 w-40 sm:w-48"
              />

              <div className="flex items-center bg-[#F0F0EB] dark:bg-[#1B1E3F] p-1 rounded-lg text-xs">
                <button
                  type="button"
                  onClick={() => setFilter("all")}
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                    filter === "all" ? "bg-white dark:bg-[#2A2E52] shadow-xs text-primary" : "text-gray-500"
                  }`}
                >
                  All ({allStudents.length})
                </button>
                <button
                  type="button"
                  onClick={() => setFilter("done")}
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                    filter === "done" ? "bg-white dark:bg-[#2A2E52] shadow-xs text-emerald-600" : "text-gray-500"
                  }`}
                >
                  Done ({completedCount})
                </button>
                <button
                  type="button"
                  onClick={() => setFilter("pending")}
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                    filter === "pending" ? "bg-white dark:bg-[#2A2E52] shadow-xs text-amber-600" : "text-gray-500"
                  }`}
                >
                  Attempting ({pendingCount})
                </button>
              </div>
            </div>
          </div>

          {/* Student List */}
          {allStudents.length === 0 ? (
            <div className="py-12 text-center">
              <div className="text-3xl mb-2">👥</div>
              <div className="text-sm font-semibold mb-1">No participants yet</div>
              <p className="text-xs text-gray-400 max-w-sm mx-auto">
                Share the join code <span className="font-mono font-bold text-primary">{results.activity.linkId}</span> with your students so they can join and attempt the quiz.
              </p>
            </div>
          ) : filteredStudents.length === 0 ? (
            <div className="py-8 text-center text-xs text-gray-400">
              No students match the selected filter.
            </div>
          ) : (
            <div className="space-y-3">
              {filteredStudents.map((student) => {
                return (
                  <div
                    key={student.participantId}
                    className={`rounded-xl border transition-all ${
                      student.isDone
                        ? "border-emerald-500/30 bg-emerald-500/[0.01]"
                        : "border-[#E1E1DC] dark:border-[#2A2E52] bg-white dark:bg-[#1B1E3F]/20"
                    }`}
                  >
                    <div className="p-3.5 flex flex-wrap items-center justify-between gap-3">
                      {/* Student Info */}
                      <div className="flex items-center gap-3 min-w-[180px]">
                        <div
                          className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs uppercase ${
                            student.isDone
                              ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                              : "bg-amber-500/20 text-amber-600 dark:text-amber-400"
                          }`}
                        >
                          {student.displayName?.slice(0, 2) || "ST"}
                        </div>

                        <div>
                          <div className="text-sm font-bold text-gray-900 dark:text-gray-100 flex items-center gap-1.5">
                            <span>{student.displayName}</span>
                            {student.isDone && (
                              <span className="text-emerald-600 text-xs" title="Submitted Quiz">
                                ✓
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-gray-400">
                            Joined {new Date(student.joinedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            {student.submittedAt && (
                              <span>
                                {" "}• Submitted {new Date(student.submittedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Status & Marks */}
                      <div className="flex items-center gap-2.5">
                        {student.isDone ? (
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/30 flex items-center gap-1">
                              <span>✓</span> Done
                            </span>

                            {/* Direct Marks Display: e.g. 4 / 5 Marks (80%) */}
                            <div className="px-3 py-1 rounded-xl bg-primary/10 border border-primary/25 text-primary text-xs font-bold flex items-center gap-1.5 shadow-xs">
                              <span className="font-mono text-sm font-extrabold text-primary">
                                {student.score ? student.score.correct : 0} / {student.score?.total || results.activity?.questions?.length || 0} Marks
                              </span>
                              <span className="text-[11px] font-semibold text-primary/80">
                                ({student.score?.percentage ?? Math.round(((student.score?.correct || 0) / (results.activity?.questions?.length || 1)) * 100)}%)
                              </span>
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-600 border border-amber-500/30 flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                            Attempting
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
