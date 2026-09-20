"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Navbar from "../../../components/Navbar";
import { useLang } from "../../../contexts/LangContext";
import { useAuthGuard } from "../../../lib/useAuthGuard";
import { api } from "../../../lib/api";

const STATUS_COLORS = {
  draft: "text-amber-500 bg-amber-500/10 border-amber-500/30",
  active: "text-emerald-500 bg-emerald-500/10 border-emerald-500/30",
  closed: "text-gray-400 bg-gray-400/10 border-gray-400/30",
};

export default function HostDashboard() {
  const { t } = useLang();
  const { user, logout, ready } = useAuthGuard("host", "/host/login");
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);

  // Create Session Modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newSession, setNewSession] = useState({
    title: "",
    description: "",
    date: new Date().toISOString().slice(0, 16),
    status: "draft",
  });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  // Edit Session Modal state
  const [editingSession, setEditingSession] = useState(null); // session object being edited
  const [editForm, setEditForm] = useState({ title: "", description: "", date: "", status: "draft" });
  const [editError, setEditError] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  // Delete state
  const [deletingId, setDeletingId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  // Students & Results Modal state
  const [selectedSessionForStudents, setSelectedSessionForStudents] = useState(null);
  const [studentsData, setStudentsData] = useState(null);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [studentsFilter, setStudentsFilter] = useState("all"); // 'all' | 'done' | 'pending'
  const [studentsSearch, setStudentsSearch] = useState("");

  async function openStudentsModal(session) {
    setSelectedSessionForStudents(session);
    setStudentsData(null);
    setStudentsFilter("all");
    setStudentsSearch("");
    if (!session.activityId) return;

    setLoadingStudents(true);
    try {
      const data = await api.getResults(session.activityId);
      setStudentsData(data);
    } catch (err) {
      console.error("Failed to load students:", err);
    } finally {
      setLoadingStudents(false);
    }
  }

  function closeStudentsModal() {
    setSelectedSessionForStudents(null);
    setStudentsData(null);
  }

  function copyJoinLink(linkCode) {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const url = `${origin}/participant/join?code=${linkCode}`;
    navigator.clipboard?.writeText(url);
    setCopiedId(linkCode);
    setTimeout(() => setCopiedId(null), 2000);
  }

  useEffect(() => {
    if (!ready) return;
    loadSessions();
  }, [ready]);

  function loadSessions() {
    setLoading(true);
    api
      .listSessions()
      .then((data) => setSessions(data.sessions || []))
      .finally(() => setLoading(false));
  }

  if (!ready) return null;

  async function handleCreateSession(e) {
    e?.preventDefault();
    if (!newSession.title.trim()) {
      setCreateError("Give the session a name.");
      return;
    }
    setCreating(true);
    setCreateError("");
    try {
      const { session } = await api.createSession(newSession);
      // Create a default quiz activity for this session so it's ready to edit questions immediately
      await api.createActivity(session._id, {
        title: session.title,
        type: "quiz",
        difficulty: "medium",
      });
      setShowCreateModal(false);
      setNewSession({
        title: "",
        description: "",
        date: new Date().toISOString().slice(0, 16),
        status: "draft",
      });
      loadSessions();
    } catch (err) {
      setCreateError(err.body?.errors?.title || err.message || "Failed to create session.");
    } finally {
      setCreating(false);
    }
  }

  function openEditModal(session) {
    setEditingSession(session);
    setEditForm({
      title: session.title || "",
      description: session.description || "",
      date: session.date ? new Date(session.date).toISOString().slice(0, 16) : "",
      status: session.status || "draft",
    });
    setEditError("");
  }

  function closeEditModal() {
    setEditingSession(null);
    setEditError("");
  }

  async function handleSaveEdit(e) {
    e?.preventDefault();
    if (!editForm.title.trim()) {
      setEditError("Give the session a name.");
      return;
    }
    setSavingEdit(true);
    setEditError("");
    try {
      const { session } = await api.updateSession(editingSession._id, editForm);
      setSessions((prev) =>
        prev.map((s) => (s._id === session._id ? { ...s, ...session } : s))
      );
      closeEditModal();
    } catch (err) {
      setEditError(err.body?.errors?.title || err.message || "Couldn't update session.");
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleQuickStatusChange(sessionId, newStatus) {
    try {
      const { session } = await api.updateSession(sessionId, { status: newStatus });
      setSessions((prev) =>
        prev.map((s) => (s._id === sessionId ? { ...s, status: session.status } : s))
      );
    } catch (err) {
      console.error("Status update error", err);
    }
  }

  async function confirmDelete(id) {
    setDeletingId(id);
    try {
      await api.deleteSession(id);
      setSessions((prev) => prev.filter((s) => s._id !== id));
    } catch (err) {
      setSessions((prev) => prev.map((s) => (s._id === id ? { ...s, _deleteError: err.message } : s)));
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  }

  return (
    <main className="min-h-screen">
      <Navbar userName={user?.name} onLogout={logout} logoutLabel={t.logout_btn} />

      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="flex flex-wrap justify-between items-center gap-3 mb-6">
          <div>
            <h1 className="font-display text-2xl font-bold">{t.dashboard_title}</h1>
            <p className="text-xs text-gray-500">Manage all your sessions, quizzes, and live activities</p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="btn-primary flex items-center gap-1.5 shadow-sm"
            >
              <span>+</span> {t.create_session}
            </button>
            <Link
              href="/host/sessions/new"
              className="btn-secondary flex items-center gap-1.5"
              title="Generate session questions from PDF or notes"
            >
              <span>✨</span> AI Wizard
            </Link>
          </div>
        </div>

        {loading ? (
          <div className="card p-12 text-center text-sm text-gray-400">Loading your sessions…</div>
        ) : sessions.length === 0 ? (
          <div className="card border-dashed p-12 text-center">
            <div className="font-display text-base font-semibold mb-2">No sessions created yet</div>
            <p className="text-xs text-gray-500 mb-6 max-w-sm mx-auto">
              Create your first live session to start generating quizzes, polls, and live activities for participants.
            </p>
            <div className="flex justify-center gap-3">
              <button
                type="button"
                onClick={() => setShowCreateModal(true)}
                className="btn-primary"
              >
                + Quick Create Session
              </button>
              <Link href="/host/sessions/new" className="btn-secondary">
                ✨ Generate from Notes
              </Link>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {sessions.map((s) => (
              <div key={s._id} className="card p-5 flex flex-col justify-between hover:border-primary/50 transition-all shadow-sm">
                <div>
                  <div className="flex justify-between items-start gap-2 mb-2">
                    <Link
                      href={`/host/sessions/${s._id}/review`}
                      className="font-display font-semibold text-base hover:text-primary transition-colors flex-1"
                    >
                      {s.title}
                    </Link>

                    {/* Quick status selector */}
                    <select
                      value={s.status}
                      onChange={(e) => handleQuickStatusChange(s._id, e.target.value)}
                      className={`text-[11px] font-mono uppercase font-bold px-2 py-1 rounded-md border cursor-pointer ${STATUS_COLORS[s.status] || ""}`}
                      title="Click to change status"
                    >
                      <option value="draft">Draft</option>
                      <option value="active">Active</option>
                      <option value="closed">Closed</option>
                    </select>
                  </div>

                  {s.description && (
                    <p className="text-xs text-gray-500 line-clamp-2 mb-3">{s.description}</p>
                  )}

                  <div className="flex flex-wrap items-center gap-2 text-[11px] mb-3">
                    <span className="text-gray-400">
                      📅 {s.date ? new Date(s.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "No date"}
                    </span>
                    <span className="text-gray-400">•</span>
                    <span className="text-gray-400">📝 {s.activityCount || 0} activities</span>
                    <span className="text-gray-400">•</span>
                    <button
                      type="button"
                      onClick={() => openStudentsModal(s)}
                      className="inline-flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer bg-emerald-500/10 px-2 py-0.5 rounded-full"
                      title="Click to view all participants and quiz results"
                    >
                      <span>👥</span>
                      <span>{s.participantCount || 0} joined</span>
                      <span>({s.completedCount || 0} done)</span>
                    </button>
                  </div>

                  {s.linkId && (
                    <div className="flex items-center justify-between bg-[#F5F5F2] dark:bg-[#0E1020] border border-[#E1E1DC] dark:border-[#2A2E52] rounded-lg px-2.5 py-1.5 mb-3 text-xs">
                      <div className="flex items-center gap-1.5">
                        <span className="text-gray-400 text-[11px]">Join Code:</span>
                        <span className="font-mono font-bold text-primary tracking-wider">{s.linkId}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => copyJoinLink(s.linkId)}
                        className="text-[11px] text-gray-500 hover:text-primary font-medium flex items-center gap-1"
                      >
                        {copiedId === s.linkId ? "✓ Copied!" : "📋 Copy Link"}
                      </button>
                    </div>
                  )}
                </div>

                {s._deleteError && (
                  <div className="error-text mb-2 text-xs" role="alert">
                    {s._deleteError}
                  </div>
                )}

                <div className="flex items-center justify-between pt-3 border-t border-[#E1E1DC] dark:border-[#2A2E52]">
                  <div className="flex items-center gap-3">
                    <Link
                      href={`/host/sessions/${s._id}/review`}
                      className="text-xs text-primary font-medium hover:underline flex items-center gap-1"
                    >
                      Open Session →
                    </Link>

                    {s.activityId && (
                      <button
                        type="button"
                        onClick={() => openStudentsModal(s)}
                        className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold hover:underline flex items-center gap-1"
                      >
                        👥 Students ({s.completedCount || 0})
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="text-xs text-gray-500 hover:text-primary px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
                      onClick={() => openEditModal(s)}
                    >
                      ✏️ Edit
                    </button>

                    {confirmDeleteId === s._id ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          className="text-xs text-red-600 font-semibold px-2 py-1 rounded bg-red-50 hover:bg-red-100 dark:bg-red-950/40"
                          disabled={deletingId === s._id}
                          onClick={() => confirmDelete(s._id)}
                        >
                          {deletingId === s._id ? "Deleting…" : "Confirm"}
                        </button>
                        <button
                          type="button"
                          className="text-xs text-gray-400 hover:text-gray-600 px-1 py-1"
                          disabled={deletingId === s._id}
                          onClick={() => setConfirmDeleteId(null)}
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="text-xs text-gray-400 hover:text-red-500 px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-950/20"
                        onClick={() => setConfirmDeleteId(s._id)}
                      >
                        🗑️ Delete
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* CREATE SESSION MODAL */}
        {showCreateModal && (
          <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="card max-w-md w-full p-6 shadow-xl animate-in fade-in zoom-in-95 duration-150">
              <div className="flex justify-between items-center mb-4">
                <h2 className="font-display font-bold text-lg">Create New Session</h2>
                <button
                  type="button"
                  className="text-gray-400 hover:text-gray-600 text-sm"
                  onClick={() => setShowCreateModal(false)}
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleCreateSession}>
                <label className="label">Session Name *</label>
                <input
                  className="field mb-3"
                  placeholder="e.g. Physics 101 Lecture"
                  value={newSession.title}
                  autoFocus
                  onChange={(e) => setNewSession({ ...newSession, title: e.target.value })}
                />

                <label className="label">Description</label>
                <textarea
                  className="field mb-3"
                  rows={2}
                  placeholder="Brief description or topic..."
                  value={newSession.description}
                  onChange={(e) => setNewSession({ ...newSession, description: e.target.value })}
                />

                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div>
                    <label className="label">Date & Time</label>
                    <input
                      type="datetime-local"
                      className="field text-xs"
                      value={newSession.date}
                      onChange={(e) => setNewSession({ ...newSession, date: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="label">Initial Status</label>
                    <select
                      className="field text-xs"
                      value={newSession.status}
                      onChange={(e) => setNewSession({ ...newSession, status: e.target.value })}
                    >
                      <option value="draft">Draft</option>
                      <option value="active">Active</option>
                      <option value="closed">Closed</option>
                    </select>
                  </div>
                </div>

                {createError && <div className="error-text mb-4">{createError}</div>}

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    className="btn-secondary text-xs"
                    onClick={() => setShowCreateModal(false)}
                    disabled={creating}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary text-xs" disabled={creating}>
                    {creating ? "Creating…" : "Create Session"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* EDIT SESSION MODAL */}
        {editingSession && (
          <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="card max-w-md w-full p-6 shadow-xl animate-in fade-in zoom-in-95 duration-150">
              <div className="flex justify-between items-center mb-4">
                <h2 className="font-display font-bold text-lg">Edit Session</h2>
                <button
                  type="button"
                  className="text-gray-400 hover:text-gray-600 text-sm"
                  onClick={closeEditModal}
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleSaveEdit}>
                <label className="label">Session Name *</label>
                <input
                  className="field mb-3"
                  value={editForm.title}
                  autoFocus
                  onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                />

                <label className="label">Description</label>
                <textarea
                  className="field mb-3"
                  rows={2}
                  value={editForm.description}
                  onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                />

                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div>
                    <label className="label">Date & Time</label>
                    <input
                      type="datetime-local"
                      className="field text-xs"
                      value={editForm.date}
                      onChange={(e) => setEditForm({ ...editForm, date: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="label">Status</label>
                    <select
                      className="field text-xs"
                      value={editForm.status}
                      onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                    >
                      <option value="draft">Draft</option>
                      <option value="active">Active</option>
                      <option value="closed">Closed</option>
                    </select>
                  </div>
                </div>

                {editError && <div className="error-text mb-4">{editError}</div>}

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    className="btn-secondary text-xs"
                    onClick={closeEditModal}
                    disabled={savingEdit}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary text-xs" disabled={savingEdit}>
                    {savingEdit ? "Saving…" : "Save Changes"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
        {/* STUDENTS & QUIZ RESULTS MODAL */}
        {selectedSessionForStudents && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
            <div className="card max-w-2xl w-full p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-150 my-8 max-h-[90vh] flex flex-col">
              {/* Modal Header */}
              <div className="flex justify-between items-start pb-4 border-b border-[#E1E1DC] dark:border-[#2A2E52] shrink-0">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                      Quiz Participants
                    </span>
                    {selectedSessionForStudents.linkId && (
                      <span className="font-mono text-xs font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-md">
                        Code: {selectedSessionForStudents.linkId}
                      </span>
                    )}
                  </div>
                  <h2 className="font-display font-bold text-xl text-gray-900 dark:text-gray-100">
                    {selectedSessionForStudents.title}
                  </h2>
                  <p className="text-xs text-gray-500">
                    Students who joined and their quiz completion status & scores
                  </p>
                </div>
                <button
                  type="button"
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-lg p-1"
                  onClick={closeStudentsModal}
                >
                  ✕
                </button>
              </div>

              {/* Modal Body */}
              <div className="overflow-y-auto flex-1 py-4 pr-1">
                {loadingStudents ? (
                  <div className="py-16 text-center text-sm text-gray-400">
                    Loading student participants and scores…
                  </div>
                ) : !studentsData ? (
                  <div className="py-12 text-center text-sm text-gray-400">
                    No activity found for this session.
                  </div>
                ) : (
                  <div>
                    {/* Summary Stat Cards */}
                    <div className="grid grid-cols-4 gap-2 mb-5">
                      <div className="p-3 rounded-lg border border-[#E1E1DC] dark:border-[#2A2E52] bg-[#F9F9F8] dark:bg-[#1B1E3F]/40 text-center">
                        <div className="text-[10px] uppercase font-bold text-gray-400">Joined</div>
                        <div className="font-display text-xl font-extrabold text-gray-900 dark:text-gray-100">
                          {studentsData.totalParticipants || 0}
                        </div>
                      </div>

                      <div className="p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 text-center">
                        <div className="text-[10px] uppercase font-bold text-emerald-600 dark:text-emerald-400">Done</div>
                        <div className="font-display text-xl font-extrabold text-emerald-600 dark:text-emerald-400">
                          {studentsData.completedParticipants || 0}
                        </div>
                      </div>

                      <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/5 text-center">
                        <div className="text-[10px] uppercase font-bold text-amber-600 dark:text-amber-400">Attempting</div>
                        <div className="font-display text-xl font-extrabold text-amber-600 dark:text-amber-400">
                          {studentsData.pendingParticipants || 0}
                        </div>
                      </div>

                      <div className="p-3 rounded-lg border border-primary/30 bg-primary/5 text-center">
                        <div className="text-[10px] uppercase font-bold text-primary">Avg Score</div>
                        <div className="font-display text-xl font-extrabold text-primary">
                          {studentsData.completedParticipants > 0 ? `${studentsData.averageScore || 0}%` : "—"}
                        </div>
                      </div>
                    </div>

                    {/* Filter Tabs & Search */}
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                      <input
                        type="text"
                        placeholder="Search student name..."
                        value={studentsSearch}
                        onChange={(e) => setStudentsSearch(e.target.value)}
                        className="field text-xs py-1 px-3 w-44"
                      />

                      <div className="flex items-center bg-[#F0F0EB] dark:bg-[#1B1E3F] p-1 rounded-lg text-xs">
                        <button
                          type="button"
                          onClick={() => setStudentsFilter("all")}
                          className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                            studentsFilter === "all" ? "bg-white dark:bg-[#2A2E52] shadow-xs text-primary" : "text-gray-500"
                          }`}
                        >
                          All ({studentsData.students?.length || 0})
                        </button>
                        <button
                          type="button"
                          onClick={() => setStudentsFilter("done")}
                          className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                            studentsFilter === "done" ? "bg-white dark:bg-[#2A2E52] shadow-xs text-emerald-600" : "text-gray-500"
                          }`}
                        >
                          Done ({studentsData.completedParticipants || 0})
                        </button>
                        <button
                          type="button"
                          onClick={() => setStudentsFilter("pending")}
                          className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                            studentsFilter === "pending" ? "bg-white dark:bg-[#2A2E52] shadow-xs text-amber-600" : "text-gray-500"
                          }`}
                        >
                          Attempting ({studentsData.pendingParticipants || 0})
                        </button>
                      </div>
                    </div>

                    {/* Students Roster */}
                    {(!studentsData.students || studentsData.students.length === 0) ? (
                      <div className="py-10 text-center text-xs text-gray-400">
                        No students have joined this session yet.
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        {studentsData.students
                          .filter((st) => {
                            if (studentsFilter === "done" && !st.isDone) return false;
                            if (studentsFilter === "pending" && st.isDone) return false;
                            if (studentsSearch.trim()) {
                              return st.displayName.toLowerCase().includes(studentsSearch.toLowerCase().trim());
                            }
                            return true;
                          })
                          .map((student) => {
                            return (
                              <div
                                key={student.participantId}
                                className={`rounded-xl border transition-all ${
                                  student.isDone
                                    ? "border-emerald-500/30 bg-emerald-500/[0.01]"
                                    : "border-[#E1E1DC] dark:border-[#2A2E52] bg-white dark:bg-[#1B1E3F]/20"
                                }`}
                              >
                                <div className="p-3 flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex items-center gap-2.5">
                                    <div
                                      className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs uppercase ${
                                        student.isDone
                                          ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                                          : "bg-amber-500/20 text-amber-600 dark:text-amber-400"
                                      }`}
                                    >
                                      {student.displayName?.slice(0, 2) || "ST"}
                                    </div>
                                    <div>
                                      <div className="text-xs font-bold text-gray-900 dark:text-gray-100 flex items-center gap-1">
                                        <span>{student.displayName}</span>
                                        {student.isDone && <span className="text-emerald-600 text-[11px]">✓</span>}
                                      </div>
                                      <div className="text-[10px] text-gray-400">
                                        Joined {new Date(student.joinedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                        {student.submittedAt && (
                                          <span>
                                            {" "}• Done {new Date(student.submittedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  </div>

                                  {/* Right: Status and Marks */}
                                  <div className="flex items-center gap-2">
                                    {student.isDone ? (
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/30">
                                          ✓ Done
                                        </span>
                                        <div className="px-2 py-0.5 rounded-lg bg-primary/10 border border-primary/25 text-primary font-bold text-xs flex items-center gap-1 shadow-2xs">
                                          <span className="font-mono">
                                            {student.score ? student.score.correct : 0}/{student.score?.total || 0} Marks
                                          </span>
                                          <span className="text-[10px] font-normal opacity-85">
                                            ({student.score?.percentage ?? 0}%)
                                          </span>
                                        </div>
                                      </div>
                                    ) : (
                                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 border border-amber-500/30">
                                        ⏳ Attempting
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
                )}
              </div>

              {/* Modal Footer */}
              <div className="flex items-center justify-between pt-3 border-t border-[#E1E1DC] dark:border-[#2A2E52] shrink-0">
                <Link
                  href={`/host/sessions/${selectedSessionForStudents._id}/live?activity=${selectedSessionForStudents.activityId}`}
                  className="btn-primary text-xs flex items-center gap-1.5"
                >
                  <span>📺</span> Open Live Monitor Screen
                </Link>
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  onClick={closeStudentsModal}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

