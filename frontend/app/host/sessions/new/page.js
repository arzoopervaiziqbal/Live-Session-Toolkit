"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Navbar from "../../../../components/Navbar";
import { useAuthGuard } from "../../../../lib/useAuthGuard";
import { api } from "../../../../lib/api";

const CATEGORIES = [
  { key: "quiz", label: "Quiz", hint: "AI-generated graded questions" },
  { key: "poll", label: "Polls", hint: "Live opinion votes" },
  { key: "qa", label: "Q&A", hint: "Questions and comments feed" },
];

export default function NewSessionPage() {
  const router = useRouter();
  const { user, logout, ready } = useAuthGuard();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [categories, setCategories] = useState(["quiz", "poll", "qa"]);

  const [tab, setTab] = useState("paste");
  const [notesText, setNotesText] = useState("");
  const [file, setFile] = useState(null);

  const [type, setType] = useState("quiz");
  const [difficulty, setDifficulty] = useState("medium");
  const [questionCount, setQuestionCount] = useState(5);

  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [errors, setErrors] = useState({});

  function toggleCategory(key) {
    setCategories((list) => (list.includes(key) ? list.filter((c) => c !== key) : [...list, key]));
  }

  const wantsGeneration = categories.includes("quiz") || categories.includes("poll");
  const hasMaterial = tab === "paste" ? notesText.trim().length > 0 : Boolean(file);

  async function create(generate) {
    if (busy) return;
    setErrors({});

    if (!title.trim()) return setErrors({ title: "Give the session a name." });
    if (!categories.length) return setErrors({ form: "Pick at least one activity type." });
    if (generate && !hasMaterial) return setErrors({ notes: "Add your notes or upload a file first." });

    setBusy(true);
    try {
      setStep("Creating session...");
      const { session } = await api.createSession({
        title,
        description,
        activeCategories: categories,
      });

      if (generate) {
        setStep(file ? "Reading your file..." : "Saving your material...");
        if (tab === "upload" && file) {
          await api.uploadNotesFile(session.id, file);
        } else {
          await api.uploadNotesText(session.id, notesText);
        }

        setStep("Generating questions with AI — this takes a few seconds...");
        try {
          const genRes = await api.generateActivities(session.id, { type, difficulty, questionCount });
          if (genRes && genRes.success === false) {
            router.replace(`/host/sessions/${session.id}/review?ai_error=${encodeURIComponent(genRes.error)}`);
            return;
          }
        } catch (genErr) {
          console.warn("AI generation failed on creation, navigating to review for manual input:", genErr.message);
          router.replace(`/host/sessions/${session.id}/review?ai_error=${encodeURIComponent(genErr.message)}`);
          return;
        }
      }

      // Everything lands on the review screen as drafts; nothing is live yet.
      router.replace(`/host/sessions/${session.id}/review`);
    } catch (err) {
      setErrors(err.fieldErrors || { form: err.message });
      setBusy(false);
      setStep("");
    }
  }

  if (!ready) return null;

  return (
    <main className="min-h-screen">
      <Navbar userName={user?.name} onLogout={logout} />

      <div className="max-w-2xl mx-auto px-5 py-8">
        <button className="text-xs text-gray-500 hover:text-primary mb-4" onClick={() => router.back()}>
          ← Back
        </button>

        <h1 className="font-display text-2xl font-bold mb-6">New session</h1>

        {errors.form && <div className="form-error mb-4">{errors.form}</div>}

        {/* ---- Basics ---- */}
        <div className="card p-5 mb-4">
          <div className="mb-4">
            <label className="label" htmlFor="title">
              Session name
            </label>
            <input
              id="title"
              className={`field ${errors.title ? "field-error" : ""}`}
              value={title}
              placeholder="e.g. Week 4 — Neural Networks"
              onChange={(e) => setTitle(e.target.value)}
            />
            {errors.title && <div className="error-text">{errors.title}</div>}
          </div>

          <div>
            <label className="label" htmlFor="description">
              Description <span className="text-gray-400">(optional)</span>
            </label>
            <input
              id="description"
              className="field"
              value={description}
              placeholder="Shown to you only"
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>

        {/* ---- Categories ---- */}
        <div className="card p-5 mb-4">
          <div className="label mb-2.5">Which tools do you want in this session?</div>
          <div className="grid gap-2">
            {CATEGORIES.map((c) => {
              const on = categories.includes(c.key);
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => toggleCategory(c.key)}
                  className={`flex items-center gap-3 p-3 rounded-lg border text-left ${
                    on ? "border-primary bg-primary/5" : "border-[#E1E1DC] dark:border-[#2A2E52]"
                  }`}
                >
                  <span
                    className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] text-white shrink-0 ${
                      on ? "bg-primary border-primary" : "border-gray-400"
                    }`}
                  >
                    {on ? "✓" : ""}
                  </span>
                  <span className="min-w-0">
                    <span className="text-sm font-semibold block">{c.label}</span>
                    <span className="text-xs text-gray-500">{c.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ---- Material + AI ---- */}
        {wantsGeneration && (
          <div className="card p-5 mb-4">
            <div className="label mb-2.5">Your session material</div>

            <div className="flex gap-1 p-1 bg-[#F5F5F2] dark:bg-[#0E1020] rounded-lg border border-[#E1E1DC] dark:border-[#2A2E52] mb-3">
              {[
                ["paste", "Paste text"],
                ["upload", "Upload file"],
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  className={`flex-1 text-xs py-2 rounded-md ${tab === key ? "bg-primary text-white" : "text-gray-500"}`}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === "paste" ? (
              <textarea
                className={`field min-h-[160px] resize-y ${errors.notes ? "field-error" : ""}`}
                value={notesText}
                placeholder="Paste your lecture notes, slide content, or outline here..."
                onChange={(e) => setNotesText(e.target.value)}
              />
            ) : (
              <div>
                <input
                  type="file"
                  accept=".pdf,.docx,.txt,.md"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  className="field cursor-pointer file:mr-3 file:py-1 file:px-3 file:rounded-md file:border-0 file:bg-primary file:text-white file:text-xs file:cursor-pointer"
                />
                <div className="text-xs text-gray-500 mt-1.5">PDF, DOCX, TXT, or MD — up to 15MB</div>
              </div>
            )}
            {errors.notes && <div className="error-text">{errors.notes}</div>}

            <div className="grid sm:grid-cols-3 gap-3 mt-4">
              <div>
                <label className="label">Generate</label>
                <select className="field" value={type} onChange={(e) => setType(e.target.value)}>
                  <option value="quiz">Quiz questions</option>
                  <option value="poll">Poll questions</option>
                </select>
              </div>

              <div>
                <label className="label">Difficulty</label>
                <select
                  className="field"
                  value={difficulty}
                  disabled={type === "poll"}
                  onChange={(e) => setDifficulty(e.target.value)}
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
                  value={questionCount}
                  onChange={(e) => setQuestionCount(e.target.value)}
                />
              </div>
            </div>
          </div>
        )}

        {busy && step && (
          <div className="card p-4 mb-4 flex items-center gap-3 text-sm">
            <span className="w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin shrink-0" />
            {step}
          </div>
        )}

        <div className="flex gap-2.5 flex-wrap">
          {wantsGeneration && (
            <button className="btn-primary" disabled={busy} onClick={() => create(true)}>
              {busy ? "Working..." : "Create & generate with AI"}
            </button>
          )}
          <button className="btn-secondary" disabled={busy} onClick={() => create(false)}>
            Create empty session
          </button>
        </div>

        <p className="text-xs text-gray-500 mt-3">
          Generated questions arrive as drafts. You review and edit them before anything reaches participants.
        </p>
      </div>
    </main>
  );
}
