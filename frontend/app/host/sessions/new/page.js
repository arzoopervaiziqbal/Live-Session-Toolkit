"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Navbar from "../../../../components/Navbar";
import { useLang } from "../../../../contexts/LangContext";
import { useAuthGuard } from "../../../../lib/useAuthGuard";
import { api } from "../../../../lib/api";

const CATEGORIES = ["quiz", "poll", "feedback", "qa"];
const CATEGORY_LABELS = { quiz: "Quiz", poll: "Poll", feedback: "Feedback", qa: "Live Q&A" };
const DIFFICULTIES = ["easy", "medium", "hard"];

export default function NewSessionPage() {
  const { t, langLabel } = useLang();
  const { user, logout, ready } = useAuthGuard("host", "/host/login");
  const router = useRouter();

  const [name, setName] = useState("");
  const [category, setCategory] = useState("quiz");
  const [difficulty, setDifficulty] = useState("medium");
  const [questionCount, setQuestionCount] = useState(5);
  const [notesTab, setNotesTab] = useState("paste");
  const [notesText, setNotesText] = useState("");
  const [file, setFile] = useState(null);
  const [errors, setErrors] = useState({});
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState("");

  if (!ready) return null;

  async function handleCreateManual() {
    if (!name.trim()) {
      setErrors({ name: "Give the session a name." });
      return;
    }
    setGenerating(true);
    setGenError("");
    try {
      const { session } = await api.createSession({ title: name.trim() });
      const { activity } = await api.createActivity(session._id, {
        title: name.trim(),
        type: category,
        difficulty,
      });
      await api.addQuestion(activity._id, 1);
      router.push(`/host/sessions/${session._id}/review?activity=${activity._id}`);
    } catch (err) {
      setGenError(err.message || "Failed to create session.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleGenerate() {
    const errs = {};
    if (!name.trim()) errs.name = "Give the session a name.";
    if (notesTab === "paste" && !notesText.trim()) errs.notes = "Add some notes first.";
    if (notesTab === "upload" && !file) errs.notes = "Choose a file to upload.";
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setGenerating(true);
    setGenError("");
    try {
      const { session } = await api.createSession({ title: name.trim() });
      const { activity } = await api.createActivity(session._id, {
        title: name.trim(),
        type: category,
        difficulty,
      });

      if (notesTab === "upload") {
        await api.uploadNotesFile(activity._id, file);
      } else {
        await api.uploadNotesText(activity._id, notesText);
      }

      await api.generateQuestions(activity._id, langLabel, questionCount);
      router.push(`/host/sessions/${session._id}/review?activity=${activity._id}`);
    } catch (err) {
      setGenError(err.message || "Couldn't generate right now. Try again.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <main className="min-h-screen">
      <Navbar userName={user?.name} onLogout={logout} logoutLabel={t.logout_btn} />

      <div className="max-w-xl mx-auto px-6 py-8">
        <h1 className="font-display text-xl font-bold mb-6">{t.new_session_title}</h1>

        <label className="label">{t.session_name_label}</label>
        <input className="field mb-1" value={name} onChange={(e) => setName(e.target.value)} />
        {errors.name && <div className="error-text mb-3">{errors.name}</div>}
        <div className="mb-5" />

        <label className="label">{t.category_label}</label>
        <div className="grid grid-cols-2 gap-2 mb-5">
          {CATEGORIES.map((c) => (
            <button
              type="button"
              key={c}
              onClick={() => setCategory(c)}
              className={`text-left p-3 rounded-lg border text-sm ${
                category === c ? "border-primary bg-primary/10" : "border-[#E1E1DC] dark:border-[#2A2E52]"
              }`}
            >
              {CATEGORY_LABELS[c]}
            </button>
          ))}
        </div>

        <label className="label">{t.difficulty_label}</label>
        <div className="flex gap-2 mb-5">
          {DIFFICULTIES.map((d) => (
            <button
              type="button"
              key={d}
              onClick={() => setDifficulty(d)}
              className={`flex-1 py-2 rounded-lg border text-sm capitalize ${
                difficulty === d ? "border-primary bg-primary/10" : "border-[#E1E1DC] dark:border-[#2A2E52]"
              } ${category !== "quiz" ? "opacity-50" : ""}`}
            >
              {t[d]}
            </button>
          ))}
        </div>
        {category !== "quiz" && (
          <div className="text-[11px] text-gray-400 -mt-3 mb-5">Difficulty mainly affects quiz questions.</div>
        )}

        <label className="label">{t.question_count_label}</label>
        <div className="flex items-center gap-3 mb-5">
          <input
            type="range"
            min={1}
            max={20}
            step={1}
            value={questionCount}
            onChange={(e) => setQuestionCount(Number(e.target.value))}
            className="flex-1"
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
            className="field w-16 text-center py-1.5"
          />
        </div>

        <label className="label">{t.notes_label}</label>
        <div className="flex bg-[#F5F5F2] dark:bg-[#0E1020] rounded-lg p-1 border border-[#E1E1DC] dark:border-[#2A2E52] mb-3 w-fit">
          <button
            type="button"
            onClick={() => setNotesTab("paste")}
            className={`text-xs px-4 py-2 rounded-md ${notesTab === "paste" ? "bg-primary text-white" : "text-gray-500"}`}
          >
            {t.notes_paste_tab}
          </button>
          <button
            type="button"
            onClick={() => setNotesTab("upload")}
            className={`text-xs px-4 py-2 rounded-md ${notesTab === "upload" ? "bg-primary text-white" : "text-gray-500"}`}
          >
            {t.notes_upload_tab}
          </button>
        </div>

        {notesTab === "paste" ? (
          <textarea
            className="field mb-1"
            rows={7}
            value={notesText}
            onChange={(e) => setNotesText(e.target.value)}
          />
        ) : (
          <div className="card border-dashed p-6 text-center mb-1">
            <input
              type="file"
              accept=".pdf,.docx,.txt,.md"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="hidden"
              id="notes-file-input"
            />
            <label htmlFor="notes-file-input" className="btn-secondary inline-block cursor-pointer">
              {t.choose_file}
            </label>
            <div className="text-[11px] text-gray-400 mt-2">{t.upload_hint}</div>
            {file && <div className="text-xs mt-2 font-mono">{file.name}</div>}
          </div>
        )}
        {errors.notes && <div className="error-text mb-3">{errors.notes}</div>}
        <div className="mb-6" />

        {genError && <div className="error-text mb-4">{genError}</div>}

        <div className="flex flex-wrap gap-3">
          <button className="btn-secondary" onClick={() => router.push("/host/dashboard")}>
            {t.back_btn}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={handleCreateManual}
            disabled={generating}
          >
            Create without AI
          </button>
          <button className="btn-primary" onClick={handleGenerate} disabled={generating}>
            {generating ? t.generating : t.generate_btn}
          </button>
        </div>
      </div>
    </main>
  );
}
