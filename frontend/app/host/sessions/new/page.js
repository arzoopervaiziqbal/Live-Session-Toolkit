"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Navbar from "../../../../components/Navbar";
import { useLang } from "../../../../contexts/LangContext";
import { useAuthGuard } from "../../../../lib/useAuthGuard";
import { api } from "../../../../lib/api";

export default function NewSessionPage() {
  const { t } = useLang();
  const { user, logout, ready } = useAuthGuard("host", "/host/login");
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 16));
  const [allowQa, setAllowQa] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  if (!ready) return null;

  async function handleStartSession(e) {
    e?.preventDefault();
    if (!title.trim()) {
      setError("Please give the session a name.");
      return;
    }
    setError("");
    setStarting(true);
    try {
      const { session } = await api.createSession({
        title: title.trim(),
        description: description.trim(),
        date,
      });

      // Pure Live Session with 0 questions!
      const { activity } = await api.createActivity(session._id, {
        title: session.title,
        type: "qa",
        difficulty: "medium",
        allowQa,
        questions: [],
      });

      // Automatically publish session so participants can join immediately
      await api.publishActivity(activity._id);
      router.push(`/host/sessions/${session._id}/live?activity=${activity._id}`);
    } catch (err) {
      setError(err.body?.errors?.title || err.message || "Failed to start live session.");
      setStarting(false);
    }
  }

  return (
    <main className="min-h-screen">
      <Navbar userName={user?.name} onLogout={logout} logoutLabel={t.logout_btn} />

      <div className="max-w-xl mx-auto px-6 py-8">
        <div className="mb-6">
          <Link
            href="/host/dashboard"
            className="text-xs text-gray-500 hover:text-primary transition-colors flex items-center gap-1 mb-3"
          >
            ← Back to Dashboard
          </Link>
          <div className="flex items-center gap-2 mb-1">
            <span className="w-3 h-3 rounded-full bg-rose-500 animate-pulse" />
            <h1 className="font-display text-2xl font-bold text-gray-900 dark:text-gray-100">
              Create Session
            </h1>
          </div>
          <p className="text-xs text-gray-500">
            Launch an instant live session with screen sharing and real-time student Q&A. No quiz or test questions required.
          </p>
        </div>

        <form onSubmit={handleStartSession} className="card p-6 shadow-sm border border-[#E1E1DC] dark:border-[#2A2E52] space-y-4">
          <div>
            <label className="label">Session Name *</label>
            <input
              className="field"
              placeholder="e.g. Live Class, Team Meeting, Workshop"
              value={title}
              autoFocus
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div>
            <label className="label">Description (Optional)</label>
            <textarea
              className="field"
              rows={3}
              placeholder="Brief agenda or session topic..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div>
            <label className="label">Date & Time</label>
            <input
              type="datetime-local"
              className="field text-xs"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          <div>
            <label className="label">Live Participant Q&A</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setAllowQa(true)}
                className={`p-3 rounded-xl border text-left text-xs transition-all cursor-pointer ${
                  allowQa
                    ? "border-emerald-500 bg-emerald-500/10 font-bold text-emerald-600 ring-1 ring-emerald-500/30"
                    : "border-[#E1E1DC] dark:border-[#2A2E52] text-gray-400 opacity-75 hover:opacity-100"
                }`}
              >
                <div className="flex items-center gap-1.5 font-bold">
                  <span>✓</span> Q&A Enabled
                </div>
                <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">
                  Students can ask questions in real-time
                </div>
              </button>

              <button
                type="button"
                onClick={() => setAllowQa(false)}
                className={`p-3 rounded-xl border text-left text-xs transition-all cursor-pointer ${
                  !allowQa
                    ? "border-primary bg-primary/10 font-bold text-primary ring-1 ring-primary/30"
                    : "border-[#E1E1DC] dark:border-[#2A2E52] text-gray-400 opacity-75 hover:opacity-100"
                }`}
              >
                <div className="flex items-center gap-1.5 font-bold">
                  <span>✕</span> Q&A Disabled
                </div>
                <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">
                  Presentation & screen sharing only
                </div>
              </button>
            </div>
          </div>

          {error && <div className="error-text text-xs" role="alert">{error}</div>}

          <div className="pt-2 flex items-center justify-between gap-3">
            <Link
              href="/host/dashboard"
              className="btn-secondary text-xs py-2.5 px-4 cursor-pointer"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={starting}
              className="btn-primary text-xs sm:text-sm py-2.5 px-5 font-bold bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-700 hover:to-red-700 text-white border-0 shadow-sm cursor-pointer flex-1"
            >
              {starting ? "Starting Live Session…" : "🔴 Start Live Session Now 🚀"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
