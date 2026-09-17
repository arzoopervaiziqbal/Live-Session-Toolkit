"use client";
import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Navbar from "../../../../../components/Navbar";
import { ResultChart, Spinner, StatusPill } from "../../../../../components/LiveWidgets";
import { useAuthGuard } from "../../../../../lib/useAuthGuard";
import { api, downloadReport, downloadPdf, downloadExcel, downloadWord } from "../../../../../lib/api";

function Stat({ label, value, sub, accent }) {
  return (
    <div className="card p-4 relative overflow-hidden">
      {accent && (
        <div className="absolute top-0 left-0 right-0 h-1 rounded-t-xl" style={{ background: accent }} />
      )}
      <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1.5 mt-1">{label}</div>
      <div className="font-display text-2xl font-bold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function RankBadge({ rank }) {
  if (rank === 1) return <span className="text-lg">🥇</span>;
  if (rank === 2) return <span className="text-lg">🥈</span>;
  if (rank === 3) return <span className="text-lg">🥉</span>;
  return <span className="font-display font-bold text-gray-400 text-sm">#{rank}</span>;
}

export default function ReportPage() {
  const router = useRouter();
  const { id } = useParams();
  const { user, logout, ready } = useAuthGuard();

  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [exporting, setExporting] = useState(null); // null | 'pdf' | 'excel' | 'word' | 'csv'
  const [tab, setTab] = useState("scores");

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await api.getReport(id);
        if (!cancelled) setReport(data.report);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ready, id]);

  async function doExport(format) {
    setExporting(format);
    setError(null);
    try {
      const title = report.session.title;
      if (format === "pdf")   await downloadPdf(id, title);
      else if (format === "excel") await downloadExcel(id, title);
      else if (format === "word")  await downloadWord(id, title);
      else await downloadReport(id, title, format);
    } catch (err) {
      setError(err.message);
    } finally {
      setExporting(null);
    }
  }

  if (!ready) return null;

  const tabs = [
    ["scores", "🏆 Scoreboard"],
    ["questions", "📋 Questions"],
    ["polls", "📣 Polls"],
    ["qa", "💬 Q&A"],
  ];

  const highestScore = report?.scoreboard?.[0]?.score ?? 0;

  return (
    <main className="min-h-screen">
      <Navbar userName={user?.name} onLogout={logout} />

      <div className="max-w-5xl mx-auto px-5 py-8">
        <button className="text-xs text-gray-500 hover:text-primary mb-4 flex items-center gap-1" onClick={() => router.push("/host/dashboard")}>
          ← All sessions
        </button>

        {loading ? (
          <Spinner label="Building report..." />
        ) : !report ? (
          <div className="form-error">{error || "Report not available."}</div>
        ) : (
          <>
            {/* ---- header ---- */}
            <div className="flex justify-between items-start gap-4 mb-6 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2.5 mb-1 flex-wrap">
                  <h1 className="font-display text-2xl font-bold truncate">{report.session.title}</h1>
                  <StatusPill status={report.session.status} />
                </div>
                <div className="text-sm text-gray-500">
                  Code <span className="font-mono tracking-wider">{report.session.sessionCode}</span>
                  {report.session.endedAt && ` · ended ${new Date(report.session.endedAt).toLocaleString()}`}
                </div>
              </div>

              {/* ---- Export buttons ---- */}
              <div className="flex gap-2 shrink-0 flex-wrap">
                <button
                  disabled={!!exporting}
                  onClick={() => doExport("pdf")}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-red-600 hover:bg-red-700 text-white transition-colors disabled:opacity-60 shadow-sm"
                >
                  {exporting === "pdf" ? (
                    <span className="w-3.5 h-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
                  ) : "📄"}
                  PDF
                </button>
                <button
                  disabled={!!exporting}
                  onClick={() => doExport("excel")}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors disabled:opacity-60 shadow-sm"
                >
                  {exporting === "excel" ? (
                    <span className="w-3.5 h-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
                  ) : "📊"}
                  Excel
                </button>
                <button
                  disabled={!!exporting}
                  onClick={() => doExport("word")}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-60 shadow-sm"
                >
                  {exporting === "word" ? (
                    <span className="w-3.5 h-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
                  ) : "📝"}
                  Word
                </button>
                <button
                  disabled={!!exporting}
                  onClick={() => doExport("csv")}
                  className="btn-secondary text-sm"
                >
                  CSV
                </button>
              </div>
            </div>

            {error && <div className="form-error mb-4">{error}</div>}

            {/* ---- headline stats ---- */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <Stat label="Participants" value={report.summary.participants} accent="#6C63FF" />
              <Stat
                label="Avg score"
                value={report.summary.averageScore}
                sub={`out of ${report.summary.totalPossible}`}
                accent="#10B981"
              />
              <Stat label="Avg accuracy" value={`${report.summary.averageAccuracy}%`} accent="#F59E0B" />
              <Stat
                label="Highest score"
                value={highestScore}
                sub={report.scoreboard[0] ? `by ${report.scoreboard[0].name}` : undefined}
                accent="#EF4444"
              />
            </div>

            {report.summary.hardestQuestion && (
              <div className="card p-4 mb-6 border-amber-400/50 bg-amber-50/40 dark:bg-amber-950/10">
                <div className="text-[11px] uppercase tracking-wide text-amber-600 dark:text-amber-400 mb-1 font-semibold">
                  🔥 Hardest Question
                </div>
                <div className="text-sm mb-0.5">{report.summary.hardestQuestion.question}</div>
                <div className="text-xs text-amber-600 dark:text-amber-400">
                  Only {report.summary.hardestQuestion.correctRate}% got it right
                </div>
              </div>
            )}

            {/* ---- tabs ---- */}
            <div className="flex gap-1 p-1 bg-[#F5F5F2] dark:bg-[#0E1020] rounded-lg border border-[#E1E1DC] dark:border-[#2A2E52] mb-5 overflow-x-auto">
              {tabs.map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`flex-1 whitespace-nowrap text-xs py-2 px-3 rounded-md transition-colors ${
                    tab === key ? "bg-primary text-white" : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* ---- scoreboard ---- */}
            {tab === "scores" &&
              (!report.scoreboard.length ? (
                <div className="card p-8 text-center text-sm text-gray-500">Nobody joined this session.</div>
              ) : (
                <div className="card overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[#E1E1DC] dark:border-[#2A2E52] text-xs text-gray-500 bg-[#F9FAFB] dark:bg-[#0E1020]">
                        <th className="text-center px-4 py-3 font-medium w-14">Rank</th>
                        <th className="text-left px-4 py-3 font-medium">Name</th>
                        <th className="text-right px-4 py-3 font-medium">Score</th>
                        <th className="text-right px-4 py-3 font-medium">%</th>
                        <th className="text-right px-4 py-3 font-medium">Correct</th>
                        <th className="text-right px-4 py-3 font-medium">Accuracy</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.scoreboard.map((p) => (
                        <tr
                          key={p.participantId}
                          className={`border-b border-[#E1E1DC] dark:border-[#2A2E52] last:border-0 ${
                            p.rank <= 3 ? "bg-primary/[0.03]" : ""
                          }`}
                        >
                          <td className="px-4 py-3 text-center">
                            <RankBadge rank={p.rank} />
                          </td>
                          <td className="px-4 py-3 font-medium truncate max-w-[200px]">{p.name}</td>
                          <td className="px-4 py-3 text-right tabular-nums font-bold">
                            {p.score}
                            <span className="text-gray-400 font-normal text-xs"> / {p.totalPossible}</span>
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            <span className={`font-semibold ${p.percentage >= 80 ? "text-live" : p.percentage >= 50 ? "text-amber-500" : "text-red-500"}`}>
                              {p.percentage}%
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-gray-500">
                            {p.correct} / {p.attempted}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">{p.accuracy}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}

            {/* ---- question breakdown ---- */}
            {tab === "questions" &&
              (!report.questionBreakdown.length ? (
                <div className="card p-8 text-center text-sm text-gray-500">No quiz questions were run.</div>
              ) : (
                <div className="grid gap-3">
                  {report.questionBreakdown.map((qb) => (
                    <div key={qb.activityId} className="card p-4">
                      <div className="flex justify-between items-start gap-3 mb-3 flex-wrap">
                        <div className="min-w-0 flex-1">
                          <div className="font-display font-semibold text-sm mb-1">
                            {qb.number}. {qb.question}
                          </div>
                          <div className="flex gap-2 text-[11px] text-gray-500 flex-wrap">
                            <span className="capitalize">{qb.difficulty}</span>
                            <span>{qb.responses} responses</span>
                            {qb.averageResponseMs && <span>avg {(qb.averageResponseMs / 1000).toFixed(1)}s</span>}
                            {qb.correctAnswer && (
                              <span className="text-live font-medium">✓ {qb.correctAnswer}</span>
                            )}
                          </div>
                        </div>
                        <span
                          className={`chip shrink-0 font-semibold ${
                            qb.correctRate >= 70
                              ? "border-live/40 text-live"
                              : qb.correctRate >= 40
                              ? "border-amber-400 text-amber-600 dark:text-amber-400"
                              : "border-red-300 text-red-500"
                          }`}
                        >
                          {qb.correctRate}% correct
                        </span>
                      </div>
                      <ResultChart tally={{ total: qb.responses, results: qb.distribution }} revealCorrect compact />
                    </div>
                  ))}
                </div>
              ))}

            {/* ---- polls ---- */}
            {tab === "polls" &&
              (!report.pollSummary.length ? (
                <div className="card p-8 text-center text-sm text-gray-500">No polls were run.</div>
              ) : (
                <div className="grid gap-3">
                  {report.pollSummary.map((poll) => (
                    <div key={poll.activityId} className="card p-4">
                      <div className="font-display font-semibold text-sm mb-3">
                        {poll.number}. {poll.question}
                      </div>
                      <div className="text-xs text-gray-500 mb-2">{poll.votes} votes</div>
                      <ResultChart tally={{ total: poll.votes, results: poll.results }} compact />
                    </div>
                  ))}
                </div>
              ))}

            {/* ---- Q&A transcript ---- */}
            {tab === "qa" &&
              (!report.transcript.length ? (
                <div className="card p-8 text-center text-sm text-gray-500">No questions or comments were posted.</div>
              ) : (
                <div className="grid gap-2">
                  {report.transcript.map((item) => (
                    <div key={item.id} className={`card p-3 ${item.isHighlighted ? "border-live" : ""}`}>
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-xs font-semibold">{item.name}</span>
                        <span className="text-[11px] text-gray-400">
                          {new Date(item.createdAt).toLocaleString()}
                        </span>
                        {item.isHighlighted && (
                          <span className="text-[10px] uppercase tracking-wide text-live font-semibold">pinned</span>
                        )}
                        {item.isAnswered && (
                          <span className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">answered</span>
                        )}
                      </div>
                      <div className="text-sm">{item.text}</div>
                    </div>
                  ))}
                </div>
              ))}
          </>
        )}
      </div>
    </main>
  );
}
