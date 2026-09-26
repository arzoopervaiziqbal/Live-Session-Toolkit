"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Navbar from "../../../../components/Navbar";
import { useLang } from "../../../../contexts/LangContext";
import { useAuthGuard } from "../../../../lib/useAuthGuard";
import { api } from "../../../../lib/api";

const DIFFICULTIES = ["easy", "medium", "hard"];

export default function NewTestPage() {
  const { t, langLabel } = useLang();
  const { user, logout, ready } = useAuthGuard("host", "/host/login");
  const router = useRouter();
  const searchParams = useSearchParams();

  // Test Type: 'quiz' | 'poll'
  const initialType = searchParams?.get("type") === "poll" ? "poll" : "quiz";
  const [testType, setTestType] = useState(initialType);

  // Method: null (selection step) | 'ai' | 'manual'
  const initialMethod = searchParams?.get("method") || null;
  const [method, setMethod] = useState(initialMethod);

  // Form states
  const [name, setName] = useState("");
  const [difficulty, setDifficulty] = useState("medium");
  const [allowQa, setAllowQa] = useState(true);
  const [questionCount, setQuestionCount] = useState(5);
  const [notesTab, setNotesTab] = useState("paste");
  const [notesText, setNotesText] = useState("");
  const [file, setFile] = useState(null);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState("");

  if (!ready) return null;

  async function handleManualSubmit(e) {
    e?.preventDefault();
    if (!name.trim()) {
      setErrors({ name: `Give the ${testType === "poll" ? "poll" : "quiz"} a name.` });
      return;
    }
    setErrors({});
    setLoading(true);
    setServerError("");
    try {
      const { session } = await api.createSession({ title: name.trim() });
      const { activity } = await api.createActivity(session._id, {
        title: name.trim(),
        type: testType,
        difficulty,
        allowQa,
      });
      // Add 1 initial blank question
      await api.addQuestion(activity._id, 1);
      router.push(`/host/sessions/${session._id}/review?activity=${activity._id}`);
    } catch (err) {
      setServerError(err.message || "Failed to create test.");
      setLoading(false);
    }
  }

  async function handleAiSubmit(e) {
    e?.preventDefault();
    const errs = {};
    if (!name.trim()) errs.name = `Give the ${testType === "poll" ? "poll" : "quiz"} a name.`;
    if (notesTab === "paste" && !notesText.trim()) errs.notes = "Please add some notes or text to generate questions from.";
    if (notesTab === "upload" && !file) errs.notes = "Please choose a file to upload.";
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setLoading(true);
    setServerError("");
    try {
      const { session } = await api.createSession({ title: name.trim() });
      const { activity } = await api.createActivity(session._id, {
        title: name.trim(),
        type: testType,
        difficulty,
        allowQa,
      });

      if (notesTab === "upload") {
        await api.uploadNotesFile(activity._id, file);
      } else {
        await api.uploadNotesText(activity._id, notesText);
      }

      await api.generateQuestions(activity._id, langLabel, questionCount);
      router.push(`/host/sessions/${session._id}/review?activity=${activity._id}`);
    } catch (err) {
      setServerError(err.message || "AI question generation failed. You can also try creating manually.");
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen">
      <Navbar user={user} userName={user?.name} userEmail={user?.email} onLogout={logout} logoutLabel={t.logout_btn} />

      <div className="max-w-xl mx-auto px-6 py-8">
        <div className="mb-6">
          <Link
            href="/host/dashboard"
            className="text-xs text-gray-500 hover:text-primary transition-colors flex items-center gap-1 mb-3"
          >
            ← Back to Dashboard
          </Link>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xl">📝</span>
            <h1 className="font-display text-2xl font-bold text-gray-900 dark:text-gray-100">
              Create Test
            </h1>
          </div>
          <p className="text-xs text-gray-500">
            Build interactive quizzes and polls for your students with AI auto-generation or manual authoring.
          </p>
        </div>

        {/* STEP 1: CHOOSE TEST TYPE (QUIZ OR POLL) */}
        <div className="mb-6">
          <label className="label">1. Select Test Type</label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setTestType("quiz")}
              className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
                testType === "quiz"
                  ? "border-indigo-600 bg-indigo-500/10 ring-2 ring-indigo-500/30 text-indigo-700 dark:text-indigo-400 font-bold"
                  : "border-[#E1E1DC] dark:border-[#2A2E52] text-gray-600 dark:text-gray-400 hover:border-indigo-300"
              }`}
            >
              <div className="flex items-center gap-2 font-display text-sm mb-1">
                <span>📝</span>
                <span>Create a Quiz</span>
              </div>
              <div className="text-[11px] text-gray-500 font-normal leading-relaxed">
                Multiple-choice questions with correct answers, timer, auto-grading & participant scores.
              </div>
            </button>

            <button
              type="button"
              onClick={() => setTestType("poll")}
              className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
                testType === "poll"
                  ? "border-amber-500 bg-amber-500/10 ring-2 ring-amber-500/30 text-amber-700 dark:text-amber-400 font-bold"
                  : "border-[#E1E1DC] dark:border-[#2A2E52] text-gray-600 dark:text-gray-400 hover:border-amber-300"
              }`}
            >
              <div className="flex items-center gap-2 font-display text-sm mb-1">
                <span>📊</span>
                <span>Create a Poll</span>
              </div>
              <div className="text-[11px] text-gray-500 font-normal leading-relaxed">
                Live audience opinions, surveys & sentiment voting without right/wrong grades.
              </div>
            </button>
          </div>
        </div>

        {/* STEP 2: CHOOSE GENERATE WITH AI OR CREATE MANUALLY */}
        <div className="mb-6">
          <label className="label">2. How would you like to create questions?</label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setMethod("ai")}
              className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
                method === "ai"
                  ? "border-primary bg-primary/10 ring-2 ring-primary/30 font-bold text-primary"
                  : "border-[#E1E1DC] dark:border-[#2A2E52] text-gray-600 dark:text-gray-400 hover:border-primary/40"
              }`}
            >
              <div className="flex items-center gap-2 font-display text-sm mb-1">
                <span>✨</span>
                <span>Generate with AI</span>
              </div>
              <div className="text-[11px] text-gray-500 font-normal leading-relaxed">
                Paste your notes or upload a PDF to automatically generate questions and answers in seconds.
              </div>
            </button>

            <button
              type="button"
              onClick={() => setMethod("manual")}
              className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
                method === "manual"
                  ? "border-primary bg-primary/10 ring-2 ring-primary/30 font-bold text-primary"
                  : "border-[#E1E1DC] dark:border-[#2A2E52] text-gray-600 dark:text-gray-400 hover:border-primary/40"
              }`}
            >
              <div className="flex items-center gap-2 font-display text-sm mb-1">
                <span>✍️</span>
                <span>Create Manually</span>
              </div>
              <div className="text-[11px] text-gray-500 font-normal leading-relaxed">
                Write your own questions, options, time limits, and explanations step-by-step.
              </div>
            </button>
          </div>
        </div>

        {/* STEP 3: METHOD SPECIFIC FORM */}
        {method === "manual" && (
          <form onSubmit={handleManualSubmit} className="card p-6 border border-[#E1E1DC] dark:border-[#2A2E52] space-y-4 animate-in fade-in duration-150">
            <div className="flex items-center gap-2 pb-2 border-b border-[#E1E1DC] dark:border-[#2A2E52]">
              <span className="text-base">✍️</span>
              <h3 className="font-display font-bold text-sm">
                Create {testType === "poll" ? "Poll" : "Quiz"} Manually
              </h3>
            </div>

            <div>
              <label className="label">{testType === "poll" ? "Poll Title *" : "Quiz Title *"}</label>
              <input
                className="field"
                placeholder={testType === "poll" ? "e.g. Workshop Feedback Poll" : "e.g. Modern Physics Chapter 4 Quiz"}
                value={name}
                autoFocus
                onChange={(e) => setName(e.target.value)}
              />
              {errors.name && <div className="error-text text-xs mt-1">{errors.name}</div>}
            </div>

            {testType === "quiz" && (
              <div>
                <label className="label">Difficulty</label>
                <div className="flex gap-2">
                  {DIFFICULTIES.map((d) => (
                    <button
                      type="button"
                      key={d}
                      onClick={() => setDifficulty(d)}
                      className={`flex-1 py-2 rounded-lg border text-xs capitalize cursor-pointer transition-all ${
                        difficulty === d
                          ? "border-primary bg-primary/10 font-bold text-primary ring-1 ring-primary/30"
                          : "border-[#E1E1DC] dark:border-[#2A2E52] text-gray-500"
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <label className="label">Live Participant Q&A</label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setAllowQa(true)}
                  className={`p-2.5 rounded-lg border text-left text-xs transition-all cursor-pointer ${
                    allowQa
                      ? "border-emerald-500 bg-emerald-500/10 font-bold text-emerald-600 ring-1 ring-emerald-500/30"
                      : "border-[#E1E1DC] dark:border-[#2A2E52] text-gray-400 opacity-75"
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-bold">
                    <span>✓</span> Enabled
                  </div>
                  <div className="text-[10px] text-gray-500 mt-0.5">Students can ask questions</div>
                </button>
                <button
                  type="button"
                  onClick={() => setAllowQa(false)}
                  className={`p-2.5 rounded-lg border text-left text-xs transition-all cursor-pointer ${
                    !allowQa
                      ? "border-primary bg-primary/10 font-bold text-primary ring-1 ring-primary/30"
                      : "border-[#E1E1DC] dark:border-[#2A2E52] text-gray-400 opacity-75"
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-bold">
                    <span>✕</span> Disabled
                  </div>
                  <div className="text-[10px] text-gray-500 mt-0.5">{testType === "poll" ? "Poll" : "Quiz"} questions only</div>
                </button>
              </div>
            </div>

            {serverError && <div className="error-text text-xs" role="alert">{serverError}</div>}

            <div className="pt-2 flex justify-end gap-3">
              <button
                type="submit"
                disabled={loading}
                className="btn-primary text-xs sm:text-sm py-2.5 px-5 font-bold bg-indigo-600 hover:bg-indigo-700 text-white border-0 shadow-sm cursor-pointer w-full"
              >
                {loading ? "Creating…" : `✍️ Create & Add ${testType === "poll" ? "Poll" : "Quiz"} Questions →`}
              </button>
            </div>
          </form>
        )}

        {method === "ai" && (
          <form onSubmit={handleAiSubmit} className="card p-6 border border-[#E1E1DC] dark:border-[#2A2E52] space-y-4 animate-in fade-in duration-150">
            <div className="flex items-center gap-2 pb-2 border-b border-[#E1E1DC] dark:border-[#2A2E52]">
              <span className="text-base">✨</span>
              <h3 className="font-display font-bold text-sm">
                Generate {testType === "poll" ? "Poll" : "Quiz"} with AI
              </h3>
            </div>

            <div>
              <label className="label">{testType === "poll" ? "Poll Title *" : "Quiz Title *"}</label>
              <input
                className="field"
                placeholder={testType === "poll" ? "e.g. General Knowledge Poll" : "e.g. Biochemistry Fundamentals Quiz"}
                value={name}
                autoFocus
                onChange={(e) => setName(e.target.value)}
              />
              {errors.name && <div className="error-text text-xs mt-1">{errors.name}</div>}
            </div>

            {testType === "quiz" && (
              <div>
                <label className="label">Difficulty</label>
                <div className="flex gap-2">
                  {DIFFICULTIES.map((d) => (
                    <button
                      type="button"
                      key={d}
                      onClick={() => setDifficulty(d)}
                      className={`flex-1 py-2 rounded-lg border text-xs capitalize cursor-pointer transition-all ${
                        difficulty === d
                          ? "border-primary bg-primary/10 font-bold text-primary ring-1 ring-primary/30"
                          : "border-[#E1E1DC] dark:border-[#2A2E52] text-gray-500"
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <label className="label">Number of Questions: <strong className="text-primary">{questionCount}</strong></label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={1}
                  max={20}
                  step={1}
                  value={questionCount}
                  onChange={(e) => setQuestionCount(Number(e.target.value))}
                  className="flex-1 cursor-pointer"
                />
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={questionCount}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n)) setQuestionCount(Math.min(20, Math.max(1, n)));
                  }}
                  className="field w-16 text-center py-1 text-xs"
                />
              </div>
            </div>

            <div>
              <label className="label">Source Notes or Study Material *</label>
              <div className="flex bg-[#F5F5F2] dark:bg-[#0E1020] rounded-lg p-1 border border-[#E1E1DC] dark:border-[#2A2E52] mb-3 w-fit">
                <button
                  type="button"
                  onClick={() => setNotesTab("paste")}
                  className={`text-xs px-3 py-1.5 rounded-md cursor-pointer transition-all ${
                    notesTab === "paste" ? "bg-primary text-white font-semibold" : "text-gray-500 hover:text-gray-900"
                  }`}
                >
                  Paste Notes
                </button>
                <button
                  type="button"
                  onClick={() => setNotesTab("upload")}
                  className={`text-xs px-3 py-1.5 rounded-md cursor-pointer transition-all ${
                    notesTab === "upload" ? "bg-primary text-white font-semibold" : "text-gray-500 hover:text-gray-900"
                  }`}
                >
                  Upload File (.pdf, .txt, .docx)
                </button>
              </div>

              {notesTab === "paste" ? (
                <textarea
                  className="field"
                  rows={5}
                  placeholder="Paste lecture notes, study guide, or bullet points here..."
                  value={notesText}
                  onChange={(e) => setNotesText(e.target.value)}
                />
              ) : (
                <div className="card border-dashed p-6 text-center">
                  <input
                    type="file"
                    accept=".pdf,.docx,.txt,.md"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                    className="hidden"
                    id="ai-notes-file-input"
                  />
                  <label htmlFor="ai-notes-file-input" className="btn-secondary inline-block cursor-pointer text-xs">
                    Choose File to Upload
                  </label>
                  <div className="text-[11px] text-gray-400 mt-2">Supports PDF, DOCX, TXT, or Markdown</div>
                  {file && <div className="text-xs mt-2 font-mono font-bold text-primary">{file.name}</div>}
                </div>
              )}
              {errors.notes && <div className="error-text text-xs mt-1">{errors.notes}</div>}
            </div>

            <div>
              <label className="label">Live Participant Q&A</label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setAllowQa(true)}
                  className={`p-2.5 rounded-lg border text-left text-xs transition-all cursor-pointer ${
                    allowQa
                      ? "border-emerald-500 bg-emerald-500/10 font-bold text-emerald-600 ring-1 ring-emerald-500/30"
                      : "border-[#E1E1DC] dark:border-[#2A2E52] text-gray-400 opacity-75"
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-bold">
                    <span>✓</span> Enabled
                  </div>
                  <div className="text-[10px] text-gray-500 mt-0.5">Students can ask questions</div>
                </button>
                <button
                  type="button"
                  onClick={() => setAllowQa(false)}
                  className={`p-2.5 rounded-lg border text-left text-xs transition-all cursor-pointer ${
                    !allowQa
                      ? "border-primary bg-primary/10 font-bold text-primary ring-1 ring-primary/30"
                      : "border-[#E1E1DC] dark:border-[#2A2E52] text-gray-400 opacity-75"
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-bold">
                    <span>✕</span> Disabled
                  </div>
                  <div className="text-[10px] text-gray-500 mt-0.5">{testType === "poll" ? "Poll" : "Quiz"} questions only</div>
                </button>
              </div>
            </div>

            {serverError && <div className="error-text text-xs" role="alert">{serverError}</div>}

            <div className="pt-2 flex justify-end gap-3">
              <button
                type="submit"
                disabled={loading}
                className="btn-primary text-xs sm:text-sm py-2.5 px-5 font-bold bg-indigo-600 hover:bg-indigo-700 text-white border-0 shadow-sm cursor-pointer w-full"
              >
                {loading ? "Generating Questions with AI…" : `✨ Generate ${testType === "poll" ? "Poll" : "Quiz"} Questions with AI 🚀`}
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
