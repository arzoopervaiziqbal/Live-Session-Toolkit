"use client";
import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Navbar from "../../../components/Navbar";
import { useLang } from "../../../contexts/LangContext";
import { useAuthGuard } from "../../../lib/useAuthGuard";
import { api } from "../../../lib/api";
import { getSocket } from "../../../lib/socket";

const STATUS_COLORS = {
  draft: "text-amber-500 bg-amber-500/10 border-amber-500/30",
  active: "text-emerald-500 bg-emerald-500/10 border-emerald-500/30",
  closed: "text-gray-400 bg-gray-400/10 border-gray-400/30",
};

export default function HostDashboard() {
  const { t } = useLang();
  const { user, logout, ready } = useAuthGuard("host", "/host/login");
  const router = useRouter();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterTab, setFilterTab] = useState("all"); // 'all' | 'live' | 'test'

  // Dedicated Create Session Modal state (ONLY Session options!)
  const [showSessionModal, setShowSessionModal] = useState(false);
  const [newSession, setNewSession] = useState({
    title: "",
    description: "",
    date: new Date().toISOString().slice(0, 16),
    status: "draft",
  });
  const [sessionQa, setSessionQa] = useState(true);
  const [startingSession, setStartingSession] = useState(false);
  const [sessionError, setSessionError] = useState("");

  // Dedicated Create Test Modal & Dropdown state (Quiz & Poll: AI vs Manual)
  const [showTestDropdown, setShowTestDropdown] = useState(false);
  const testDropdownRef = useRef(null);
  const [showTestModal, setShowTestModal] = useState(false);
  const [testType, setTestType] = useState("quiz"); // 'quiz' | 'poll'
  const [testMethod, setTestMethod] = useState(null); // null | 'ai' | 'manual'
  const [testName, setTestName] = useState("");
  const [testDifficulty, setTestDifficulty] = useState("medium");
  const [testQa, setTestQa] = useState(true);
  const [testQuestionCount, setTestQuestionCount] = useState(5);
  const [testNotesTab, setTestNotesTab] = useState("paste");
  const [testNotesText, setTestNotesText] = useState("");
  const [testFile, setTestFile] = useState(null);
  const [creatingTest, setCreatingTest] = useState(false);
  const [testError, setTestError] = useState("");

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

  // Proctor & Screen Switch Alert states on Host Dashboard
  const [proctorAlerts, setProctorAlerts] = useState([]);
  const [activeProctorModal, setActiveProctorModal] = useState(null);
  const [decisionSubmitting, setDecisionSubmitting] = useState(false);

  function playUrgentHostAlarm() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.setValueAtTime(440, now + 0.15);
        osc.frequency.setValueAtTime(880, now + 0.3);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.5);
      }
    } catch (_) {}
  }

  async function handleProctorDecision(alert, decision) {
    if (!alert || decisionSubmitting) return;
    let actId = alert.activityId || selectedSessionForStudents?.activityId;
    if (!actId && alert.linkId) {
      const match = sessions.find(
        (s) => s.linkId === alert.linkId || s.linkCode === alert.linkId || s._id === alert.linkId
      );
      if (match) actId = match.activityId;
    }
    if (!actId && alert.sessionId) {
      const match = sessions.find((s) => s._id === alert.sessionId);
      if (match) actId = match.activityId;
    }

    setDecisionSubmitting(true);
    const dec = decision === "approve" ? "continue" : decision;

    try {
      if (actId) {
        await api.submitProctorDecision(actId, {
          participantId: alert.participantId,
          guestId: alert.guestId,
          decision: dec,
          reason:
            dec === "fail"
              ? `Disqualified by host for switching tabs or altering screen dimensions during quiz.`
              : undefined,
        }).catch((err) => console.warn("API proctor decision failed:", err));
      }

      const socket = getSocket();
      socket.emit("quiz-proctor-decision", {
        linkId: alert.linkId,
        activityId: actId,
        sessionId: alert.sessionId,
        participantId: alert.participantId,
        guestId: alert.guestId,
        displayName: alert.displayName,
        decision: dec,
      });

      setProctorAlerts((prev) =>
        prev.filter((a) => a.guestId !== alert.guestId && a.participantId !== alert.participantId && a.id !== alert.id)
      );
      if (
        activeProctorModal &&
        (activeProctorModal.guestId === alert.guestId ||
          activeProctorModal.participantId === alert.participantId ||
          activeProctorModal.id === alert.id)
      ) {
        setActiveProctorModal(null);
      }

      setStudentsData((prev) => {
        if (!prev || !prev.students) return prev;
        return {
          ...prev,
          students: prev.students.map((s) => {
            const isMatch =
              (s.guestId && (s.guestId === alert.guestId || s.guestId === alert.participantId)) ||
              (s.participantId && (s.participantId === alert.participantId || s.participantId === alert.guestId));
            if (isMatch) {
              return {
                ...s,
                status: dec === "fail" ? "disqualified" : dec === "lock" ? "locked" : "active",
                isDisqualified: dec === "fail",
              };
            }
            return s;
          }),
        };
      });
    } catch (err) {
      console.error("Failed to submit proctor decision from dashboard:", err);
    } finally {
      setDecisionSubmitting(false);
    }
  }

  // Socket.IO Proctoring Monitor on Host Dashboard
  useEffect(() => {
    if (!ready) return;
    const socket = getSocket();

    function joinRooms() {
      socket.emit("join-session", { linkId: "hosts", role: "host" });
      sessions.forEach((s) => {
        const ids = [s._id, s.activityId, s.linkId, s.linkCode].filter(Boolean);
        ids.forEach((id) => {
          socket.emit("join-session", { linkId: id, role: "host" });
        });
      });
    }

    joinRooms();
    socket.on("connect", joinRooms);

    function onProctorAlert(alert) {
      playUrgentHostAlarm();
      setProctorAlerts((prev) => [alert, ...prev.filter((a) => a.id !== alert.id && a.guestId !== alert.guestId)]);
      setActiveProctorModal(alert);
    }

    function onProctorDecision(payload) {
      setProctorAlerts((prev) =>
        prev.filter((a) => a.guestId !== payload.guestId && a.participantId !== payload.participantId)
      );
      if (
        activeProctorModal &&
        (activeProctorModal.guestId === payload.guestId || activeProctorModal.participantId === payload.participantId)
      ) {
        setActiveProctorModal(null);
      }
    }

    socket.on("quiz-proctor-alert", onProctorAlert);
    socket.on("quiz-proctor-decision", onProctorDecision);

    return () => {
      socket.off("connect", joinRooms);
      socket.off("quiz-proctor-alert", onProctorAlert);
      socket.off("quiz-proctor-decision", onProctorDecision);
    };
  }, [ready, sessions]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event) {
      if (testDropdownRef.current && !testDropdownRef.current.contains(event.target)) {
        setShowTestDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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

  async function handleCreateLiveSession(e) {
    e?.preventDefault();
    if (!newSession.title.trim()) {
      setSessionError("Please give the session a name.");
      return;
    }
    setStartingSession(true);
    setSessionError("");
    try {
      const { session } = await api.createSession(newSession);
      const { activity } = await api.createActivity(session._id, {
        title: session.title,
        type: "qa",
        difficulty: "medium",
        allowQa: sessionQa,
        questions: [],
      });
      await api.publishActivity(activity._id);
      setShowSessionModal(false);
      router.push(`/host/sessions/${session._id}/live?activity=${activity._id}`);
    } catch (err) {
      setSessionError(err.body?.errors?.title || err.message || "Failed to start live session.");
      setStartingSession(false);
    }
  }

  function openTestCreation(type) {
    setTestType(type);
    setTestMethod(null);
    setTestName("");
    setTestDifficulty("medium");
    setTestQa(true);
    setTestQuestionCount(5);
    setTestNotesTab("paste");
    setTestNotesText("");
    setTestFile(null);
    setTestError("");
    setShowTestModal(true);
  }

  async function handleCreateTest(e) {
    e?.preventDefault();
    if (!testName.trim()) {
      setTestError(`Please give the ${testType === "poll" ? "poll" : "quiz"} a name.`);
      return;
    }
    if (testMethod === "ai") {
      if (testNotesTab === "paste" && !testNotesText.trim()) {
        setTestError("Please add some notes or text to generate questions from.");
        return;
      }
      if (testNotesTab === "upload" && !testFile) {
        setTestError("Please choose a file to upload.");
        return;
      }
    }

    setCreatingTest(true);
    setTestError("");
    try {
      const { session } = await api.createSession({ title: testName.trim() });
      const { activity } = await api.createActivity(session._id, {
        title: testName.trim(),
        type: testType,
        difficulty: testDifficulty,
        allowQa: testQa,
      });

      if (testMethod === "ai") {
        if (testNotesTab === "upload") {
          await api.uploadNotesFile(activity._id, testFile);
        } else {
          await api.uploadNotesText(activity._id, testNotesText);
        }
        await api.generateQuestions(activity._id, "English", testQuestionCount);
      } else {
        await api.addQuestion(activity._id, 1);
      }

      setShowTestModal(false);
      router.push(`/host/sessions/${session._id}/review?activity=${activity._id}`);
    } catch (err) {
      setTestError(err.message || "Failed to create test.");
      setCreatingTest(false);
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

  const isLiveSession = (s) =>
    s.activityType === "qa" || (s.activityType !== "poll" && (s.questionCount === 0 || !s.questionCount));

  const liveSessions = sessions.filter(isLiveSession);
  const testSessions = sessions.filter((s) => !isLiveSession(s));
  const displayedSessions =
    filterTab === "live"
      ? liveSessions
      : filterTab === "test"
      ? testSessions
      : sessions;

  return (
    <main className="min-h-screen">
      <Navbar user={user} userName={user?.name} userEmail={user?.email} onLogout={logout} logoutLabel={t.logout_btn} />

      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Real-time Anti-Cheat Violation Modal for Host on Dashboard */}
        {activeProctorModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in">
            <div className="card w-full max-w-lg p-6 bg-white dark:bg-[#12142B] border-2 border-rose-500 shadow-2xl rounded-2xl relative">
              <div className="flex items-center justify-between pb-3 mb-4 border-b border-rose-500/30">
                <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
                  <span className="text-xl animate-bounce">🚨</span>
                  <h3 className="font-display font-black text-base uppercase tracking-wide">
                    Screen Switch Detected - Approval Required!
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveProctorModal(null)}
                  className="text-gray-400 hover:text-gray-600 text-sm font-bold p-1 cursor-pointer"
                >
                  ✕
                </button>
              </div>

              <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-900 dark:text-rose-200 mb-4">
                <div className="flex items-center justify-between text-xs mb-2 font-bold">
                  <span>Student: {activeProctorModal.displayName || "Participant"}</span>
                  <span className="font-mono text-[10px] bg-rose-500/20 px-2 py-0.5 rounded text-rose-600 dark:text-rose-300">
                    {activeProctorModal.timestamp ? new Date(activeProctorModal.timestamp).toLocaleTimeString() : "Just now"}
                  </span>
                </div>
                <div className="text-sm font-bold mb-1 text-gray-900 dark:text-gray-100">
                  {activeProctorModal.violationType === "screen_crop"
                    ? "Screen Cropping / Window Resize Attempt"
                    : activeProctorModal.violationType === "window_blur"
                    ? "Window Focus Lost / Switched Application"
                    : "Browser Tab Switched"}
                </div>
                <div className="text-xs text-gray-700 dark:text-gray-300 italic">
                  "{activeProctorModal.message}"
                </div>
              </div>

              <p className="text-xs text-gray-600 dark:text-gray-300 mb-5 leading-relaxed">
                The student switched away from their quiz window. Their quiz is currently <strong>paused & locked</strong> waiting for your decision. You have the option to allow {activeProctorModal.displayName} to continue the quiz or fail them.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  disabled={decisionSubmitting}
                  onClick={() => handleProctorDecision(activeProctorModal, "continue")}
                  className="btn-secondary py-3 px-4 rounded-xl font-bold text-xs flex flex-col items-center justify-center gap-1 border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 cursor-pointer shadow-sm transition-all"
                >
                  <div className="flex items-center gap-1.5 font-extrabold text-sm text-emerald-600 dark:text-emerald-400">
                    <span>✓</span> Allow {activeProctorModal.displayName || "Student"} to Continue Quiz
                  </div>
                  <span className="text-[10px] text-gray-500 dark:text-gray-400 font-normal">
                    Unlock quiz and let student continue
                  </span>
                </button>

                <button
                  type="button"
                  disabled={decisionSubmitting}
                  onClick={() => handleProctorDecision(activeProctorModal, "fail")}
                  className="btn-primary py-3 px-4 rounded-xl font-bold text-xs flex flex-col items-center justify-center gap-1 bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-700 hover:to-red-700 text-white border-0 shadow-md cursor-pointer transition-all"
                >
                  <div className="flex items-center gap-1.5 font-extrabold text-sm">
                    <span>🚫</span> Fail {activeProctorModal.displayName || "Student"}
                  </div>
                  <span className="text-[10px] text-rose-100 font-normal">
                    Disqualify student with 0% mark
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Persistent Screen Switch Alert Banner on Host Dashboard */}
        {proctorAlerts.length > 0 && (
          <div className="mb-6 p-4 sm:p-5 rounded-2xl bg-amber-500/15 dark:bg-amber-950/40 border-2 border-amber-500 text-amber-950 dark:text-amber-100 shadow-xl ring-4 ring-amber-500/20 animate-in fade-in">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <span className="text-3xl animate-bounce shrink-0">🔒</span>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-full bg-amber-500 text-white font-black text-[10px] uppercase tracking-wide">
                      Host Action Required
                    </span>
                    <h3 className="font-bold text-sm sm:text-base text-gray-900 dark:text-gray-100">
                      Screen Switch Detected - Student Quiz Paused!
                    </h3>
                  </div>
                  <p className="text-xs text-amber-800 dark:text-amber-300 mt-1">
                    Student switched screens or left the quiz window. Quiz is paused and waiting for your permission.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-end">
                {proctorAlerts.map((alert) => (
                  <div
                    key={alert.id || alert.guestId}
                    className="flex flex-wrap items-center gap-2 bg-white dark:bg-[#12142B] p-2.5 rounded-xl border border-amber-500/40 shadow-sm"
                  >
                    <span className="font-bold text-xs text-gray-900 dark:text-gray-100 px-1">
                      {alert.displayName}:
                    </span>
                    <button
                      type="button"
                      disabled={decisionSubmitting}
                      onClick={() => handleProctorDecision(alert, "continue")}
                      className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs shadow-sm transition-all flex items-center gap-1 cursor-pointer"
                      title={`Allow ${alert.displayName} to continue quiz`}
                    >
                      <span>✓</span> Allow {alert.displayName} to Continue Quiz
                    </button>
                    <button
                      type="button"
                      disabled={decisionSubmitting}
                      onClick={() => handleProctorDecision(alert, "fail")}
                      className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-extrabold text-xs shadow-sm transition-all flex items-center gap-1 cursor-pointer"
                      title={`Fail and disqualify ${alert.displayName}`}
                    >
                      <span>🚫</span> Fail {alert.displayName}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Top Header with Create Session and Create Test options */}
        <div className="flex flex-wrap justify-between items-center gap-4 mb-6">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="text-2xl">🎙️</span>
              <h1 className="font-display text-2xl font-bold">Host & Proctor Suite</h1>
              <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-primary/10 text-primary dark:text-indigo-300 border border-primary/20">
                Live Session Toolkit
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Manage your live interactive sessions, tests, and student assessments
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            {/* Option 1: Create Session */}
            <button
              type="button"
              onClick={() => {
                setNewSession({
                  title: "",
                  description: "",
                  date: new Date().toISOString().slice(0, 16),
                  status: "draft",
                });
                setSessionQa(true);
                setSessionError("");
                setShowSessionModal(true);
              }}
              className="btn-primary flex items-center gap-2 shadow-sm bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-700 hover:to-red-700 text-white border-0 px-4 py-2 text-sm font-semibold rounded-xl cursor-pointer transition-all hover:shadow-md"
              title="Start a real-time live session with screen sharing & live Q&A (no questions needed)"
            >
              <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
              <span>🎙️ Create Session</span>
            </button>

            {/* Option 2: Create Test with Dropdown (Create a Quiz / Create a Poll) */}
            <div className="relative" ref={testDropdownRef}>
              <button
                type="button"
                onClick={() => setShowTestDropdown((prev) => !prev)}
                className="btn-primary flex items-center gap-2 shadow-sm bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white border-0 px-4 py-2 text-sm font-semibold rounded-xl cursor-pointer transition-all hover:shadow-md"
                title="Create an assessment quiz or audience poll"
              >
                <span>📝 Create Test</span>
                <span className="text-[10px] opacity-75">▼</span>
              </button>

              {showTestDropdown && (
                <div className="absolute right-0 mt-2 w-64 bg-white dark:bg-[#12142B] border border-[#E1E1DC] dark:border-[#2A2E52] rounded-2xl shadow-2xl p-2 z-50 animate-in fade-in zoom-in-95 duration-100">
                  <div className="px-3 py-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                    Select Test Type
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowTestDropdown(false);
                      openTestCreation("quiz");
                    }}
                    className="w-full text-left p-3 rounded-xl hover:bg-gray-100 dark:hover:bg-[#1A1D36] transition-all flex items-start gap-2.5 cursor-pointer group"
                  >
                    <span className="text-xl">📝</span>
                    <div>
                      <div className="font-bold text-xs text-gray-900 dark:text-gray-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400">
                        Create a Quiz
                      </div>
                      <div className="text-[10px] text-gray-500 mt-0.5">
                        Graded questions, timer & scores (AI or manual)
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setShowTestDropdown(false);
                      openTestCreation("poll");
                    }}
                    className="w-full text-left p-3 rounded-xl hover:bg-gray-100 dark:hover:bg-[#1A1D36] transition-all flex items-start gap-2.5 cursor-pointer group"
                  >
                    <span className="text-xl">📊</span>
                    <div>
                      <div className="font-bold text-xs text-gray-900 dark:text-gray-100 group-hover:text-amber-500">
                        Create a Poll
                      </div>
                      <div className="text-[10px] text-gray-500 mt-0.5">
                        Live voting & audience sentiment (AI or manual)
                      </div>
                    </div>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Filter Tabs when sessions exist */}
        {!loading && sessions.length > 0 && (
          <div className="flex items-center gap-2 mb-4 pb-2 border-b border-[#E1E1DC] dark:border-[#2A2E52]">
            <button
              type="button"
              onClick={() => setFilterTab("all")}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-all cursor-pointer ${
                filterTab === "all"
                  ? "bg-gray-900 dark:bg-white text-white dark:text-gray-900 font-bold shadow-xs"
                  : "text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
              }`}
            >
              All ({sessions.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterTab("live")}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
                filterTab === "live"
                  ? "bg-rose-600 text-white font-bold shadow-xs"
                  : "text-gray-500 hover:text-rose-600 dark:hover:text-rose-400"
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
              <span>🎙️ Live Sessions ({liveSessions.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setFilterTab("test")}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
                filterTab === "test"
                  ? "bg-indigo-600 text-white font-bold shadow-xs"
                  : "text-gray-500 hover:text-indigo-600 dark:hover:text-indigo-400"
              }`}
            >
              <span>📝 Tests & Quizzes ({testSessions.length})</span>
            </button>
          </div>
        )}

        {loading ? (
          <div className="card p-12 text-center text-sm text-gray-400">Loading your sessions…</div>
        ) : sessions.length === 0 ? (
          <div className="card border-dashed p-10 text-center">
            <h2 className="font-display text-xl font-bold mb-2">Welcome to your Host Dashboard</h2>
            <p className="text-xs text-gray-500 mb-8 max-w-md mx-auto">
              Choose what you want to create to get started. You can host an instant live presentation or prepare a graded test for your participants.
            </p>
            <div className="grid sm:grid-cols-2 gap-4 max-w-xl mx-auto text-left">
              {/* Option 1: Create Session */}
              <div
                onClick={() => {
                  setNewSession({
                    title: "",
                    description: "",
                    date: new Date().toISOString().slice(0, 16),
                    status: "draft",
                  });
                  setSessionQa(true);
                  setSessionError("");
                  setShowSessionModal(true);
                }}
                className="p-5 rounded-2xl border-2 border-rose-500/20 hover:border-rose-500 bg-rose-500/5 hover:bg-rose-500/10 cursor-pointer transition-all flex flex-col justify-between group shadow-xs"
              >
                <div>
                  <div className="w-10 h-10 rounded-xl bg-rose-500 text-white flex items-center justify-center text-xl mb-3 shadow-sm group-hover:scale-110 transition-transform">
                    🎙️
                  </div>
                  <div className="font-display font-bold text-base text-gray-900 dark:text-gray-100 flex items-center gap-2">
                    Create Session
                    <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-600 dark:text-rose-400">Live</span>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5 leading-relaxed">
                    Start a real-time live session with screen sharing and live Q&A. <strong>No quiz questions needed</strong> — launch instantly in 1 click.
                  </p>
                </div>
                <div className="mt-4 text-xs font-bold text-rose-600 dark:text-rose-400 flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                  Launch Live Session →
                </div>
              </div>

              {/* Option 2: Create Test (Quiz / Poll) */}
              <div className="p-5 rounded-2xl border-2 border-indigo-500/20 hover:border-indigo-500 bg-indigo-500/5 transition-all flex flex-col justify-between shadow-xs">
                <div>
                  <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center text-xl mb-3 shadow-sm">
                    📝
                  </div>
                  <div className="font-display font-bold text-base text-gray-900 dark:text-gray-100 flex items-center gap-2">
                    Create Test
                    <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-600 dark:text-indigo-400">Quiz / Poll</span>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5 leading-relaxed">
                    Build a graded quiz or opinion poll. Choose between instant AI generation or writing questions manually.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-4">
                  <button
                    type="button"
                    onClick={() => openTestCreation("quiz")}
                    className="btn-secondary text-xs py-2 px-2.5 font-bold text-indigo-600 dark:text-indigo-400 border-indigo-500/30 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 cursor-pointer flex items-center justify-center gap-1"
                  >
                    <span>📝 Create Quiz</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => openTestCreation("poll")}
                    className="btn-secondary text-xs py-2 px-2.5 font-bold text-amber-600 dark:text-amber-400 border-amber-500/30 hover:bg-amber-50 dark:hover:bg-amber-950/30 cursor-pointer flex items-center justify-center gap-1"
                  >
                    <span>📊 Create Poll</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : displayedSessions.length === 0 ? (
          <div className="card p-10 text-center text-sm text-gray-500">
            No {filterTab === "live" ? "live sessions" : "tests"} found.
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {displayedSessions.map((s) => {
              const isLive = isLiveSession(s);
              return (
                <div key={s._id} className="card p-5 flex flex-col justify-between hover:border-primary/50 transition-all shadow-sm">
                  <div>
                    <div className="flex justify-between items-start gap-2 mb-2">
                      <Link
                        href={isLive && s.activityId ? `/host/sessions/${s._id}/live?activity=${s.activityId}` : `/host/sessions/${s._id}/review`}
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

                    {/* Mode Badge */}
                    <div className="mb-2.5">
                      {isLive ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                          <span>🎙️ Live Session</span>
                        </span>
                      ) : s.activityType === "poll" ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                          <span>📊 Poll ({s.questionCount || 0} Questions)</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
                          <span>📝 Test ({s.questionCount || 0} Questions)</span>
                        </span>
                      )}
                    </div>

                    {s.description && (
                      <p className="text-xs text-gray-500 line-clamp-2 mb-3">{s.description}</p>
                    )}

                    <div className="flex flex-wrap items-center gap-2 text-[11px] mb-3">
                      <span className="text-gray-400">
                        📅 {s.date ? new Date(s.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "No date"}
                      </span>
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
                          className="text-[11px] text-gray-500 hover:text-primary font-medium flex items-center gap-1 cursor-pointer"
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
                    <div className="flex items-center gap-2">
                      {isLive ? (
                        <Link
                          href={s.activityId ? `/host/sessions/${s._id}/live?activity=${s.activityId}` : `/host/sessions/${s._id}/review`}
                          className="btn-primary text-xs bg-rose-600 hover:bg-rose-700 text-white border-rose-500 font-bold px-3 py-1 rounded-lg flex items-center gap-1 shadow-xs"
                        >
                          <span>🎙️ Enter Live Room 🚀</span>
                        </Link>
                      ) : (
                        <>
                          <Link
                            href={s.activityId ? `/host/sessions/${s._id}/review?activity=${s.activityId}` : `/host/sessions/${s._id}/review`}
                            className="text-xs text-primary font-medium hover:underline flex items-center gap-1"
                          >
                            Manage Questions →
                          </Link>
                          {s.activityId && (
                            <Link
                              href={`/host/sessions/${s._id}/live?activity=${s.activityId}`}
                              className="text-xs text-indigo-600 dark:text-indigo-400 font-semibold hover:underline flex items-center gap-1"
                            >
                              Live Monitor 📊
                            </Link>
                          )}
                        </>
                      )}

                      {s.activityId && (
                        <button
                          type="button"
                          onClick={() => openStudentsModal(s)}
                          className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold hover:underline flex items-center gap-1 cursor-pointer"
                        >
                          👥 Students ({s.completedCount || 0})
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="text-xs text-gray-500 hover:text-primary px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer"
                        onClick={() => openEditModal(s)}
                      >
                        ✏️ Edit
                      </button>

                      {confirmDeleteId === s._id ? (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            className="text-xs text-red-600 font-semibold px-2 py-1 rounded bg-red-50 hover:bg-red-100 dark:bg-red-950/40 cursor-pointer"
                            disabled={deletingId === s._id}
                            onClick={() => confirmDelete(s._id)}
                          >
                            {deletingId === s._id ? "Deleting…" : "Confirm"}
                          </button>
                          <button
                            type="button"
                            className="text-xs text-gray-400 hover:text-gray-600 px-1 py-1 cursor-pointer"
                            disabled={deletingId === s._id}
                            onClick={() => setConfirmDeleteId(null)}
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="text-xs text-gray-400 hover:text-red-500 px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-950/20 cursor-pointer"
                          onClick={() => setConfirmDeleteId(s._id)}
                        >
                          🗑️ Delete
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* DEDICATED CREATE SESSION MODAL (ONLY SESSION OPTIONS - ZERO TEST-RELATED OPTIONS) */}
        {showSessionModal && (
          <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
            <div className="card max-w-md w-full p-5 sm:p-6 shadow-xl rounded-2xl animate-in fade-in zoom-in-95 duration-150 my-auto max-h-[90vh] flex flex-col overflow-hidden">
              <div className="flex justify-between items-center pb-3 border-b border-[#E1E1DC] dark:border-[#2A2E52] shrink-0 mb-3">
                <h2 className="font-display font-bold text-lg flex items-center gap-2 text-gray-900 dark:text-gray-100">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse" />
                  <span>Create Live Session</span>
                </h2>
                <button
                  type="button"
                  className="text-gray-400 hover:text-gray-600 text-sm cursor-pointer p-1"
                  onClick={() => setShowSessionModal(false)}
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleCreateLiveSession} className="flex flex-col flex-1 min-h-0">
                <div className="overflow-y-auto flex-1 pr-1 space-y-3">
                  <p className="text-xs text-gray-500 mb-2 leading-relaxed">
                    Launch an instant live session with screen sharing and live Q&A. No quiz or test questions required.
                  </p>

                  <div>
                    <label className="label">Session Name *</label>
                    <input
                      className="field"
                      placeholder="e.g. Live Class, Team Presentation, Workshop"
                      value={newSession.title}
                      autoFocus
                      onChange={(e) => setNewSession({ ...newSession, title: e.target.value })}
                    />
                  </div>

                  <div>
                    <label className="label">Description (Optional)</label>
                    <textarea
                      className="field"
                      rows={2}
                      placeholder="Brief agenda or session topic..."
                      value={newSession.description}
                      onChange={(e) => setNewSession({ ...newSession, description: e.target.value })}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
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

                  <div>
                    <label className="label">Live Participant Q&A</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setSessionQa(true)}
                        className={`p-2.5 rounded-xl border text-xs text-left transition-all cursor-pointer ${
                          sessionQa
                            ? "border-emerald-500 bg-emerald-500/10 text-emerald-600 font-bold ring-1 ring-emerald-500/30"
                            : "border-[#E1E1DC] dark:border-[#2A2E52] text-gray-500 opacity-80 hover:opacity-100"
                        }`}
                      >
                        <div className="font-semibold text-emerald-600 dark:text-emerald-400">✓ Q&A Enabled</div>
                        <div className="text-[10px] text-gray-400 mt-0.5">Students can ask questions</div>
                      </button>
                      <button
                        type="button"
                        onClick={() => setSessionQa(false)}
                        className={`p-2.5 rounded-xl border text-xs text-left transition-all cursor-pointer ${
                          !sessionQa
                            ? "border-primary bg-primary/10 font-bold ring-1 ring-primary/30"
                            : "border-[#E1E1DC] dark:border-[#2A2E52] text-gray-500 opacity-80 hover:opacity-100"
                        }`}
                      >
                        <div className="text-gray-900 dark:text-gray-100 font-semibold">✕ Q&A Disabled</div>
                        <div className="text-[10px] text-gray-400 mt-0.5">Screen sharing only</div>
                      </button>
                    </div>
                  </div>

                  {sessionError && <div className="error-text text-xs">{sessionError}</div>}
                </div>

                <div className="flex items-center justify-end gap-2 pt-3 mt-3 border-t border-[#E1E1DC] dark:border-[#2A2E52] shrink-0">
                  <button
                    type="button"
                    className="btn-secondary text-xs cursor-pointer"
                    onClick={() => setShowSessionModal(false)}
                    disabled={startingSession}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-primary bg-rose-600 hover:bg-rose-700 text-white border-rose-500 text-xs font-bold cursor-pointer shadow-sm disabled:opacity-60"
                    disabled={startingSession}
                  >
                    {startingSession ? "Starting Live Session…" : "🔴 Start Live Session Now 🚀"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* DEDICATED CREATE TEST MODAL (QUIZ / POLL -> AI OR MANUAL) */}
        {showTestModal && (
          <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
            <div className="card max-w-lg w-full p-5 sm:p-6 shadow-xl rounded-2xl animate-in fade-in zoom-in-95 duration-150 my-auto max-h-[90vh] flex flex-col overflow-hidden">
              <div className="flex justify-between items-center pb-3 border-b border-[#E1E1DC] dark:border-[#2A2E52] shrink-0 mb-4">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{testType === "poll" ? "📊" : "📝"}</span>
                  <h2 className="font-display font-bold text-lg text-gray-900 dark:text-gray-100">
                    {testMethod === null
                      ? `Create ${testType === "poll" ? "Poll" : "Quiz"}`
                      : testMethod === "ai"
                      ? `Generate ${testType === "poll" ? "Poll" : "Quiz"} with AI ✨`
                      : `Create ${testType === "poll" ? "Poll" : "Quiz"} Manually ✍️`}
                  </h2>
                </div>
                <button
                  type="button"
                  className="text-gray-400 hover:text-gray-600 text-sm cursor-pointer p-1"
                  onClick={() => setShowTestModal(false)}
                >
                  ✕
                </button>
              </div>

              {/* Stage 1: Choose between AI or Manual if not chosen yet */}
              {testMethod === null ? (
                <div className="overflow-y-auto flex-1 space-y-4 pr-1">
                  <div className="flex items-center justify-between pb-3 border-b border-[#E1E1DC] dark:border-[#2A2E52]">
                    <span className="text-xs text-gray-500">
                      Feature: <strong className="capitalize text-gray-900 dark:text-gray-100">{testType}</strong>
                    </span>
                    <button
                      type="button"
                      onClick={() => setTestType(testType === "quiz" ? "poll" : "quiz")}
                      className="text-xs text-primary font-semibold hover:underline cursor-pointer"
                    >
                      Switch to {testType === "quiz" ? "Poll 📊" : "Quiz 📝"}
                    </button>
                  </div>

                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    How would you like to create your {testType === "poll" ? "poll questions" : "quiz questions"}?
                  </p>

                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setTestMethod("ai")}
                      className="p-4 rounded-xl border border-[#E1E1DC] dark:border-[#2A2E52] hover:border-primary/50 hover:bg-primary/5 text-left transition-all cursor-pointer group shadow-2xs"
                    >
                      <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center text-lg mb-2 group-hover:scale-110 transition-transform">
                        ✨
                      </div>
                      <div className="font-display font-bold text-sm text-gray-900 dark:text-gray-100 group-hover:text-primary">
                        Generate with AI
                      </div>
                      <div className="text-[11px] text-gray-500 mt-1 leading-relaxed">
                        Paste notes or upload a PDF to auto-create questions & answers instantly.
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setTestMethod("manual")}
                      className="p-4 rounded-xl border border-[#E1E1DC] dark:border-[#2A2E52] hover:border-primary/50 hover:bg-primary/5 text-left transition-all cursor-pointer group shadow-2xs"
                    >
                      <div className="w-8 h-8 rounded-lg bg-indigo-500/10 text-indigo-600 flex items-center justify-center text-lg mb-2 group-hover:scale-110 transition-transform">
                        ✍️
                      </div>
                      <div className="font-display font-bold text-sm text-gray-900 dark:text-gray-100 group-hover:text-indigo-600">
                        Create Manually
                      </div>
                      <div className="text-[11px] text-gray-500 mt-1 leading-relaxed">
                        Write questions, choices, timer, and correct answers step-by-step.
                      </div>
                    </button>
                  </div>
                </div>
              ) : (
                /* Stage 2: Form for AI or Manual */
                <form onSubmit={handleCreateTest} className="flex flex-col flex-1 min-h-0">
                  <div className="overflow-y-auto flex-1 space-y-4 pr-1">
                    <div className="flex items-center justify-between pb-2 border-b border-[#E1E1DC] dark:border-[#2A2E52]">
                      <button
                        type="button"
                        onClick={() => setTestMethod(null)}
                        className="text-xs text-primary font-semibold hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        ← Back to Choose Method
                      </button>
                      <span className="text-[11px] text-gray-400 capitalize">
                        {testType} • {testMethod === "ai" ? "AI Generated" : "Manual Authoring"}
                      </span>
                    </div>

                    <div>
                      <label className="label">{testType === "poll" ? "Poll Title *" : "Quiz Title *"}</label>
                      <input
                        className="field"
                        placeholder={testType === "poll" ? "e.g. Session Feedback Poll" : "e.g. Full-Stack Web Development Quiz 1"}
                        value={testName}
                        autoFocus
                        onChange={(e) => setTestName(e.target.value)}
                      />
                    </div>

                    {testType === "quiz" && (
                      <div>
                        <label className="label">Difficulty</label>
                        <div className="flex gap-2">
                          {["easy", "medium", "hard"].map((d) => (
                            <button
                              type="button"
                              key={d}
                              onClick={() => setTestDifficulty(d)}
                              className={`flex-1 py-1.5 rounded-lg border text-xs capitalize cursor-pointer transition-all ${
                                testDifficulty === d
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

                    {testMethod === "ai" && (
                      <>
                        <div>
                          <label className="label">
                            Number of Questions: <strong className="text-primary">{testQuestionCount}</strong>
                          </label>
                          <div className="flex items-center gap-3">
                            <input
                              type="range"
                              min={1}
                              max={20}
                              step={1}
                              value={testQuestionCount}
                              onChange={(e) => setTestQuestionCount(Number(e.target.value))}
                              className="flex-1 cursor-pointer"
                            />
                            <input
                              type="number"
                              min={1}
                              max={20}
                              value={testQuestionCount}
                              onChange={(e) => {
                                const n = Number(e.target.value);
                                if (Number.isFinite(n)) setTestQuestionCount(Math.min(20, Math.max(1, n)));
                              }}
                              className="field w-16 text-center py-1 text-xs"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="label">Notes / Source Material *</label>
                          <div className="flex bg-[#F5F5F2] dark:bg-[#0E1020] rounded-lg p-1 border border-[#E1E1DC] dark:border-[#2A2E52] mb-2 w-fit">
                            <button
                              type="button"
                              onClick={() => setTestNotesTab("paste")}
                              className={`text-xs px-3 py-1 rounded-md cursor-pointer transition-all ${
                                testNotesTab === "paste" ? "bg-primary text-white font-semibold" : "text-gray-500"
                              }`}
                            >
                              Paste Text
                            </button>
                            <button
                              type="button"
                              onClick={() => setTestNotesTab("upload")}
                              className={`text-xs px-3 py-1 rounded-md cursor-pointer transition-all ${
                                testNotesTab === "upload" ? "bg-primary text-white font-semibold" : "text-gray-500"
                              }`}
                            >
                              Upload File
                            </button>
                          </div>

                          {testNotesTab === "paste" ? (
                            <textarea
                              className="field text-xs"
                              rows={4}
                              placeholder="Paste lecture notes, study guide, or topic notes here..."
                              value={testNotesText}
                              onChange={(e) => setTestNotesText(e.target.value)}
                            />
                          ) : (
                            <div className="card border-dashed p-4 text-center">
                              <input
                                type="file"
                                accept=".pdf,.docx,.txt,.md"
                                onChange={(e) => setTestFile(e.target.files?.[0] || null)}
                                className="hidden"
                                id="dashboard-test-file-input"
                              />
                              <label htmlFor="dashboard-test-file-input" className="btn-secondary inline-block cursor-pointer text-xs py-1.5 px-3">
                                Choose File (.pdf, .txt, .docx)
                              </label>
                              {testFile && <div className="text-xs mt-1.5 font-mono font-bold text-primary">{testFile.name}</div>}
                            </div>
                          )}
                        </div>
                      </>
                    )}

                    <div>
                      <label className="label">Participant Q&A</label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setTestQa(true)}
                          className={`p-2 rounded-xl border text-left text-xs transition-all cursor-pointer ${
                            testQa
                              ? "border-emerald-500 bg-emerald-500/10 font-bold text-emerald-600 ring-1 ring-emerald-500/30"
                              : "border-[#E1E1DC] dark:border-[#2A2E52] text-gray-400 opacity-75"
                          }`}
                        >
                          <div className="font-semibold text-emerald-600 dark:text-emerald-400">✓ Enabled</div>
                          <div className="text-[10px] text-gray-500">Students can ask questions</div>
                        </button>
                        <button
                          type="button"
                          onClick={() => setTestQa(false)}
                          className={`p-2 rounded-xl border text-left text-xs transition-all cursor-pointer ${
                            !testQa
                              ? "border-primary bg-primary/10 font-bold text-primary ring-1 ring-primary/30"
                              : "border-[#E1E1DC] dark:border-[#2A2E52] text-gray-400 opacity-75"
                          }`}
                        >
                          <div className="font-semibold text-gray-900 dark:text-gray-100">✕ Disabled</div>
                          <div className="text-[10px] text-gray-500">{testType === "poll" ? "Poll" : "Quiz"} questions only</div>
                        </button>
                      </div>
                    </div>

                    {testError && <div className="error-text text-xs">{testError}</div>}
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-3 mt-3 border-t border-[#E1E1DC] dark:border-[#2A2E52] shrink-0">
                    <button
                      type="button"
                      className="btn-secondary text-xs cursor-pointer"
                      onClick={() => setShowTestModal(false)}
                      disabled={creatingTest}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={creatingTest}
                      className="btn-primary text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white border-0 cursor-pointer shadow-sm disabled:opacity-60"
                    >
                      {creatingTest
                        ? "Processing…"
                        : testMethod === "ai"
                        ? `✨ Generate ${testType === "poll" ? "Poll" : "Quiz"} with AI 🚀`
                        : `✍️ Create & Add Questions →`}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        )}

        {/* EDIT SESSION MODAL */}
        {editingSession && (
          <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
            <div className="card max-w-md w-full p-5 sm:p-6 shadow-xl rounded-2xl animate-in fade-in zoom-in-95 duration-150 my-auto max-h-[90vh] flex flex-col overflow-hidden">
              <div className="flex justify-between items-center pb-3 border-b border-[#E1E1DC] dark:border-[#2A2E52] shrink-0 mb-3">
                <h2 className="font-display font-bold text-lg">Edit Session</h2>
                <button
                  type="button"
                  className="text-gray-400 hover:text-gray-600 text-sm cursor-pointer p-1"
                  onClick={closeEditModal}
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleSaveEdit} className="flex flex-col flex-1 min-h-0">
                <div className="overflow-y-auto flex-1 pr-1 space-y-3">
                  <div>
                    <label className="label">Session Name *</label>
                    <input
                      className="field"
                      value={editForm.title}
                      autoFocus
                      onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                    />
                  </div>

                  <div>
                    <label className="label">Description</label>
                    <textarea
                      className="field"
                      rows={2}
                      value={editForm.description}
                      onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
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

                  {editError && <div className="error-text text-xs">{editError}</div>}
                </div>

                <div className="flex items-center justify-end gap-2 pt-3 mt-3 border-t border-[#E1E1DC] dark:border-[#2A2E52] shrink-0">
                  <button
                    type="button"
                    className="btn-secondary text-xs cursor-pointer"
                    onClick={closeEditModal}
                    disabled={savingEdit}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary text-xs font-bold" disabled={savingEdit}>
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

                                  {/* Right: Status, Proctor Controls and Marks */}
                                  <div className="flex items-center gap-2">
                                    {student.status === "locked" ||
                                    (!student.isDone &&
                                      proctorAlerts.some(
                                        (a) =>
                                          (a.guestId && a.guestId === student.guestId) ||
                                          (a.participantId && a.participantId === student.participantId)
                                      )) ? (
                                      <div className="flex items-center gap-2">
                                        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/40 animate-pulse">
                                          🔒 Screen Switched
                                        </span>
                                        <button
                                          type="button"
                                          disabled={decisionSubmitting}
                                          onClick={() =>
                                            handleProctorDecision(
                                              {
                                                participantId: student.participantId,
                                                guestId: student.guestId,
                                                displayName: student.displayName,
                                                activityId: selectedSessionForStudents?.activityId,
                                                linkId: selectedSessionForStudents?.linkId,
                                              },
                                              "continue"
                                            )
                                          }
                                          className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-[11px] shadow-sm transition-all flex items-center gap-1 cursor-pointer"
                                          title={`Allow ${student.displayName} to continue quiz`}
                                        >
                                          <span>✓</span> Allow {student.displayName} to Continue Quiz
                                        </button>
                                        <button
                                          type="button"
                                          disabled={decisionSubmitting}
                                          onClick={() =>
                                            handleProctorDecision(
                                              {
                                                participantId: student.participantId,
                                                guestId: student.guestId,
                                                displayName: student.displayName,
                                                activityId: selectedSessionForStudents?.activityId,
                                                linkId: selectedSessionForStudents?.linkId,
                                              },
                                              "fail"
                                            )
                                          }
                                          className="px-2 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-[11px] shadow-sm transition-all flex items-center gap-1 cursor-pointer"
                                          title={`Fail ${student.displayName}`}
                                        >
                                          <span>🚫</span> Fail
                                        </button>
                                      </div>
                                    ) : student.isDone ? (
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

