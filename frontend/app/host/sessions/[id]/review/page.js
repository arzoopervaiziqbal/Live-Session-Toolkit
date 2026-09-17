"use client";
import { useEffect, useState, useCallback } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import Navbar from "../../../../../components/Navbar";
import { Spinner, StatusPill } from "../../../../../components/LiveWidgets";
import { useAuthGuard } from "../../../../../lib/useAuthGuard";
import { api } from "../../../../../lib/api";

/**
 * One editable question card. Changes are held locally and saved explicitly —
 * autosaving every keystroke would fire a request per character and makes
 * "did that save?" ambiguous while the host is mid-edit.
 */
/**
 * One editable question card. Changes are held locally and can be explicitly
 * saved, validated, or published directly with clear answer key selection.
 */
function ActivityCard({ activity, onSave, onDelete, onUnpublish, onPublish, index }) {
  const [draft, setDraft] = useState(activity);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setDraft(activity);
    setDirty(false);
  }, [activity]);

  function patch(changes) {
    setDraft((d) => ({ ...d, ...changes }));
    setDirty(true);
    setError(null);
  }

  function setOption(i, value) {
    const options = [...draft.options];
    const previous = options[i];
    options[i] = value;

    // If the option being edited was the currently marked correct answer,
    // update correct_answer so it follows the edited text.
    let correct = draft.correct_answer;
    if (
      draft.correct_answer &&
      previous &&
      draft.correct_answer.trim().toLowerCase() === previous.trim().toLowerCase()
    ) {
      correct = value;
    }
    patch({ options, correct_answer: correct });
  }

  function addOption() {
    patch({ options: [...draft.options, ""] });
  }

  function removeOption(i) {
    const removed = draft.options[i];
    const newOptions = draft.options.filter((_, idx) => idx !== i);
    const wasCorrect =
      draft.correct_answer &&
      removed &&
      draft.correct_answer.trim().toLowerCase() === removed.trim().toLowerCase();

    patch({
      options: newOptions,
      correct_answer: wasCorrect ? null : draft.correct_answer,
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const validOptions = draft.options.map((o) => o.trim()).filter(Boolean);
      await onSave(draft.id, {
        question: draft.question.trim(),
        options: validOptions.length >= 2 ? validOptions : draft.options,
        correctAnswer: draft.type === "quiz" ? (draft.correct_answer ? draft.correct_answer.trim() : null) : null,
        timerSeconds: draft.timer_seconds,
        difficulty: draft.difficulty,
        type: draft.type,
      });
      setDirty(false);
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function publishThis() {
    setError(null);
    if (!draft.question.trim()) {
      setError("Please fill in the question text before publishing.");
      return;
    }
    const validOptions = draft.options.map((o) => o.trim()).filter(Boolean);
    if (validOptions.length < 2) {
      setError("Please provide at least 2 non-empty options.");
      return;
    }
    if (draft.type === "quiz") {
      if (!draft.correct_answer || !draft.correct_answer.trim()) {
        setError("Please select which option is the correct answer before publishing.");
        return;
      }
      const match = validOptions.find(
        (o) => o.toLowerCase() === draft.correct_answer.trim().toLowerCase()
      );
      if (!match) {
        setError("The correct answer must match one of the options.");
        return;
      }
    }

    setPublishing(true);
    try {
      await onSave(draft.id, {
        question: draft.question.trim(),
        options: validOptions,
        correctAnswer: draft.type === "quiz" ? draft.correct_answer.trim() : null,
        timerSeconds: draft.timer_seconds,
        difficulty: draft.difficulty,
        type: draft.type,
      });
      setDirty(false);
      if (onPublish) {
        await onPublish(draft.id);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setPublishing(false);
    }
  }

  const missingQuestion = !draft.question || !draft.question.trim();
  const validOptionsList = (draft.options || []).map((o) => o.trim()).filter(Boolean);
  const missingOptions = validOptionsList.length < 2;
  const isCorrectMatch =
    draft.type === "quiz" &&
    draft.correct_answer &&
    validOptionsList.some(
      (o) => o.toLowerCase() === draft.correct_answer.trim().toLowerCase()
    );
  const missingAnswer = draft.type === "quiz" && (!draft.correct_answer || !isCorrectMatch);
  const incomplete = missingQuestion || missingOptions || missingAnswer;

  return (
    <div
      className={`card p-5 transition-all ${
        incomplete
          ? "border-amber-400 dark:border-amber-700 bg-amber-500/[0.02]"
          : "border-gray-200 dark:border-gray-800"
      }`}
    >
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="font-display font-bold text-sm text-gray-400">#{index + 1}</span>
        <span className="chip chip-on capitalize">{draft.type}</span>
        {draft.ai_generated && <span className="chip">AI</span>}
        {activity.is_published ? (
          <span className="chip border-live/40 text-live font-medium">✓ published</span>
        ) : (
          <span className="chip text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-800 font-medium">
            draft
          </span>
        )}
        {incomplete && (
          <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">
            needs attention
          </span>
        )}

        <div className="ml-auto flex gap-1.5 items-center">
          {!activity.is_published && onPublish && (
            <button
              className="btn-primary !py-1 !px-3 text-xs flex items-center gap-1 shadow-sm"
              disabled={publishing || saving}
              onClick={publishThis}
            >
              {publishing ? "Publishing..." : "Publish"}
            </button>
          )}
          {activity.is_published && (
            <button
              className="btn-secondary !py-1 !px-2.5 text-xs"
              onClick={() => onUnpublish(draft.id)}
            >
              Unpublish
            </button>
          )}
          <button
            className="btn-danger !py-1 !px-2.5 text-xs"
            onClick={() => onDelete(draft.id)}
          >
            Delete
          </button>
        </div>
      </div>

      {incomplete && !activity.is_published && (
        <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 text-amber-800 dark:text-amber-300 rounded-lg p-2.5 text-xs mb-3">
          <div className="font-semibold mb-1 flex items-center gap-1">
            <span>⚠️ To publish this question, please complete:</span>
          </div>
          <ul className="list-disc list-inside space-y-0.5 ml-1">
            {missingQuestion && <li>Enter question text</li>}
            {missingOptions && (
              <li>Provide at least 2 non-empty options ({validOptionsList.length}/2 filled)</li>
            )}
            {missingAnswer && (
              <li>
                <strong>Select the correct answer</strong> by clicking &quot;Mark correct&quot; on an option or using the dropdown below
              </li>
            )}
          </ul>
        </div>
      )}

      <label className="label text-xs mb-1">Question</label>
      <textarea
        className="field resize-y min-h-[60px] mb-3 font-medium text-sm"
        value={draft.question}
        placeholder="Type the question..."
        onChange={(e) => patch({ question: e.target.value })}
      />

      <div className="mb-3">
        <label className="label text-xs mb-1.5 flex justify-between items-center">
          <span>Answer Options</span>
          {draft.type === "quiz" && (
            <span className="text-[11px] font-normal text-gray-500">
              Click &quot;Mark correct&quot; to pick the answer
            </span>
          )}
        </label>
        <div className="space-y-2">
          {draft.options.map((option, i) => {
            const isCorrect =
              draft.type === "quiz" &&
              draft.correct_answer &&
              option.trim() !== "" &&
              draft.correct_answer.trim().toLowerCase() === option.trim().toLowerCase();

            return (
              <div
                key={i}
                className={`flex items-center gap-2 p-1.5 rounded-lg border transition-all ${
                  isCorrect
                    ? "border-emerald-500 bg-emerald-50/70 dark:bg-emerald-950/30 dark:border-emerald-500/80 shadow-sm"
                    : "border-gray-200/80 dark:border-gray-800/80 hover:border-gray-300 dark:hover:border-gray-700"
                }`}
              >
                {draft.type === "quiz" && (
                  <button
                    type="button"
                    title={
                      isCorrect
                        ? "Currently marked as the correct answer"
                        : "Click to mark this option as correct"
                    }
                    onClick={() => {
                      if (!option.trim()) {
                        setError(`Please type option text for Option ${i + 1} before marking it as correct.`);
                        return;
                      }
                      patch({ correct_answer: option.trim() });
                    }}
                    className={`px-2.5 py-1 rounded-md text-xs font-semibold shrink-0 flex items-center gap-1.5 transition-all ${
                      isCorrect
                        ? "bg-emerald-600 text-white shadow-sm ring-2 ring-emerald-400/40"
                        : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 hover:border-emerald-500 hover:text-emerald-600"
                    }`}
                  >
                    <span
                      className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center text-[10px] ${
                        isCorrect
                          ? "bg-white text-emerald-600 border-white font-black"
                          : "border-gray-400 dark:border-gray-500"
                      }`}
                    >
                      {isCorrect ? "✓" : ""}
                    </span>
                    <span>{isCorrect ? "Correct" : "Mark correct"}</span>
                  </button>
                )}

                <input
                  className={`field flex-1 !py-1.5 text-sm ${
                    isCorrect ? "!border-emerald-500/70 font-medium" : ""
                  }`}
                  value={option}
                  placeholder={`Option ${i + 1}`}
                  onChange={(e) => setOption(i, e.target.value)}
                />

                {draft.options.length > 2 && (
                  <button
                    type="button"
                    title="Remove option"
                    className="text-gray-400 hover:text-red-500 text-sm px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-950/40 shrink-0 transition-colors"
                    onClick={() => removeOption(i)}
                  >
                    ✕
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {draft.options.length < 6 && (
          <button
            type="button"
            className="mt-2 text-xs text-primary hover:underline font-medium"
            onClick={addOption}
          >
            + Add option
          </button>
        )}

        {/* Dedicated dropdown selector for correct answer */}
        {draft.type === "quiz" && (
          <div
            className={`mt-3 p-2.5 rounded-lg border flex items-center justify-between gap-3 flex-wrap ${
              isCorrectMatch
                ? "bg-emerald-50/50 border-emerald-300 dark:bg-emerald-950/20 dark:border-emerald-800"
                : "bg-amber-50/50 border-amber-300 dark:bg-amber-950/20 dark:border-amber-800"
            }`}
          >
            <div className="flex items-center gap-2 flex-wrap">
              <label className="text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300">
                Correct Answer:
              </label>
              <select
                className="field !py-1 !px-2.5 text-sm font-medium w-auto min-w-[200px]"
                value={
                  isCorrectMatch
                    ? draft.options.find(
                        (o) =>
                          o.trim() &&
                          o.trim().toLowerCase() === draft.correct_answer?.trim().toLowerCase()
                      ) || ""
                    : ""
                }
                onChange={(e) => patch({ correct_answer: e.target.value })}
              >
                <option value="" disabled>
                  -- Select correct answer --
                </option>
                {draft.options.map((opt, idx) => {
                  const trimmed = opt.trim();
                  return (
                    <option key={idx} value={trimmed} disabled={!trimmed}>
                      {trimmed ? `Option ${idx + 1}: ${trimmed}` : `Option ${idx + 1} (empty)`}
                    </option>
                  );
                })}
              </select>
            </div>

            {isCorrectMatch ? (
              <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                ✓ Set to: &quot;{draft.correct_answer}&quot;
              </span>
            ) : (
              <span className="text-xs font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1">
                ⚠️ Answer key not set
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex gap-3 items-end flex-wrap pt-2 border-t border-gray-100 dark:border-gray-800">
        <div className="w-28">
          <label className="label">Timer (s)</label>
          <input
            type="number"
            min={5}
            max={600}
            className="field !py-1.5"
            value={draft.timer_seconds}
            onChange={(e) => patch({ timer_seconds: e.target.value })}
          />
        </div>

        {draft.type === "quiz" && (
          <div className="w-32">
            <label className="label">Difficulty</label>
            <select
              className="field !py-1.5"
              value={draft.difficulty}
              onChange={(e) => patch({ difficulty: e.target.value })}
            >
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          {!activity.is_published && onPublish && (
            <button
              className="btn-live !py-1.5 !px-3 text-xs"
              disabled={publishing || saving}
              onClick={publishThis}
            >
              {publishing ? "Publishing..." : "Publish question"}
            </button>
          )}
          <button
            className="btn-primary !py-1.5 !px-3 text-xs"
            disabled={!dirty || saving}
            onClick={save}
          >
            {saving ? "Saving..." : dirty ? "Save changes" : "Saved"}
          </button>
        </div>
      </div>

      {error && <div className="error-text mt-2 font-medium text-xs">{error}</div>}
    </div>
  );
}

export default function ReviewPage() {
  const router = useRouter();
  const { id } = useParams();
  const searchParams = useSearchParams();
  const { user, logout, ready } = useAuthGuard();

  const [session, setSession] = useState(null);
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const aiErr = searchParams?.get("ai_error");
    if (aiErr) {
      setError(aiErr);
    }
  }, [searchParams]);

  const [genOpen, setGenOpen] = useState(false);
  const [genType, setGenType] = useState("quiz");
  const [genDifficulty, setGenDifficulty] = useState("medium");
  const [genCount, setGenCount] = useState(5);
  const [genNotes, setGenNotes] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await api.getSession(id);
      setSession(data.session);
      setActivities(data.activities);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  async function saveActivity(activityId, patch) {
    const { activity } = await api.updateActivity(activityId, patch);
    setActivities((list) => list.map((a) => (a.id === activityId ? activity : a)));
  }

  async function deleteActivity(activityId) {
    if (!confirm("Delete this question?")) return;
    try {
      await api.deleteActivity(activityId);
      setActivities((list) => list.filter((a) => a.id !== activityId));
    } catch (err) {
      setError(err.message);
    }
  }

  async function unpublish(activityId) {
    try {
      const { activity } = await api.unpublishActivity(activityId);
      setActivities((list) => list.map((a) => (a.id === activityId ? activity : a)));
    } catch (err) {
      setError(err.message);
    }
  }

  async function publishSingle(activityId) {
    setBusy(true);
    setError(null);
    try {
      await api.publishActivities(id, [activityId]);
      setNotice("Question published successfully and is ready to run!");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function publishAll() {
    setBusy(true);
    setError(null);
    try {
      const invalid = drafts.filter((a) => {
        const hasQ = a.question && a.question.trim().length > 0;
        const validOpts = (a.options || []).filter((o) => String(o).trim().length > 0);
        const hasOpts = validOpts.length >= 2;
        const hasAnswer =
          a.type !== "quiz" ||
          (a.correct_answer &&
            String(a.correct_answer).trim().length > 0 &&
            validOpts.some(
              (o) => String(o).trim().toLowerCase() === String(a.correct_answer).trim().toLowerCase()
            ));
        return !hasQ || !hasOpts || !hasAnswer;
      });

      if (invalid.length > 0) {
        const details = invalid.map((a) => {
          const missing = [];
          if (!a.question || !a.question.trim()) missing.push("question text");
          const validOpts = (a.options || []).filter((o) => String(o).trim().length > 0);
          if (validOpts.length < 2) missing.push(`at least 2 options (has ${validOpts.length})`);
          if (a.type === "quiz") {
            if (!a.correct_answer || !String(a.correct_answer).trim()) {
              missing.push("a correct answer selected");
            } else if (!validOpts.some((o) => String(o).trim().toLowerCase() === String(a.correct_answer).trim().toLowerCase())) {
              missing.push("correct answer matching one of the options");
            }
          }
          return `"${(a.question || 'Untitled').slice(0, 30)}" needs ${missing.join(", ")}`;
        });
        setError(`Cannot publish all: ${details.join("; ")}. Complete these questions or publish them individually.`);
        setBusy(false);
        return;
      }

      const data = await api.publishActivities(id);
      setNotice(`Published ${data.published} question${data.published === 1 ? "" : "s"}! Ready for participants.`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function addManual() {
    try {
      const { activity } = await api.createActivity(id, {
        type: "quiz",
        question: "",
        options: ["", "", "", ""],
        timerSeconds: 30,
      });
      setActivities((list) => [...list, activity]);
    } catch (err) {
      setError(err.message);
    }
  }

  async function generateMore() {
    setBusy(true);
    setError(null);
    try {
      const data = await api.generateActivities(id, {
        type: genType,
        difficulty: genDifficulty,
        questionCount: genCount,
        notesText: genNotes.trim() || undefined,
      });
      if (data && data.success === false) {
        setError(data.error || "AI service quota temporarily exhausted. Please try again in a few minutes or provide questions manually.");
        return;
      }
      setNotice(`Generated ${data.generated} new draft${data.generated === 1 ? "" : "s"}.`);
      setGenOpen(false);
      setGenNotes("");
      await load();
    } catch (err) {
      setError(err.message || "AI service quota temporarily exhausted. Please try again in a few minutes or provide questions manually.");
    } finally {
      setBusy(false);
    }
  }

  async function goLive() {
    setBusy(true);
    setError(null);
    try {
      if (session.status === "draft") await api.startSession(id);
      router.push(`/host/sessions/${id}/live`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  if (!ready) return null;

  const drafts = activities.filter((a) => !a.is_published);
  const published = activities.filter((a) => a.is_published);

  return (
    <main className="min-h-screen">
      <Navbar userName={user?.name} onLogout={logout} />

      <div className="max-w-3xl mx-auto px-5 py-8">
        <button className="text-xs text-gray-500 hover:text-primary mb-4" onClick={() => router.push("/host/dashboard")}>
          ← All sessions
        </button>

        {loading ? (
          <Spinner label="Loading session..." />
        ) : !session ? (
          <div className="form-error">{error || "Session not found."}</div>
        ) : (
          <>
            <div className="flex justify-between items-start gap-4 mb-6 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2.5 mb-1 flex-wrap">
                  <h1 className="font-display text-2xl font-bold truncate">{session.title}</h1>
                  <StatusPill status={session.status} />
                </div>
                <div className="text-sm text-gray-500">
                  Join code <span className="font-mono tracking-widest text-primary">{session.session_code}</span>
                </div>
              </div>

              <div className="flex gap-2 shrink-0 flex-wrap">
                <button className="btn-secondary" onClick={() => setGenOpen((o) => !o)}>
                  Generate more
                </button>
                <button className="btn-secondary" onClick={addManual}>
                  Add manually
                </button>
                <button className="btn-live" disabled={busy || !published.length} onClick={goLive}>
                  {session.status === "active" ? "Go to live room" : "Start session"}
                </button>
              </div>
            </div>

            {error && <div className="form-error mb-4">{error}</div>}
            {notice && (
              <div className="border border-live/40 bg-live/10 text-live rounded-lg px-3 py-2.5 text-sm mb-4">
                {notice}
              </div>
            )}

            {genOpen && (
              <div className="card p-5 mb-5">
                <div className="font-display font-semibold text-sm mb-3">Generate more with AI</div>

                <textarea
                  className="field min-h-[100px] resize-y mb-3"
                  value={genNotes}
                  placeholder="Optional: paste extra material. Leave blank to reuse what you uploaded."
                  onChange={(e) => setGenNotes(e.target.value)}
                />

                <div className="grid sm:grid-cols-3 gap-3 mb-3">
                  <div>
                    <label className="label">Type</label>
                    <select className="field" value={genType} onChange={(e) => setGenType(e.target.value)}>
                      <option value="quiz">Quiz questions</option>
                      <option value="poll">Poll questions</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">Difficulty</label>
                    <select
                      className="field"
                      value={genDifficulty}
                      disabled={genType === "poll"}
                      onChange={(e) => setGenDifficulty(e.target.value)}
                    >
                      <option value="easy">Easy</option>
                      <option value="medium">Medium</option>
                      <option value="hard">Hard</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">How many?</label>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      className="field"
                      value={genCount}
                      onChange={(e) => setGenCount(e.target.value)}
                    />
                  </div>
                </div>

                <button className="btn-primary" disabled={busy} onClick={generateMore}>
                  {busy ? "Generating..." : "Generate"}
                </button>
              </div>
            )}

            {/* ---- Drafts awaiting review ---- */}
            {drafts.length > 0 && (
              <div className="mb-8">
                <div className="flex justify-between items-center mb-3 gap-3 flex-wrap">
                  <div>
                    <h2 className="font-display font-semibold">Drafts to review ({drafts.length})</h2>
                    <p className="text-xs text-gray-500">Participants can&apos;t see these yet.</p>
                  </div>
                  <button className="btn-primary" disabled={busy} onClick={publishAll}>
                    {busy ? "Publishing..." : `Publish all ${drafts.length}`}
                  </button>
                </div>

                <div className="grid gap-3">
                  {drafts.map((a, i) => (
                    <ActivityCard
                      key={a.id}
                      activity={a}
                      index={i}
                      onSave={saveActivity}
                      onDelete={deleteActivity}
                      onUnpublish={unpublish}
                      onPublish={publishSingle}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* ---- Published ---- */}
            {published.length > 0 && (
              <div>
                <h2 className="font-display font-semibold mb-3">Ready to run ({published.length})</h2>
                <div className="grid gap-3">
                  {published.map((a, i) => (
                    <ActivityCard
                      key={a.id}
                      activity={a}
                      index={i}
                      onSave={saveActivity}
                      onDelete={deleteActivity}
                      onUnpublish={unpublish}
                    />
                  ))}
                </div>
              </div>
            )}

            {!activities.length && (
              <div className="card p-10 text-center">
                <div className="font-display font-semibold mb-1.5">No questions yet</div>
                <p className="text-sm text-gray-500 mb-5">
                  Generate a set with AI, or add questions yourself.
                </p>
                <div className="flex justify-center gap-3 flex-wrap">
                  <button className="btn-primary" onClick={() => setGenOpen(true)}>
                    Generate with AI
                  </button>
                  <button className="btn-secondary" onClick={addManual}>
                    + Add manually
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
