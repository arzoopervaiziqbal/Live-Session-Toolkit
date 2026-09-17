"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Navbar from "../../../components/Navbar";
import { Spinner, StatusPill } from "../../../components/LiveWidgets";
import { useAuthGuard } from "../../../lib/useAuthGuard";
import { api } from "../../../lib/api";

export default function DashboardPage() {
  const router = useRouter();
  const { user, logout, ready } = useAuthGuard();

  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    (async () => {
      try {
        const data = await api.listSessions();
        if (!cancelled) setSessions(data.sessions);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ready]);

  async function remove(session) {
    if (!confirm(`Delete "${session.title}"? Every response, poll, and question in it goes too.`)) return;
    setDeletingId(session.id);
    try {
      await api.deleteSession(session.id);
      setSessions((list) => list.filter((s) => s.id !== session.id));
    } catch (err) {
      setError(err.message);
    } finally {
      setDeletingId(null);
    }
  }

  if (!ready) return null;

  return (
    <main className="min-h-screen">
      <Navbar userName={user?.name} onLogout={logout} />

      <div className="max-w-4xl mx-auto px-5 py-8">
        <div className="flex justify-between items-center mb-6 gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold">Your sessions</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Create a session, upload your material, and let the AI build the quiz.
            </p>
          </div>
          <button className="btn-primary shrink-0" onClick={() => router.push("/host/sessions/new")}>
            New session
          </button>
        </div>

        {error && <div className="form-error mb-4">{error}</div>}

        {loading ? (
          <Spinner label="Loading your sessions..." />
        ) : !sessions.length ? (
          <div className="card p-10 text-center">
            <div className="font-display font-semibold mb-1.5">Nothing here yet</div>
            <p className="text-sm text-gray-500 mb-5">
              Your first session takes about a minute: name it, paste your notes, generate.
            </p>
            <button className="btn-primary" onClick={() => router.push("/host/sessions/new")}>
              Create your first session
            </button>
          </div>
        ) : (
          <div className="grid gap-3">
            {sessions.map((s) => (
              <div key={s.id} className="card p-4">
                <div className="flex justify-between items-start gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2.5 mb-1 flex-wrap">
                      <span className="font-display font-semibold truncate">{s.title}</span>
                      <StatusPill status={s.status} />
                    </div>

                    <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
                      <span className="font-mono tracking-wider">{s.session_code}</span>
                      <span>{s.stats?.published || 0} published</span>
                      {s.stats?.drafts > 0 && (
                        <span className="text-amber-600 dark:text-amber-400">{s.stats.drafts} drafts to review</span>
                      )}
                      <span>{s.stats?.participants || 0} joined</span>
                      <span>{new Date(s.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>

                  <div className="flex gap-2 shrink-0 flex-wrap justify-end">
                    {s.status !== "ended" && (
                      <Link href={`/host/sessions/${s.id}/review`} className="btn-secondary">
                        Build
                      </Link>
                    )}
                    {s.status === "active" ? (
                      <Link href={`/host/sessions/${s.id}/live`} className="btn-live">
                        Go live
                      </Link>
                    ) : s.status === "ended" ? (
                      <Link href={`/host/sessions/${s.id}/report`} className="btn-primary">
                        Report
                      </Link>
                    ) : (
                      <Link href={`/host/sessions/${s.id}/live`} className="btn-primary">
                        Run
                      </Link>
                    )}
                    <button
                      className="btn-danger"
                      onClick={() => remove(s)}
                      disabled={deletingId === s.id}
                      title="Delete session"
                    >
                      {deletingId === s.id ? "..." : "✕"}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
