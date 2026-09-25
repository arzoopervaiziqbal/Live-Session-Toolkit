"use client";
import { useEffect, useState, useRef } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import Navbar from "../../../../../components/Navbar";
import { useLang } from "../../../../../contexts/LangContext";
import { useAuthGuard } from "../../../../../lib/useAuthGuard";
import { api, API_URL, getToken } from "../../../../../lib/api";
import { getSocket, RTC_CONFIG } from "../../../../../lib/socket";

function parseQaFeed(feed) {
  if (!feed) return [];
  if (Array.isArray(feed)) return feed;
  if (typeof feed === "string") {
    try {
      const parsed = JSON.parse(feed);
      if (Array.isArray(parsed)) return parsed;
    } catch (_) {}
  }
  return [];
}

export default function LivePage() {
  const { t } = useLang();
  const { user, logout, ready } = useAuthGuard("host", "/host/login");
  const searchParams = useSearchParams();
  const params = useParams();
  const router = useRouter();
  const activityId = searchParams.get("activity");

  const [results, setResults] = useState(null);
  const [copied, setCopied] = useState(false);
  const [filter, setFilter] = useState("all"); // 'all' | 'done' | 'pending'
  const [searchQuery, setSearchQuery] = useState("");
  const [qaAnswerDrafts, setQaAnswerDrafts] = useState({});
  const [answeringId, setAnsweringId] = useState(null);
  const [qaFilter, setQaFilter] = useState("all"); // 'all' | 'unanswered' | 'answered'
  const [togglingQa, setTogglingQa] = useState(false);

  // Screen Sharing State
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [viewerCount, setViewerCount] = useState(0);
  const [screenPreviewExpanded, setScreenPreviewExpanded] = useState(false);
  const [hostQaToast, setHostQaToast] = useState(null);
  const hostToastTimerRef = useRef(null);

  // Anti-Cheat Proctoring Alerts State
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

  function playHostChime() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(523.25, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(783.99, ctx.currentTime + 0.12);
        gain.gain.setValueAtTime(0.18, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.35);
      }
    } catch (_) {}
  }

  function showHostQaToast(item) {
    if (hostToastTimerRef.current) clearTimeout(hostToastTimerRef.current);
    setHostQaToast({
      id: item?.id || Date.now(),
      sender: item?.participantName || item?.displayName || "Participant",
      text: item?.text || item?.questionText || "Question submitted",
    });
    hostToastTimerRef.current = setTimeout(() => {
      setHostQaToast(null);
    }, 7000);
  }

  // WebRTC & Media Stream Refs
  const localStreamRef = useRef(null);
  const peerConnectionsRef = useRef(new Map()); // participantSocketId -> RTCPeerConnection
  const pendingCandidatesMapRef = useRef(new Map()); // participantSocketId -> RTCIceCandidate[]
  const hostVideoRef = useRef(null);
  const frameIntervalRef = useRef(null);

  useEffect(() => {
    if (!ready || !activityId) return;
    let isMounted = true;

    async function poll() {
      try {
        const data = await api.getResults(activityId);
        if (isMounted) setResults(data);
      } catch (err) {
        console.error("Error polling results:", err);
      }
    }

    poll();
    const interval = setInterval(poll, 3000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [ready, activityId]);

  // Real-time Socket.IO Connection & WebRTC Signaling
  useEffect(() => {
    const socket = getSocket();
    const linkId = results?.activity?.linkId;
    const actId = results?.activity?._id || activityId;
    const sessId = results?.activity?.sessionId || params?.id;

    function joinRoom() {
      const roomIds = new Set([linkId, actId, sessId, params?.id, activityId].filter(Boolean));
      roomIds.forEach((rid) => {
        socket.emit("join-session", {
          linkId: rid,
          role: "host",
        });
      });
    }

    joinRoom();
    socket.on("connect", joinRoom);

    socket.on("viewer-count-update", ({ count }) => {
      setViewerCount(count || 0);
    });

    // Real-time Q&A push from participants
    socket.on("qa-new-question", ({ item, qaFeed }) => {
      setResults((prev) => {
        if (!prev) return prev;
        const currentFeed = parseQaFeed(prev.activity?.qaFeed);
        const incomingFeed = qaFeed ? parseQaFeed(qaFeed) : null;
        const exists = item?.id ? currentFeed.some((q) => q.id === item.id) : false;
        const updatedFeed = incomingFeed || (exists ? currentFeed : [...currentFeed, item]);
        return {
          ...prev,
          activity: { ...prev.activity, qaFeed: updatedFeed },
        };
      });

      playHostChime();
      if (item) {
        showHostQaToast(item);
      }
    });

    // Real-time Q&A status update
    socket.on("qa-updated", ({ allowQa }) => {
      setResults((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          activity: { ...prev.activity, allowQa: Boolean(allowQa) },
        };
      });
    });

    // Anti-Cheat / Proctor Alert from student (tab switch, blur, crop/resize)
    socket.on("quiz-proctor-alert", (alert) => {
      playUrgentHostAlarm();
      setProctorAlerts((prev) => [alert, ...prev.filter((a) => a.id !== alert.id)]);
      setActiveProctorModal(alert);

      // Increment student violation count in local results and mark status locked
      setResults((prev) => {
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
                status: s.status === "disqualified" ? "disqualified" : "locked",
                violationCount: (s.violationCount || 0) + 1,
              };
            }
            return s;
          }),
        };
      });
    });

    // WebRTC: Participant requests host's screen stream
    socket.on("screen-share-participant-ready", async ({ participantSocketId }) => {
      if (!localStreamRef.current) return;
      try {
        const pc = new RTCPeerConnection(RTC_CONFIG);
        peerConnectionsRef.current.set(participantSocketId, pc);

        localStreamRef.current.getTracks().forEach((track) => {
          pc.addTrack(track, localStreamRef.current);
        });

        pc.onicecandidate = (event) => {
          if (event.candidate) {
            socket.emit("screen-share-ice", {
              targetSocketId: participantSocketId,
              candidate: event.candidate,
            });
          }
        };

        pc.onconnectionstatechange = () => {
          if (
            pc.connectionState === "disconnected" ||
            pc.connectionState === "failed" ||
            pc.connectionState === "closed"
          ) {
            peerConnectionsRef.current.delete(participantSocketId);
          }
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        socket.emit("screen-share-offer", {
          targetSocketId: participantSocketId,
          offer,
        });
      } catch (err) {
        console.error("Error creating WebRTC offer for participant:", err);
      }
    });

    socket.on("screen-share-answer", async ({ participantSocketId, answer }) => {
      const pc = peerConnectionsRef.current.get(participantSocketId);
      if (pc && answer) {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
          // Flush any queued ICE candidates for this participant
          const queue = pendingCandidatesMapRef.current.get(participantSocketId) || [];
          while (queue.length > 0) {
            const cand = queue.shift();
            try {
              await pc.addIceCandidate(new RTCIceCandidate(cand));
            } catch (e) {}
          }
        } catch (err) {
          console.error("Failed to set remote description answer:", err);
        }
      }
    });

    socket.on("screen-share-ice", async ({ fromSocketId, candidate }) => {
      const pc = peerConnectionsRef.current.get(fromSocketId);
      if (pc && candidate) {
        try {
          if (pc.remoteDescription && pc.remoteDescription.type) {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } else {
            const queue = pendingCandidatesMapRef.current.get(fromSocketId) || [];
            queue.push(candidate);
            pendingCandidatesMapRef.current.set(fromSocketId, queue);
          }
        } catch (err) {
          console.error("Failed to add ICE candidate:", err);
        }
      }
    });

    return () => {
      socket.off("connect", joinRoom);
      socket.off("viewer-count-update");
      socket.off("qa-new-question");
      socket.off("qa-updated");
      socket.off("screen-share-participant-ready");
      socket.off("screen-share-answer");
      socket.off("screen-share-ice");
      socket.off("quiz-proctor-alert");
    };
  }, [results?.activity?.linkId, results?.activity?._id, activityId, params?.id]);

  // Cleanup media streams on unmount
  useEffect(() => {
    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (frameIntervalRef.current) {
        clearInterval(frameIntervalRef.current);
      }
      peerConnectionsRef.current.forEach((pc) => pc.close());
      peerConnectionsRef.current.clear();
    };
  }, []);

  if (!ready || !results) {
    return (
      <main className="min-h-screen">
        <Navbar userName={user?.name} onLogout={logout} logoutLabel={t.logout_btn} />
        <div className="max-w-4xl mx-auto px-6 py-16 text-center text-sm text-gray-400">
          Loading live session data…
        </div>
      </main>
    );
  }

  const link = `${typeof window !== "undefined" ? window.location.origin : ""}/participant/join?code=${results.activity.linkId}`;

  function copyLink() {
    navigator.clipboard?.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function handleProctorDecision(alert, decision) {
    const targetActId = activityId || results?.activity?._id;
    if (!alert || !targetActId || decisionSubmitting) return;
    setDecisionSubmitting(true);
    const dec = decision === "approve" ? "continue" : decision;
    try {
      await api.submitProctorDecision(targetActId, {
        participantId: alert.participantId,
        guestId: alert.guestId,
        decision: dec,
        reason:
          dec === "fail"
            ? `Disqualified by host for ${alert.violationType === "screen_crop" ? "screen cropping/resizing" : "switching tabs"} during the quiz.`
            : undefined,
      });

      const socket = getSocket();
      socket.emit("quiz-proctor-decision", {
        linkId: results?.activity?.linkId,
        activityId: targetActId,
        sessionId: results?.activity?.sessionId || params?.id,
        participantId: alert.participantId,
        guestId: alert.guestId,
        displayName: alert.displayName,
        decision: dec,
        reason:
          dec === "fail"
            ? `Disqualified by host for ${alert.violationType === "screen_crop" ? "screen cropping/resizing" : "switching tabs"} during the quiz.`
            : undefined,
      });

      setResults((prev) => {
        if (!prev || !prev.students) return prev;
        return {
          ...prev,
          students: prev.students.map((s) => {
            const isMatch =
              (s.guestId && (s.guestId === alert.guestId || s.guestId === alert.participantId)) ||
              (s.participantId && (s.participantId === alert.participantId || s.participantId === alert.guestId));
            if (isMatch) {
              const newStatus =
                dec === "fail" ? "disqualified" : dec === "lock" ? "locked" : "active";
              return {
                ...s,
                status: newStatus,
                isDisqualified: dec === "fail",
                score: dec === "fail" ? { ...s.score, correct: 0, percentage: 0 } : s.score,
              };
            }
            return s;
          }),
        };
      });

      setProctorAlerts((prev) =>
        prev.filter((a) => a.guestId !== alert.guestId && a.participantId !== alert.participantId && a.id !== alert.id)
      );
      setActiveProctorModal(null);
    } catch (err) {
      console.error("Failed to submit proctor decision:", err);
    } finally {
      setDecisionSubmitting(false);
    }
  }

  function handleExportCsv() {
    const token = getToken("host");
    const exportUrl = `${API_URL}/activities/${activityId}/export`;
    // Trigger download with auth header via fetch blob
    fetch(exportUrl, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.blob())
      .then((blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `session-${results.activity.linkId}-results.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      })
      .catch((err) => console.error("Export failed", err));
  }

  async function handleToggleQaPermission() {
    if (!results?.activity?._id || togglingQa) return;
    const newStatus = !results.activity.allowQa;
    setTogglingQa(true);
    try {
      setResults((prev) => ({
        ...prev,
        activity: { ...prev.activity, allowQa: newStatus },
      }));

      await api.toggleQa(results.activity._id, newStatus);
      getSocket().emit("qa-toggle", { linkId: results.activity.linkId, allowQa: newStatus });
    } catch (err) {
      console.error("Failed to toggle Q&A:", err);
      setResults((prev) => ({
        ...prev,
        activity: { ...prev.activity, allowQa: !newStatus },
      }));
    } finally {
      setTogglingQa(false);
    }
  }

  async function startScreenShare() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: "always" },
        audio: false,
      });

      localStreamRef.current = stream;
      if (hostVideoRef.current) {
        hostVideoRef.current.srcObject = stream;
        hostVideoRef.current.play().catch(() => {});
      }
      setIsScreenSharing(true);

      const socket = getSocket();
      socket.emit("screen-share-start", { linkId: results.activity.linkId });

      const track = stream.getVideoTracks()[0];
      if (track) {
        track.onended = () => {
          stopScreenShare();
        };
      }

      startCanvasFallback(stream);
    } catch (err) {
      console.warn("Screen share cancelled or not allowed:", err);
    }
  }

  function startCanvasFallback(stream) {
    if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
    const canvas = document.createElement("canvas");

    // Primary: Track ImageCapture if available (Native hardware accelerated in Chromium)
    let imageCapture = null;
    try {
      const track = stream.getVideoTracks()[0];
      if (typeof window !== "undefined" && "ImageCapture" in window && track) {
        imageCapture = new ImageCapture(track);
      }
    } catch (_) {}

    // Secondary fallback: in-memory video element
    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    video.srcObject = stream;
    video.play().catch(() => {});

    async function captureAndEmitFrame() {
      if (!localStreamRef.current) return;

      // 1. Try ImageCapture first (fastest, guaranteed frames)
      if (imageCapture) {
        try {
          const bitmap = await imageCapture.grabFrame();
          if (bitmap && bitmap.width > 0 && bitmap.height > 0) {
            const maxWidth = 1280;
            const scale = Math.min(1, maxWidth / bitmap.width);
            canvas.width = Math.round(bitmap.width * scale);
            canvas.height = Math.round(bitmap.height * scale);
            const ctx = canvas.getContext("2d");
            if (ctx) {
              ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
              const base64 = canvas.toDataURL("image/jpeg", 0.65);
              getSocket().emit("screen-frame", { linkId: results.activity.linkId, frame: base64 });
              return;
            }
          }
        } catch (_) {}
      }

      // 2. Try drawing from hostVideoRef.current or video element
      const v = hostVideoRef.current && hostVideoRef.current.videoWidth > 0 ? hostVideoRef.current : video;
      if (v && v.videoWidth > 0 && v.videoHeight > 0) {
        const maxWidth = 1280;
        const scale = Math.min(1, maxWidth / v.videoWidth);
        canvas.width = Math.round(v.videoWidth * scale);
        canvas.height = Math.round(v.videoHeight * scale);
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
          const base64 = canvas.toDataURL("image/jpeg", 0.65);
          getSocket().emit("screen-frame", { linkId: results.activity.linkId, frame: base64 });
        }
      }
    }

    // Capture first frame immediately!
    setTimeout(captureAndEmitFrame, 100);

    // Continuous capture interval every 300ms (~3-4 fps smooth screen share)
    frameIntervalRef.current = setInterval(captureAndEmitFrame, 300);
  }

  function stopScreenShare() {
    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (hostVideoRef.current) {
      hostVideoRef.current.srcObject = null;
    }
    peerConnectionsRef.current.forEach((pc) => pc.close());
    peerConnectionsRef.current.clear();

    setIsScreenSharing(false);
    if (results?.activity?.linkId) {
      getSocket().emit("screen-share-stop", { linkId: results.activity.linkId });
    }
  }

  async function handleSendAnswer(qId) {
    const text = qaAnswerDrafts[qId] || "";
    if (!text.trim()) return;
    setAnsweringId(qId);
    try {
      const res = await api.answerQa(activityId, qId, { answer: text.trim(), isAnswered: true });
      if (res?.qaFeed) {
        const feed = parseQaFeed(res.qaFeed);
        setResults((prev) => ({
          ...prev,
          activity: { ...prev.activity, qaFeed: feed },
        }));
        const answeredItem = feed.find((q) => q.id === qId);
        if (results?.activity?.linkId) {
          getSocket().emit("qa-answered", {
            linkId: results.activity.linkId,
            qaFeed: feed,
            answeredItem,
            questionId: qId,
          });
        }
      }
      setQaAnswerDrafts((prev) => ({ ...prev, [qId]: "" }));
    } catch (err) {
      console.error("Failed to submit answer:", err);
    } finally {
      setAnsweringId(null);
    }
  }

  async function handleToggleAnswered(qId, currentStatus) {
    try {
      const res = await api.answerQa(activityId, qId, { isAnswered: !currentStatus });
      if (res?.qaFeed) {
        const feed = parseQaFeed(res.qaFeed);
        setResults((prev) => ({
          ...prev,
          activity: { ...prev.activity, qaFeed: feed },
        }));
        if (results?.activity?.linkId) {
          getSocket().emit("qa-answered", {
            linkId: results.activity.linkId,
            qaFeed: feed,
          });
        }
      }
    } catch (err) {
      console.error("Failed to toggle answered:", err);
    }
  }

  async function handleDeleteQa(qId) {
    if (!window.confirm("Delete this question from live Q&A?")) return;
    try {
      const res = await api.deleteQa(activityId, qId);
      if (res?.qaFeed) {
        const feed = parseQaFeed(res.qaFeed);
        setResults((prev) => ({
          ...prev,
          activity: { ...prev.activity, qaFeed: feed },
        }));
        if (results?.activity?.linkId) {
          getSocket().emit("qa-answered", {
            linkId: results.activity.linkId,
            qaFeed: feed,
          });
        }
      }
    } catch (err) {
      console.error("Failed to delete question:", err);
    }
  }

  const allStudents = results.students || [];
  const completedCount = results.completedParticipants || allStudents.filter((s) => s.isDone).length;
  const pendingCount = results.pendingParticipants || (allStudents.length - completedCount);
  const avgScore = results.averageScore || 0;
  const isPoll = results?.activity?.type === "poll" || results?.activity?.category === "poll";
  const qaFeed = parseQaFeed(results?.activity?.qaFeed);

  const lockedStudents = allStudents.filter(
    (s) =>
      s.status === "locked" ||
      (!s.isDone &&
        !s.isDisqualified &&
        proctorAlerts.some((a) => (a.guestId && a.guestId === s.guestId) || (a.participantId && a.participantId === s.participantId)))
  );

  const filteredStudents = allStudents.filter((s) => {
    if (filter === "done" && !s.isDone) return false;
    if (filter === "pending" && s.isDone) return false;
    if (searchQuery.trim()) {
      return s.displayName.toLowerCase().includes(searchQuery.toLowerCase().trim());
    }
    return true;
  });

  return (
    <main className="min-h-screen pb-16 bg-[#FAFAF9] dark:bg-[#080915] relative">
      {/* Real-time Anti-Cheat Violation Modal for Host */}
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
              The student switched screens or left the exam window. Their quiz is currently <strong>paused & locked</strong> waiting for your permission. Choose whether to approve the student so they can continue, or fail and disqualify them.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                disabled={decisionSubmitting}
                onClick={() => handleProctorDecision(activeProctorModal, "continue")}
                className="btn-secondary py-3 px-4 rounded-xl font-bold text-xs flex flex-col items-center justify-center gap-1 border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 cursor-pointer shadow-sm transition-all"
              >
                <div className="flex items-center gap-1.5 font-extrabold text-sm text-emerald-600 dark:text-emerald-400">
                  <span>✓</span> Approve & Allow to Continue
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
                  <span>🚫</span> Fail & Disqualify
                </div>
                <span className="text-[10px] text-rose-100 font-normal">
                  Disqualify student with 0% mark
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {hostQaToast && (
        <div
          role="alert"
          className="fixed top-6 right-6 z-50 max-w-sm w-full bg-[#0B1528]/95 dark:bg-[#070D1B]/95 border-2 border-emerald-500/60 text-white shadow-2xl rounded-2xl p-4 backdrop-blur-md animate-in slide-in-from-top-4 flex items-start gap-3"
        >
          <div className="w-10 h-10 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center justify-center shrink-0 text-lg shadow-sm">
            💬
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-1 mb-1">
              <span className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider">
                New Student Question
              </span>
              <button
                type="button"
                onClick={() => setHostQaToast(null)}
                className="text-gray-400 hover:text-white text-xs font-bold px-1"
              >
                ✕
              </button>
            </div>
            <div className="text-xs font-bold text-gray-100 truncate mb-0.5">
              {hostQaToast.sender} asked:
            </div>
            <div className="text-xs text-gray-300 line-clamp-2 italic mb-2">
              "{hostQaToast.text}"
            </div>
            <button
              type="button"
              onClick={() => {
                setHostQaToast(null);
                const el = document.getElementById("qa-section-panel");
                if (el) el.scrollIntoView({ behavior: "smooth" });
              }}
              className="text-[11px] font-bold text-emerald-400 hover:text-emerald-300 underline"
            >
              View in Q&A Feed ↓
            </button>
          </div>
        </div>
      )}
      <Navbar userName={user?.name} onLogout={logout} logoutLabel={t.logout_btn} />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        {/* Persistent Screen Switch Approval Banner for Host */}
        {lockedStudents.length > 0 && (
          <div className="mb-6 p-4 sm:p-5 rounded-2xl bg-amber-500/15 dark:bg-amber-950/40 border-2 border-amber-500 text-amber-950 dark:text-amber-100 shadow-xl ring-4 ring-amber-500/20">
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
                    Student switched screens or left the exam window. The quiz is locked. Click <strong>Approve & Continue</strong> below to unlock their quiz, or <strong>Fail</strong> to disqualify them.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-end">
                {lockedStudents.map((s) => (
                  <div
                    key={s.participantId || s.guestId}
                    className="flex flex-wrap items-center gap-2 bg-white dark:bg-[#12142B] p-2.5 rounded-xl border border-amber-500/40 shadow-sm"
                  >
                    <span className="font-bold text-xs text-gray-900 dark:text-gray-100 px-1">
                      {s.displayName}:
                    </span>
                    <button
                      type="button"
                      disabled={decisionSubmitting}
                      onClick={() =>
                        handleProctorDecision(
                          { participantId: s.participantId, guestId: s.guestId, displayName: s.displayName },
                          "continue"
                        )
                      }
                      className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs shadow-sm transition-all flex items-center gap-1 cursor-pointer"
                      title="Approve student and let them continue"
                    >
                      <span>✓</span> Approve & Continue
                    </button>
                    <button
                      type="button"
                      disabled={decisionSubmitting}
                      onClick={() =>
                        handleProctorDecision(
                          { participantId: s.participantId, guestId: s.guestId, displayName: s.displayName },
                          "fail"
                        )
                      }
                      className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-extrabold text-xs shadow-sm transition-all flex items-center gap-1 cursor-pointer"
                      title="Fail and disqualify student"
                    >
                      <span>🚫</span> Fail
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Top Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs font-mono font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                {isPoll ? "Live Poll Session" : "Live Quiz Session"}
              </span>
              {results.activity?.allowQa ? (
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-600 dark:text-emerald-400">
                  ✓ Q&A Allowed
                </span>
              ) : (
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-gray-500/10 border border-gray-500/25 text-gray-500">
                  ✕ Q&A Not Allowed
                </span>
              )}
            </div>
            <h1 className="font-display text-2xl font-bold">{results.activity.title || t.published_title}</h1>
            <p className="text-xs text-gray-500">
              {isPoll
                ? "Live monitoring of participant poll responses and opinion breakdown"
                : "Live monitoring of student participants and quiz completion status"}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!isScreenSharing ? (
              <button
                type="button"
                onClick={startScreenShare}
                className="btn-secondary text-xs flex items-center gap-1.5 border-primary/40 text-primary hover:bg-primary/5 font-semibold"
                title="Share your screen with all participants in real time"
              >
                <span>🖥️</span> Share Screen
              </button>
            ) : (
              <button
                type="button"
                onClick={stopScreenShare}
                className="btn-secondary text-xs flex items-center gap-1.5 border-rose-500/40 text-rose-600 bg-rose-500/10 hover:bg-rose-500/20 font-bold"
                title="Stop live screen share"
              >
                <span>🛑</span> Stop Screen ({viewerCount} viewers)
              </button>
            )}

            <button
              type="button"
              onClick={handleToggleQaPermission}
              disabled={togglingQa}
              className={`btn-secondary text-xs flex items-center gap-1.5 font-semibold transition-all ${
                results.activity?.allowQa
                  ? "border-emerald-500/40 text-emerald-600 bg-emerald-500/10 hover:bg-emerald-500/20"
                  : "border-gray-300 dark:border-gray-700 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
              }`}
              title="Toggle Q&A availability for participants at any time"
            >
              <span>{results.activity?.allowQa ? "💬 Q&A: ON" : "🔇 Q&A: OFF"}</span>
            </button>

            <button
              type="button"
              className="btn-secondary text-xs flex items-center gap-1.5"
              onClick={handleExportCsv}
            >
              <span>📥</span> Export CSV
            </button>
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() => router.push("/host/dashboard")}
            >
              {t.back_btn || "Back to Dashboard"}
            </button>
          </div>
        </div>

        {/* Live Screen Share Preview Card (When Active) */}
        {isScreenSharing && (
          <div className="card p-5 mb-6 border-2 border-primary/50 bg-white dark:bg-[#12142B] shadow-md rounded-2xl">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3 pb-3 border-b border-[#E1E1DC] dark:border-[#2A2E52]">
              <div className="flex items-center gap-2.5">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-rose-500"></span>
                </span>
                <div>
                  <h3 className="font-display font-bold text-sm text-gray-900 dark:text-gray-100 flex items-center gap-2">
                    <span>Live Screen Broadcast</span>
                    <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/25">
                      {viewerCount} {viewerCount === 1 ? "viewer" : "viewers"} connected
                    </span>
                  </h3>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setScreenPreviewExpanded((prev) => !prev)}
                  className="btn-secondary text-xs py-1 px-2.5"
                >
                  {screenPreviewExpanded ? "Collapse View" : "Expand View"}
                </button>
                <button
                  type="button"
                  onClick={stopScreenShare}
                  className="btn-secondary text-xs py-1 px-3 border-rose-500/40 text-rose-600 bg-rose-500/10 hover:bg-rose-500/20 font-bold"
                >
                  🛑 Stop Sharing
                </button>
              </div>
            </div>
            <div
              className={`overflow-hidden rounded-xl bg-black border border-black/20 flex items-center justify-center transition-all duration-300 ${
                screenPreviewExpanded ? "max-h-[500px]" : "max-h-[240px]"
              }`}
            >
              <video
                ref={hostVideoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-auto object-contain max-h-[500px]"
              />
            </div>
            <div className="flex items-center justify-between mt-2 text-[11px] text-gray-400">
              <span>Your screen is being broadcasted live to all joined participants in real time.</span>
              <span className="font-mono text-emerald-500 font-semibold flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live HD
              </span>
            </div>
          </div>
        )}

        {/* Join Code & Share Box */}
        <div className="card p-5 mb-6 shadow-sm border border-[#E1E1DC] dark:border-[#2A2E52] bg-white dark:bg-[#12142B]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex-1 min-w-[200px]">
              <div className="text-xs text-gray-400 font-medium mb-1">Participant Join Link</div>
              <div className="font-mono text-xs sm:text-sm bg-[#F5F5F2] dark:bg-[#0E1020] border border-[#E1E1DC] dark:border-[#2A2E52] rounded-lg px-3 py-2 select-all break-all">
                {link}
              </div>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <div className="text-right">
                <div className="text-[11px] text-gray-400 uppercase font-medium">Join Code</div>
                <div className="font-mono text-xl font-bold text-primary tracking-widest">{results.activity.linkId}</div>
              </div>

              <button
                type="button"
                className="btn-primary flex items-center gap-1.5 py-2 px-3.5 text-xs shadow-xs"
                onClick={copyLink}
              >
                <span>{copied ? "✓" : "📋"}</span>
                <span>{copied ? t.copied : t.copy_link}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Live Metric Cards Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          <div className="card p-4 bg-white dark:bg-[#12142B] border border-[#E1E1DC] dark:border-[#2A2E52]">
            <div className="text-[11px] text-gray-500 font-medium mb-1">Total Joined</div>
            <div className="font-display text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100">
              {results.totalParticipants}
            </div>
            <div className="text-[11px] text-gray-400">students connected</div>
          </div>

          <div className="card p-4 bg-white dark:bg-[#12142B] border border-emerald-500/30">
            <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium mb-1 flex items-center gap-1">
              <span>✓</span> {isPoll ? "Completed Poll" : "Completed Quiz"}
            </div>
            <div className="font-display text-2xl sm:text-3xl font-bold text-emerald-600 dark:text-emerald-400">
              {completedCount}
            </div>
            <div className="text-[11px] text-gray-400">{isPoll ? "voted in poll" : "done with quiz"}</div>
          </div>

          <div className="card p-4 bg-white dark:bg-[#12142B] border border-amber-500/30">
            <div className="text-[11px] text-amber-600 dark:text-amber-400 font-medium mb-1 flex items-center gap-1">
              <span>⏳</span> In Progress
            </div>
            <div className="font-display text-2xl sm:text-3xl font-bold text-amber-600 dark:text-amber-400">
              {pendingCount}
            </div>
            <div className="text-[11px] text-gray-400">currently attempting</div>
          </div>

          <div className="card p-4 bg-white dark:bg-[#12142B] border border-primary/30">
            <div className="text-[11px] text-primary font-medium mb-1 flex items-center gap-1">
              <span>📊</span> Avg Score
            </div>
            <div className="font-display text-2xl sm:text-3xl font-bold text-primary">
              {completedCount > 0 ? `${avgScore}%` : "—"}
            </div>
            <div className="text-[11px] text-gray-400">from completed participants</div>
          </div>
        </div>

        {/* Live Poll Results Breakdown (if Poll) */}
        {isPoll && results?.byQuestion && Object.keys(results.byQuestion).length > 0 && (
          <div className="card p-6 bg-white dark:bg-[#12142B] border border-[#E1E1DC] dark:border-[#2A2E52] shadow-sm mb-6">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-3 border-b border-[#E1E1DC] dark:border-[#2A2E52]">
              <div>
                <h2 className="font-display text-lg font-bold">Live Poll Results</h2>
                <p className="text-xs text-gray-500">Real-time vote distribution across all questions</p>
              </div>
              <span className="text-xs font-mono font-bold text-primary bg-primary/10 px-3 py-1 rounded-full">
                {results.totalResponses} Total Votes Recorded
              </span>
            </div>

            <div className="space-y-6">
              {Object.entries(results.byQuestion).map(([qId, qData], qIdx) => {
                const totalVotesForQ = qData.answers?.length || 0;
                const options = qData.options || [];

                const voteCounts = {};
                options.forEach((opt) => {
                  voteCounts[opt] = 0;
                });
                (qData.answers || []).forEach((a) => {
                  if (a.value && voteCounts[a.value] !== undefined) {
                    voteCounts[a.value] += 1;
                  } else if (a.value) {
                    voteCounts[a.value] = (voteCounts[a.value] || 0) + 1;
                  }
                });

                return (
                  <div
                    key={qId}
                    className="p-4 rounded-xl border border-[#E1E1DC] dark:border-[#2A2E52] bg-[#FAF9F6] dark:bg-[#161836]"
                  >
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="font-semibold text-sm text-gray-900 dark:text-gray-100">
                        <span className="text-primary font-bold mr-2">Q{qIdx + 1}.</span>
                        {qData.questionText}
                      </div>
                      <span className="text-xs text-gray-500 shrink-0 font-medium">
                        {totalVotesForQ} {totalVotesForQ === 1 ? "vote" : "votes"}
                      </span>
                    </div>

                    <div className="space-y-2.5">
                      {options.map((opt, oIdx) => {
                        const count = voteCounts[opt] || 0;
                        const pct = totalVotesForQ > 0 ? Math.round((count / totalVotesForQ) * 100) : 0;
                        return (
                          <div key={oIdx} className="space-y-1">
                            <div className="flex items-center justify-between text-xs font-medium">
                              <span className="text-gray-700 dark:text-gray-300 flex items-center gap-2">
                                <span className="w-5 h-5 rounded-full bg-white dark:bg-[#2A2E52] border border-[#E1E1DC] dark:border-[#383C66] text-center text-[10px] leading-5 font-bold">
                                  {String.fromCharCode(65 + oIdx)}
                                </span>
                                {opt}
                              </span>
                              <span className="text-gray-500 font-mono font-bold">
                                {count} {count === 1 ? "vote" : "votes"} ({pct}%)
                              </span>
                            </div>
                            <div className="w-full bg-[#E8E8E3] dark:bg-[#23274E] rounded-full h-2.5 overflow-hidden">
                              <div
                                className="bg-primary h-2.5 rounded-full transition-all duration-500"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Live Student Roster Section */}
        <div className="card p-6 bg-white dark:bg-[#12142B] border border-[#E1E1DC] dark:border-[#2A2E52] shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-4 border-b border-[#E1E1DC] dark:border-[#2A2E52]">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-display text-lg font-bold">Students & Participants</h2>
                <span className="text-[11px] text-gray-400 font-mono bg-[#F0F0EB] dark:bg-[#1B1E3F] px-2 py-0.5 rounded-full">
                  Auto-syncing
                </span>
              </div>
              <p className="text-xs text-gray-500">
                Track which participants are done with the quiz and view their scores
              </p>
            </div>

            {/* Filter Tabs & Search */}
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                placeholder="Search student..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="field text-xs py-1.5 px-3 w-40 sm:w-48"
              />

              <div className="flex items-center bg-[#F0F0EB] dark:bg-[#1B1E3F] p-1 rounded-lg text-xs">
                <button
                  type="button"
                  onClick={() => setFilter("all")}
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                    filter === "all" ? "bg-white dark:bg-[#2A2E52] shadow-xs text-primary" : "text-gray-500"
                  }`}
                >
                  All ({allStudents.length})
                </button>
                <button
                  type="button"
                  onClick={() => setFilter("done")}
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                    filter === "done" ? "bg-white dark:bg-[#2A2E52] shadow-xs text-emerald-600" : "text-gray-500"
                  }`}
                >
                  Done ({completedCount})
                </button>
                <button
                  type="button"
                  onClick={() => setFilter("pending")}
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                    filter === "pending" ? "bg-white dark:bg-[#2A2E52] shadow-xs text-amber-600" : "text-gray-500"
                  }`}
                >
                  Attempting ({pendingCount})
                </button>
              </div>
            </div>
          </div>

          {/* Student List */}
          {allStudents.length === 0 ? (
            <div className="py-12 text-center">
              <div className="text-3xl mb-2">👥</div>
              <div className="text-sm font-semibold mb-1">No participants yet</div>
              <p className="text-xs text-gray-400 max-w-sm mx-auto">
                Share the join code <span className="font-mono font-bold text-primary">{results.activity.linkId}</span> with your students so they can join and attempt the quiz.
              </p>
            </div>
          ) : filteredStudents.length === 0 ? (
            <div className="py-8 text-center text-xs text-gray-400">
              No students match the selected filter.
            </div>
          ) : (
            <div className="space-y-3">
              {filteredStudents.map((student) => {
                return (
                  <div
                    key={student.participantId}
                    className={`rounded-xl border transition-all ${
                      student.isDone
                        ? "border-emerald-500/30 bg-emerald-500/[0.01]"
                        : "border-[#E1E1DC] dark:border-[#2A2E52] bg-white dark:bg-[#1B1E3F]/20"
                    }`}
                  >
                    <div className="p-3.5 flex flex-wrap items-center justify-between gap-3">
                      {/* Student Info */}
                      <div className="flex items-center gap-3 min-w-[180px]">
                        <div
                          className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs uppercase ${
                            student.isDone
                              ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                              : "bg-amber-500/20 text-amber-600 dark:text-amber-400"
                          }`}
                        >
                          {student.displayName?.slice(0, 2) || "ST"}
                        </div>

                        <div>
                          <div className="text-sm font-bold text-gray-900 dark:text-gray-100 flex items-center gap-1.5">
                            <span>{student.displayName}</span>
                            {student.isDone && (
                              <span className="text-emerald-600 text-xs" title="Submitted Quiz">
                                ✓
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-gray-400">
                            Joined {new Date(student.joinedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            {student.submittedAt && (
                              <span>
                                {" "}• Submitted {new Date(student.submittedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Status, Anti-Cheat Violations, & Marks */}
                      <div className="flex flex-wrap items-center gap-2">
                        {/* Proctoring Badges */}
                        {(() => {
                          const isStudentLocked =
                            student.status === "locked" ||
                            (!student.isDone &&
                              !student.isDisqualified &&
                              proctorAlerts.some(
                                (a) =>
                                  (a.guestId && a.guestId === student.guestId) ||
                                  (a.participantId && a.participantId === student.participantId)
                              ));

                          if (isStudentLocked) {
                            return (
                              <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/40 flex items-center gap-1.5 animate-pulse">
                                <span>🔒</span> Screen Switched (Waiting for Approval)
                              </span>
                            );
                          }
                          if (student.isDisqualified || student.status === "disqualified") {
                            return (
                              <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-rose-500/15 text-rose-500 border border-rose-500/30 flex items-center gap-1">
                                <span>🚫</span> Failed (Disqualified)
                              </span>
                            );
                          }
                          if (student.violationCount > 0 || (student.proctorViolations && student.proctorViolations.length > 0)) {
                            return (
                              <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-500 border border-amber-500/30 flex items-center gap-1">
                                <span>⚠️</span> {student.violationCount || student.proctorViolations?.length} Violations
                              </span>
                            );
                          }
                          return null;
                        })()}

                        {student.isDone ? (
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/30 flex items-center gap-1">
                              <span>✓</span> Done
                            </span>

                            {/* Direct Marks Display */}
                            <div className="px-3 py-1 rounded-xl bg-primary/10 border border-primary/25 text-primary text-xs font-bold flex items-center gap-1.5 shadow-xs">
                              <span className="font-mono text-sm font-extrabold text-primary">
                                {student.isDisqualified ? 0 : (student.score ? student.score.correct : 0)} / {student.score?.total || results.activity?.questions?.length || 0} Marks
                              </span>
                              <span className="text-[11px] font-semibold text-primary/80">
                                ({student.isDisqualified ? 0 : (student.score?.percentage ?? Math.round(((student.score?.correct || 0) / (results.activity?.questions?.length || 1)) * 100))}%)
                              </span>
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-600 border border-amber-500/30 flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                            Attempting
                          </span>
                        )}

                        {/* Host Anti-Cheat Action Controls */}
                        <div className="flex items-center gap-1.5 ml-1">
                          {(() => {
                            const isStudentLocked =
                              student.status === "locked" ||
                              (!student.isDone &&
                                !student.isDisqualified &&
                                proctorAlerts.some(
                                  (a) =>
                                    (a.guestId && a.guestId === student.guestId) ||
                                    (a.participantId && a.participantId === student.participantId)
                                ));

                            if (isStudentLocked) {
                              return (
                                <>
                                  <button
                                    type="button"
                                    disabled={decisionSubmitting}
                                    onClick={() =>
                                      handleProctorDecision(
                                        { participantId: student.participantId, guestId: student.guestId, displayName: student.displayName },
                                        "continue"
                                      )
                                    }
                                    className="text-[11px] font-extrabold px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white shadow-xs transition-colors cursor-pointer flex items-center gap-1"
                                    title="Approve student and let them continue"
                                  >
                                    <span>✓</span> Approve & Continue
                                  </button>
                                  <button
                                    type="button"
                                    disabled={decisionSubmitting}
                                    onClick={() =>
                                      handleProctorDecision(
                                        { participantId: student.participantId, guestId: student.guestId, displayName: student.displayName },
                                        "fail"
                                      )
                                    }
                                    className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white shadow-xs transition-colors cursor-pointer flex items-center gap-1"
                                    title="Fail and disqualify student"
                                  >
                                    <span>🚫</span> Fail Student
                                  </button>
                                </>
                              );
                            }

                            if (student.isDisqualified || student.status === "disqualified") {
                              return (
                                <button
                                  type="button"
                                  disabled={decisionSubmitting}
                                  onClick={() =>
                                    handleProctorDecision(
                                      { participantId: student.participantId, guestId: student.guestId, displayName: student.displayName },
                                      "continue"
                                    )
                                  }
                                  className="text-[11px] font-bold px-2.5 py-1 rounded-md bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 border border-emerald-500/30 transition-colors cursor-pointer"
                                  title="Restore and allow student"
                                >
                                  ✓ Re-Approve & Restore
                                </button>
                              );
                            }

                            return (
                              <>
                                <button
                                  type="button"
                                  disabled={decisionSubmitting}
                                  onClick={() =>
                                    handleProctorDecision(
                                      { participantId: student.participantId, guestId: student.guestId, displayName: student.displayName },
                                      "lock"
                                    )
                                  }
                                  className="text-[11px] font-medium px-2 py-1 rounded-md bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 border border-amber-500/25 transition-colors cursor-pointer"
                                  title="Lock / Pause student quiz"
                                >
                                  Pause Quiz
                                </button>
                                <button
                                  type="button"
                                  disabled={decisionSubmitting}
                                  onClick={() => {
                                    setActiveProctorModal({
                                      participantId: student.participantId,
                                      guestId: student.guestId,
                                      displayName: student.displayName,
                                      violationType: "tab_switch",
                                      message: "Host manually deciding on student exam permission.",
                                    });
                                  }}
                                  className="text-[11px] font-bold px-2.5 py-1 rounded-md bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 border border-rose-500/20 transition-colors cursor-pointer"
                                  title="Fail student"
                                >
                                  Fail Student
                                </button>
                              </>
                            );
                          })()}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Live Q&A Moderation Section (Host has full control anytime) */}
        <div id="qa-section-panel" className="card p-6 mt-6 bg-white dark:bg-[#12142B] border border-[#E1E1DC] dark:border-[#2A2E52] shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-4 border-b border-[#E1E1DC] dark:border-[#2A2E52]">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-display text-lg font-bold">Live Q&A Feed</h2>
                {results.activity?.allowQa ? (
                  <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/25 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Q&A Active
                  </span>
                ) : (
                  <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 border border-amber-500/25">
                    Q&A Disabled
                  </span>
                )}
                <span className="text-xs font-mono text-gray-500">
                  ({qaFeed.length} questions)
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                {results.activity?.allowQa
                  ? "Participants can submit questions live. You can respond, manage, or disable Q&A anytime."
                  : "Q&A is currently turned off for participants. You can enable it anytime without ending the session."}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleToggleQaPermission}
                disabled={togglingQa}
                className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition-all flex items-center gap-1.5 shadow-xs ${
                  results.activity?.allowQa
                    ? "bg-rose-500/10 border-rose-500/30 text-rose-600 hover:bg-rose-500/20"
                    : "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/20"
                }`}
              >
                <span>{results.activity?.allowQa ? "🚫 Turn Off Q&A" : "✓ Turn On Q&A"}</span>
              </button>

              {/* Filter Tabs for QA */}
              <div className="flex items-center gap-1.5 bg-[#F5F5F2] dark:bg-[#0E1020] p-1 rounded-lg border border-[#E1E1DC] dark:border-[#2A2E52] text-xs">
                <button
                  type="button"
                  onClick={() => setQaFilter("all")}
                  className={`px-3 py-1 rounded-md transition-all ${
                    qaFilter === "all" ? "bg-white dark:bg-[#1B1E3F] text-primary font-bold shadow-xs" : "text-gray-500 hover:text-gray-900"
                  }`}
                >
                  All ({qaFeed.length})
                </button>
                <button
                  type="button"
                  onClick={() => setQaFilter("unanswered")}
                  className={`px-3 py-1 rounded-md transition-all ${
                    qaFilter === "unanswered" ? "bg-white dark:bg-[#1B1E3F] text-primary font-bold shadow-xs" : "text-gray-500 hover:text-gray-900"
                  }`}
                >
                  Unanswered ({qaFeed.filter((q) => !q.isAnswered).length})
                </button>
                <button
                  type="button"
                  onClick={() => setQaFilter("answered")}
                  className={`px-3 py-1 rounded-md transition-all ${
                    qaFilter === "answered" ? "bg-white dark:bg-[#1B1E3F] text-primary font-bold shadow-xs" : "text-gray-500 hover:text-gray-900"
                  }`}
                >
                  Answered ({qaFeed.filter((q) => q.isAnswered).length})
                </button>
              </div>
            </div>
          </div>

          {/* Questions List */}
          {(() => {
            const feed = qaFeed.filter((q) => {
              if (qaFilter === "unanswered") return !q.isAnswered;
              if (qaFilter === "answered") return q.isAnswered;
              return true;
            });

            if (feed.length === 0) {
              return (
                <div className="py-10 text-center text-xs text-gray-400">
                  {qaFeed.length === 0
                    ? "No questions submitted by participants yet. When participants ask questions, they will appear here in real time."
                    : "No questions match the selected filter."}
                </div>
              );
            }

            return (
              <div className="space-y-4">
                {feed.map((q) => (
                  <div
                    key={q.id}
                    className={`p-4 rounded-xl border transition-all ${
                      q.isAnswered
                        ? "border-emerald-500/20 bg-emerald-500/[0.02]"
                        : "border-[#E1E1DC] dark:border-[#2A2E52] bg-[#FAFAF9]/60 dark:bg-[#1B1E3F]/20"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-primary/10 text-primary font-bold text-xs flex items-center justify-center uppercase">
                          {q.participantName?.slice(0, 2) || "P"}
                        </div>
                        <div>
                          <span className="text-xs font-bold text-gray-900 dark:text-gray-100 mr-2">
                            {q.participantName || "Participant"}
                          </span>
                          <span className="text-[10px] text-gray-400">
                            {new Date(q.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleToggleAnswered(q.id, q.isAnswered)}
                          className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-all ${
                            q.isAnswered
                              ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30"
                              : "bg-gray-100 dark:bg-gray-800 text-gray-500 border-gray-300 dark:border-gray-700 hover:text-gray-700"
                          }`}
                        >
                          {q.isAnswered ? "✓ Answered" : "Mark as Answered"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteQa(q.id)}
                          className="text-gray-400 hover:text-red-500 text-xs p-1"
                          title="Delete question"
                        >
                          ✕
                        </button>
                      </div>
                    </div>

                    <div className="text-sm text-gray-900 dark:text-gray-100 mb-3 pl-9 font-medium">
                      "{q.text}"
                    </div>

                    {/* Answer Display or Form */}
                    <div className="pl-9">
                      {q.answer ? (
                        <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-900 dark:text-emerald-300">
                          <span className="font-bold mr-1">Host Response:</span>
                          {q.answer}
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <input
                            type="text"
                            placeholder="Type an answer to display to participants..."
                            value={qaAnswerDrafts[q.id] || ""}
                            onChange={(e) =>
                              setQaAnswerDrafts((prev) => ({ ...prev, [q.id]: e.target.value }))
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSendAnswer(q.id);
                            }}
                            className="field py-1.5 text-xs flex-1"
                          />
                          <button
                            type="button"
                            onClick={() => handleSendAnswer(q.id)}
                            disabled={answeringId === q.id || !qaAnswerDrafts[q.id]?.trim()}
                            className="btn-primary text-xs py-1.5 px-3 whitespace-nowrap"
                          >
                            {answeringId === q.id ? "Sending..." : "Send Answer"}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      </div>
    </main>
  );
}
