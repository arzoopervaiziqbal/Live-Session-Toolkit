"use client";
import { useEffect, useState } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import Navbar from "../../../../../components/Navbar";
import { useLang } from "../../../../../contexts/LangContext";
import { useAuthGuard } from "../../../../../lib/useAuthGuard";
import { api } from "../../../../../lib/api";

export default function ReviewPage() {
  const { t, langLabel } = useLang();
  const { user, logout, ready } = useAuthGuard("host", "/host/login");
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();

  const [session, setSession] = useState(null);
  const [activity, setActivity] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sessionDraft, setSessionDraft] = useState({ title: "", description: "", date: "", status: "draft" });
  const [activityDraft, setActivityDraft] = useState({ title: "", difficulty: "medium", expiresAt: "", allowQa: false });
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState("");

  // Add more questions state
  const [showAddBox, setShowAddBox] = useState(false);
  const [addCount, setAddCount] = useState(3);
  const [addNotesPrompt, setAddNotesPrompt] = useState("");
  const [isGeneratingMore, setIsGeneratingMore] = useState(false);
  const [isAddingBlank, setIsAddingBlank] = useState(false);
  const [addError, setAddError] = useState("");

  // Delete session state
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deletingSession, setDeletingSession] = useState(false);

  const activityIdFromQuery = searchParams.get("activity");

  useEffect(() => {
    if (!ready) return;
    api.getSession(params.id).then((data) => {
      setSession(data.session);
      setSessionDraft({
        title: data.session.title || "",
        description: data.session.description || "",
        date: data.session.date ? new Date(data.session.date).toISOString().slice(0, 16) : "",
        status: data.session.status || "draft",
      });
      const chosen =
        data.activities.find((a) => a._id === activityIdFromQuery) || data.activities[0] || null;
      setActivity(chosen);
      if (chosen) {
        setActivityDraft({
          title: chosen.title || "",
          difficulty: chosen.difficulty || "medium",
          expiresAt: chosen.expiresAt ? new Date(chosen.expiresAt).toISOString().slice(0, 16) : "",
          allowQa: Boolean(chosen.allowQa),
        });
        if (chosen.sourceNotesText) {
          setAddNotesPrompt(chosen.sourceNotesText);
        }
      }
      setLoading(false);
    });
  }, [ready, params.id, activityIdFromQuery]);

  if (!ready || loading) return null;
  if (!activity) return <div className="p-8 text-sm text-gray-500">No activity found for this session.</div>;

  function updateLocalQuestion(qId, patch) {
    setActivity((prev) => ({
      ...prev,
      questions: prev.questions.map((q) => (q.questionId === qId ? { ...q, ...patch } : q)),
    }));
  }

  async function saveQuestion(qId) {
    const q = activity.questions.find((qq) => qq.questionId === qId);
    if (!q) return;
    await api.updateQuestion(activity._id, qId, {
      questionText: q.questionText,
      options: q.options,
      correctAnswer: q.correctAnswer,
    });
  }

  async function removeQuestion(qId) {
    const data = await api.removeQuestion(activity._id, qId);
    setActivity(data.activity);
  }

  async function handleAddBlank() {
    setIsAddingBlank(true);
    setAddError("");
    try {
      const data = await api.addQuestion(activity._id, addCount);
      setActivity(data.activity);
      setShowAddBox(false);
    } catch (err) {
      setAddError(err.message || "Failed to add questions.");
    } finally {
      setIsAddingBlank(false);
    }
  }

  async function handleGenerateMore() {
    setIsGeneratingMore(true);
    setAddError("");
    try {
      const data = await api.generateQuestions(
        activity._id,
        langLabel || "English",
        addCount,
        true, // append mode
        addNotesPrompt
      );
      setActivity(data.activity);
      setShowAddBox(false);
    } catch (err) {
      setAddError(err.message || "Failed to generate questions. Please ensure notes/topic are provided.");
    } finally {
      setIsGeneratingMore(false);
    }
  }

  async function publish() {
    await api.publishActivity(activity._id);
    router.push(`/host/sessions/${session._id}/live?activity=${activity._id}`);
  }

  async function saveSettings() {
    setSavingSettings(true);
    setSettingsMessage("");
    try {
      const [sessionData, activityData] = await Promise.all([
        api.updateSession(session._id, sessionDraft),
        api.updateActivity(activity._id, activityDraft),
      ]);
      setSession(sessionData.session);
      setActivity(activityData.activity);
      setSettingsMessage("Changes saved.");
    } catch (err) {
      setSettingsMessage(err.body?.errors?.title || err.body?.error || "Could not save changes.");
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleDeleteSession() {
    setDeletingSession(true);
    try {
      await api.deleteSession(session._id);
      router.push("/host/dashboard");
    } catch (err) {
      setSettingsMessage(err.message || "Failed to delete session.");
      setDeletingSession(false);
      setConfirmDelete(false);
    }
  }

  return (
    <main className="min-h-screen">
      <Navbar user={user} userName={user?.name} userEmail={user?.email} onLogout={logout} logoutLabel={t.logout_btn} />

      <div className="max-w-2xl mx-auto px-6 py-8">
        <div className="flex justify-between items-start mb-2">
          <div>
            <h1 className="font-display text-xl font-bold mb-1">{t.review_title}</h1>
            <div className="text-xs text-gray-500">
              {activity.type} · {activity.difficulty} · {activity.questions?.length || 0} questions
            </div>
          </div>
          <div className="flex items-center gap-2">
            {activity.allowQa && (
              <span className="text-xs bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 px-2.5 py-1 rounded-md font-semibold">
                ✓ Q&A Allowed
              </span>
            )}
            {activity.linkId && (
              <span className="text-xs bg-primary/10 border border-primary/20 text-primary px-2.5 py-1 rounded-md font-mono font-bold">
                Code: {activity.linkId}
              </span>
            )}
            <span className={`text-xs px-2.5 py-1 rounded-full font-mono uppercase font-semibold ${
              session?.status === "active" ? "text-live bg-live/10" :
              session?.status === "closed" ? "text-gray-400 bg-gray-400/10" : "text-amber-500 bg-amber-500/10"
            }`}>
              {session?.status || "DRAFT"}
            </span>
          </div>
        </div>

        <section className="card p-4 mb-6">
          <div className="font-display font-semibold text-sm mb-4 flex justify-between items-center">
            <span>Session & Quiz Settings</span>
            <span className="text-xs text-gray-400 font-normal">Manage all session properties</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="sm:col-span-2">
              <span className="label">Session name</span>
              <input className="field" value={sessionDraft.title} onChange={(e) => setSessionDraft({ ...sessionDraft, title: e.target.value })} />
            </label>
            <label className="sm:col-span-2">
              <span className="label">Description</span>
              <textarea className="field" rows={2} value={sessionDraft.description} onChange={(e) => setSessionDraft({ ...sessionDraft, description: e.target.value })} />
            </label>
            <label>
              <span className="label">Session date</span>
              <input type="datetime-local" className="field" value={sessionDraft.date} onChange={(e) => setSessionDraft({ ...sessionDraft, date: e.target.value })} />
            </label>
            <label>
              <span className="label">Session Status</span>
              <select className="field" value={sessionDraft.status} onChange={(e) => setSessionDraft({ ...sessionDraft, status: e.target.value })}>
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="closed">Closed</option>
              </select>
            </label>
            <label>
              <span className="label">Activity name</span>
              <input className="field" value={activityDraft.title} onChange={(e) => setActivityDraft({ ...activityDraft, title: e.target.value })} />
            </label>
            <label>
              <span className="label">Difficulty</span>
              <select className="field" value={activityDraft.difficulty} onChange={(e) => setActivityDraft({ ...activityDraft, difficulty: e.target.value })}>
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </label>
            <label className="sm:col-span-2">
              <span className="label">Live Q&A Option</span>
              <select
                className="field"
                value={activityDraft.allowQa ? "true" : "false"}
                onChange={(e) => setActivityDraft({ ...activityDraft, allowQa: e.target.value === "true" })}
              >
                <option value="false">✕ Q&A Not Allowed (Quiz / Poll only)</option>
                <option value="true">✓ Q&A Allowed (Participants can ask questions live)</option>
              </select>
            </label>
            <label className="sm:col-span-2">
              <span className="label">Activity closes</span>
              <input type="datetime-local" className="field" value={activityDraft.expiresAt} onChange={(e) => setActivityDraft({ ...activityDraft, expiresAt: e.target.value })} />
            </label>
          </div>
          <div className="flex items-center justify-between mt-4 pt-3 border-t border-[#E1E1DC] dark:border-[#2A2E52]">
            <div className="flex items-center gap-3">
              <button className="btn-primary" onClick={saveSettings} disabled={savingSettings}>
                {savingSettings ? "Saving..." : "Save settings"}
              </button>
              {settingsMessage && <span className="text-xs text-gray-500" role="status">{settingsMessage}</span>}
            </div>

            {confirmDelete ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="btn-secondary text-xs text-red-600 font-semibold"
                  onClick={handleDeleteSession}
                  disabled={deletingSession}
                >
                  {deletingSession ? "Deleting…" : "Yes, Delete Session"}
                </button>
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  onClick={() => setConfirmDelete(false)}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="text-xs text-red-500 hover:underline"
                onClick={() => setConfirmDelete(true)}
              >
                Delete session
              </button>
            )}
          </div>
        </section>

        {activity.questions.map((q, idx) => (
          <div key={q.questionId} className="card p-4 mb-3">
            <div className="flex gap-3 items-start mb-3">
              <div className="font-mono text-[11px] text-gray-400 pt-2.5">{String(idx + 1).padStart(2, "0")}</div>
              <textarea
                className="field flex-1"
                rows={2}
                value={q.questionText}
                placeholder="Question text..."
                onChange={(e) => updateLocalQuestion(q.questionId, { questionText: e.target.value })}
                onBlur={() => saveQuestion(q.questionId)}
              />
              <button className="btn-secondary text-red-500" title="Delete question" onClick={() => removeQuestion(q.questionId)}>
                ✕
              </button>
            </div>

            {(q.type === "mcq" || q.type === "poll") && (
              <div className="grid grid-cols-2 gap-2 mb-3">
                {q.options.map((opt, oi) => (
                  <input
                    key={oi}
                    className="field text-xs"
                    value={opt}
                    placeholder={`Option ${oi + 1}`}
                    onChange={(e) => {
                      const options = [...q.options];
                      options[oi] = e.target.value;
                      updateLocalQuestion(q.questionId, { options });
                    }}
                    onBlur={() => saveQuestion(q.questionId)}
                  />
                ))}
              </div>
            )}

            {(q.type === "mcq" || q.type === "poll") && (
              <div>
                <label className="label">Correct answer</label>
                <select
                  className="field text-xs"
                  value={q.correctAnswer || (q.options && q.options[0]) || ""}
                  onChange={(e) => {
                    updateLocalQuestion(q.questionId, { correctAnswer: e.target.value });
                    setTimeout(() => saveQuestion(q.questionId), 0);
                  }}
                >
                  <option value="" disabled>
                    — Select correct answer —
                  </option>
                  {q.options.map((opt, oi) => (
                    <option key={oi} value={opt}>
                      {opt || `Option ${oi + 1}`}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        ))}

        {/* Dynamic Add Questions Box */}
        {showAddBox ? (
          <div className="card p-5 mb-6 border-primary/40 bg-primary/5">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-display font-semibold text-sm">Add More Questions</h3>
              <button
                type="button"
                className="text-xs text-gray-400 hover:text-gray-600"
                onClick={() => { setShowAddBox(false); setAddError(""); }}
              >
                ✕ Close
              </button>
            </div>

            <div className="mb-4">
              <label className="label">How many questions to add?</label>
              <div className="flex items-center gap-2">
                {[1, 2, 3, 5, 10].map((num) => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => setAddCount(num)}
                    className={`px-3 py-1.5 rounded-lg border text-xs font-mono font-medium transition-colors ${
                      addCount === num
                        ? "border-primary bg-primary text-white"
                        : "border-[#E1E1DC] dark:border-[#2A2E52] hover:border-primary"
                    }`}
                  >
                    +{num}
                  </button>
                ))}
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={addCount}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    if (Number.isFinite(n)) setAddCount(Math.min(20, Math.max(1, n)));
                  }}
                  className="field w-16 text-center py-1 text-xs font-mono"
                />
              </div>
            </div>

            <div className="mb-4">
              <label className="label">
                Topic or Notes for AI generation <span className="text-gray-400 font-normal">(optional if notes already exist)</span>
              </label>
              <textarea
                className="field text-xs"
                rows={3}
                placeholder="Enter lecture notes, topics, or instructions for the new questions..."
                value={addNotesPrompt}
                onChange={(e) => setAddNotesPrompt(e.target.value)}
              />
            </div>

            {addError && <div className="error-text mb-3">{addError}</div>}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-primary flex-1 min-w-[160px]"
                onClick={handleGenerateMore}
                disabled={isGeneratingMore || isAddingBlank}
              >
                {isGeneratingMore ? `Generating ${addCount} questions with AI…` : `✨ Generate ${addCount} with AI`}
              </button>
              <button
                type="button"
                className="btn-secondary flex-1 min-w-[160px]"
                onClick={handleAddBlank}
                disabled={isGeneratingMore || isAddingBlank}
              >
                {isAddingBlank ? `Adding ${addCount}…` : `➕ Add ${addCount} Blank Template${addCount > 1 ? "s" : ""}`}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="btn-secondary w-full border-dashed py-3 mb-6 flex items-center justify-center gap-2 hover:border-primary hover:text-primary transition-colors"
            onClick={() => setShowAddBox(true)}
          >
            <span className="text-base font-bold">+</span>
            <span className="font-semibold">Add more questions (choose count & generate)</span>
          </button>
        )}

        <div className="flex gap-3">
          <button className="btn-secondary" onClick={() => router.push("/host/dashboard")}>
            {t.back_btn}
          </button>
          <button className="bg-live text-white px-4 py-2.5 rounded-lg text-sm font-semibold" onClick={publish}>
            {t.publish_btn}
          </button>
        </div>
      </div>
    </main>
  );
}

