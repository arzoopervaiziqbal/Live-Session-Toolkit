"use client";
import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Navbar from "../../../components/Navbar";
import { api } from "../../../lib/api";
import { getSocket, RTC_CONFIG } from "../../../lib/socket";

export default function ResultPage() {
  const router = useRouter();
  const [result, setResult] = useState(null);
  const [guestName, setGuestName] = useState("");
  const [guestId, setGuestId] = useState("");

  // Q&A state
  const [questionText, setQuestionText] = useState("");
  const [submittingQa, setSubmittingQa] = useState(false);
  const [qaSuccess, setQaSuccess] = useState("");
  const [qaError, setQaError] = useState("");
  const [myQuestions, setMyQuestions] = useState([]);
  const [qaNotification, setQaNotification] = useState(null);

  // Screen Sharing State for Participant
  const [hostSharingScreen, setHostSharingScreen] = useState(false);
  const [screenExpanded, setScreenExpanded] = useState(true);
  const [screenFrameSrc, setScreenFrameSrc] = useState(null);

  const remoteVideoRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const notificationTimerRef = useRef(null);
  const guestIdRef = useRef(guestId);
  guestIdRef.current = guestId;

  function triggerNotification(notif) {
    if (notificationTimerRef.current) {
      clearTimeout(notificationTimerRef.current);
    }
    setQaNotification(notif);

    // Subtle audio chime
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(587.33, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.35);
      }
    } catch (_) {}

    notificationTimerRef.current = setTimeout(() => {
      setQaNotification(null);
    }, 8000);
  }

  useEffect(() => {
    const raw = sessionStorage.getItem("sp_last_result");
    if (!raw) {
      router.replace("/participant/join");
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      setResult(parsed);
      if (Array.isArray(parsed.qaFeed)) {
        const myId = sessionStorage.getItem("sp_guest_id");
        const initialMine = parsed.qaFeed.filter((q) => q.participantId === myId);
        if (initialMine.length > 0) {
          setMyQuestions(initialMine);
        }
      }
    } catch {
      router.replace("/participant/join");
      return;
    }

    const name = sessionStorage.getItem("sp_guest_name");
    const id = sessionStorage.getItem("sp_guest_id");
    if (name) setGuestName(name);
    if (id) {
      setGuestId(id);
      guestIdRef.current = id;
    }
  }, [router]);

  // Real-time Socket.IO Connection for Results Page
  useEffect(() => {
    if (!result?.linkId) return;
    const socket = getSocket();
    const linkId = String(result.linkId).toLowerCase().trim();

    const aliasRooms = new Set([
      String(result.linkId || "").toLowerCase().trim(),
      String(result._id || "").toLowerCase().trim(),
      String(result.activityId || "").toLowerCase().trim(),
    ]);
    aliasRooms.forEach((r) => {
      if (r) {
        socket.emit("join-session", {
          linkId: r,
          role: "participant",
          participantId: result.participantId || guestId,
          displayName: result.participantName || guestName || "Student",
        });
      }
    });

    // Real-time Q&A toggle from host
    socket.on("qa-updated", ({ allowQa }) => {
      setResult((prev) => (prev ? { ...prev, allowQa: Boolean(allowQa) } : prev));
    });

    // Real-time Q&A answer update from host
    socket.on("qa-answered", ({ qaFeed, answeredItem, questionId }) => {
      let feed = qaFeed;
      if (typeof feed === "string") {
        try {
          feed = JSON.parse(feed);
        } catch (_) {
          feed = [];
        }
      }
      if (Array.isArray(feed)) {
        let target = answeredItem;
        if (!target && questionId) {
          target = feed.find((q) => q.id === questionId);
        }

        setMyQuestions((prev) => {
          if (!target) {
            target = feed.find((newQ) => {
              const oldQ = prev.find((o) => o.id === newQ.id);
              const newAns = newQ.answer || newQ.answerText;
              const oldAns = oldQ ? (oldQ.answer || oldQ.answerText) : null;
              return newAns && newAns !== oldAns;
            });
          }

          if (target && (target.answer || target.answerText)) {
            const isMine = Boolean(
              (target.participantId && target.participantId === guestIdRef.current) ||
              prev.some((q) => q.id === target.id || q.text === target.text)
            );
            triggerNotification({
              id: target.id + "_" + Date.now(),
              targetId: target.id,
              isMyQuestion: isMine,
              questionText: target.text || target.questionText || "Question",
              replyText: target.answer || target.answerText,
              senderName: target.participantName || target.displayName || "Participant",
            });
          }

          return prev.map((myQ) => {
            const match = feed.find(
              (f) =>
                f.id === myQ.id ||
                (f.text && myQ.text && f.text === myQ.text) ||
                (f.questionText && myQ.text && f.questionText === myQ.text)
            );
            if (match && (match.answer || match.answerText)) {
              return {
                ...myQ,
                answer: match.answer || match.answerText,
                answerText: match.answer || match.answerText,
                isAnswered: true,
              };
            }
            return myQ;
          });
        });
      }
    });

    // Screen sharing started by host
    socket.on("screen-share-started", async ({ hostSocketId }) => {
      setHostSharingScreen(true);
      setScreenExpanded(true);

      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }

      const pc = new RTCPeerConnection(RTC_CONFIG);
      peerConnectionRef.current = pc;

      pc.ontrack = (event) => {
        if (remoteVideoRef.current && event.streams[0]) {
          remoteVideoRef.current.srcObject = event.streams[0];
          remoteVideoRef.current.play().catch(() => {});
        }
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit("screen-share-ice", {
            targetSocketId: hostSocketId,
            candidate: event.candidate,
          });
        }
      };

      socket.emit("screen-share-request", {
        hostSocketId,
        participantName: result.participantName || guestName || "Student",
      });
    });

    // Host sends WebRTC offer
    socket.on("screen-share-offer", async ({ hostSocketId, offer }) => {
      try {
        let pc = peerConnectionRef.current;
        if (!pc) {
          pc = new RTCPeerConnection(RTC_CONFIG);
          peerConnectionRef.current = pc;
          pc.ontrack = (event) => {
            if (remoteVideoRef.current && event.streams[0]) {
              remoteVideoRef.current.srcObject = event.streams[0];
              remoteVideoRef.current.play().catch(() => {});
            }
          };
          pc.onicecandidate = (event) => {
            if (event.candidate) {
              socket.emit("screen-share-ice", {
                targetSocketId: hostSocketId,
                candidate: event.candidate,
              });
            }
          };
        }

        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socket.emit("screen-share-answer", {
          hostSocketId,
          answer,
        });
      } catch (err) {
        console.warn("Error answering WebRTC offer on result page:", err);
      }
    });

    // WebRTC ICE candidates from host
    socket.on("screen-share-ice", async ({ candidate }) => {
      if (peerConnectionRef.current && candidate) {
        try {
          await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
          console.warn("Error adding ICE candidate:", e);
        }
      }
    });

    // Screen frame snapshot fallback
    socket.on("screen-frame", ({ frame }) => {
      setHostSharingScreen(true);
      setScreenFrameSrc(frame);
    });

    // Screen share stopped by host
    socket.on("screen-share-stopped", () => {
      setHostSharingScreen(false);
      setScreenFrameSrc(null);
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = null;
      }
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }
    });

    return () => {
      socket.off("qa-updated");
      socket.off("qa-answered");
      socket.off("screen-share-started");
      socket.off("screen-share-offer");
      socket.off("screen-share-ice");
      socket.off("screen-frame");
      socket.off("screen-share-stopped");
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }
    };
  }, [result?.linkId, guestId, guestName]);

  if (!result) return null;

  const displayName = result.participantName || guestName || "Student";
  const percentage =
    result.percentage !== null && result.percentage !== undefined
      ? result.percentage
      : result.scored > 0
      ? Math.round((result.correct / result.scored) * 100)
      : 0;

  async function handleAskQuestion(e) {
    e.preventDefault();
    if (!questionText.trim()) return;
    setSubmittingQa(true);
    setQaError("");
    setQaSuccess("");

    try {
      const linkId = result.linkId;
      if (!linkId) throw new Error("Missing session code.");
      const res = await api.postParticipantQuestion(linkId, {
        participantId: result.participantId || guestId,
        displayName,
        questionText: questionText.trim(),
      });

      try {
        const socket = getSocket();
        socket.emit("qa-new-question", {
          linkId,
          activityId: result?._id || result?.activityId,
          item: res?.item,
          qaFeed: res?.qaFeed,
        });
      } catch (_) {}

      setQaSuccess("Your question has been sent to the host!");
      setMyQuestions((prev) => [
        ...prev,
        {
          id: res?.item?.id || Date.now(),
          text: questionText.trim(),
          createdAt: new Date().toISOString(),
        },
      ]);
      setQuestionText("");
    } catch (err) {
      setQaError(err.message || "Failed to submit question.");
    } finally {
      setSubmittingQa(false);
    }
  }

  return (
    <main className="min-h-screen pb-16 bg-[#FAFAF9] dark:bg-[#080915] flex flex-col relative">
      {qaNotification && (
        <div
          role="alert"
          className={`fixed top-4 sm:top-6 right-4 sm:right-6 z-50 max-w-sm sm:max-w-md w-full transition-all duration-300 transform translate-y-0 opacity-100 shadow-2xl rounded-2xl p-4 border backdrop-blur-md animate-in slide-in-from-top-4 ${
            qaNotification.isMyQuestion
              ? "bg-[#0B1528]/95 dark:bg-[#070D1B]/95 border-emerald-500/60 text-white shadow-emerald-500/25 ring-2 ring-emerald-500/30"
              : "bg-white/95 dark:bg-[#12142B]/95 border-[#E1E1DC] dark:border-[#2A2E52] text-gray-900 dark:text-gray-100 shadow-xl"
          }`}
        >
          <div className="flex items-start gap-3">
            <div
              className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-lg shadow-sm ${
                qaNotification.isMyQuestion
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                  : "bg-primary/10 text-primary border border-primary/20"
              }`}
            >
              {qaNotification.isMyQuestion ? "🔔" : "💬"}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-1 mb-1">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`text-xs font-bold uppercase tracking-wider ${
                      qaNotification.isMyQuestion ? "text-emerald-400" : "text-primary"
                    }`}
                  >
                    {qaNotification.isMyQuestion
                      ? "Host Replied to Your Question!"
                      : "New Host Answer in Q&A"}
                  </span>
                  {qaNotification.isMyQuestion && (
                    <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-1.5 py-0.2 rounded font-bold">
                      You
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setQaNotification(null)}
                  className="text-gray-400 hover:text-gray-200 text-sm font-bold p-1 leading-none rounded hover:bg-white/10"
                  title="Dismiss notification"
                >
                  ✕
                </button>
              </div>

              <p className="text-xs text-gray-300 dark:text-gray-300 line-clamp-1 mb-2 italic">
                "{qaNotification.questionText}"
              </p>

              <div className="p-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-xs text-emerald-100 font-medium leading-relaxed">
                <span className="font-bold text-emerald-400 mr-1.5">Host Reply:</span>
                {qaNotification.replyText}
              </div>
            </div>
          </div>
        </div>
      )}
      <Navbar userName={displayName} logoutLabel={undefined} />

      <div className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 py-10">
        <div className="w-full max-w-lg space-y-6">
          {/* Live Screen Share Viewer for Participant on Results Page */}
          {hostSharingScreen && (
            <div className="card p-4 border-2 border-primary/50 bg-[#0A0D1E] text-white shadow-xl rounded-2xl overflow-hidden">
              <div className="flex items-center justify-between gap-2 pb-2.5 mb-2.5 border-b border-white/10">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500"></span>
                  </span>
                  <span className="text-xs font-bold text-gray-200 uppercase tracking-wider">
                    Host's Screen (Live)
                  </span>
                  <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/15 px-1.5 py-0.5 rounded border border-emerald-500/30">
                    HD Real-Time
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setScreenExpanded((prev) => !prev)}
                  className="text-[11px] bg-white/10 hover:bg-white/20 text-gray-200 px-2.5 py-1 rounded-md transition-colors font-medium"
                >
                  {screenExpanded ? "Minimize Screen" : "Expand Screen"}
                </button>
              </div>

              {screenExpanded ? (
                <div className="relative aspect-video w-full bg-black rounded-xl overflow-hidden flex items-center justify-center border border-white/10">
                  <video
                    ref={remoteVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className={`w-full h-full object-contain ${
                      screenFrameSrc && (!remoteVideoRef.current || !remoteVideoRef.current.srcObject)
                        ? "hidden"
                        : "block"
                    }`}
                  />
                  {screenFrameSrc && (!remoteVideoRef.current || !remoteVideoRef.current.srcObject) && (
                    <img
                      src={screenFrameSrc}
                      alt="Host Live Screen"
                      className="w-full h-full object-contain"
                    />
                  )}
                </div>
              ) : (
                <div className="text-[11px] text-gray-400 text-center py-1">
                  Host screen minimized. Click "Expand Screen" above to view.
                </div>
              )}
            </div>
          )}

          {/* Card Container */}
          <div className="card p-8 sm:p-10 text-center shadow-lg border border-[#E1E1DC] dark:border-[#2A2E52] bg-white dark:bg-[#12142B] rounded-2xl relative overflow-hidden">
            {/* Top Accent Bar */}
            <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-primary via-indigo-500 to-emerald-500" />

            {/* Quiz Completion Icon */}
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 flex items-center justify-center mx-auto mb-4 text-2xl shadow-xs">
              ✓
            </div>

            {/* Header */}
            <h1 className="font-display text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">
              {result.hasScore ? "Quiz Completed" : "Poll Completed"}
            </h1>
            <p className="text-xs sm:text-sm text-gray-500 mb-6">
              {result.activityTitle || "Activity"} • {displayName}
            </p>

            {/* Marks Box */}
            {result.hasScore ? (
              <div className="p-6 rounded-2xl bg-[#F8F8F5] dark:bg-[#1B1E3F]/50 border border-[#EBEBE6] dark:border-[#2A2E52] mb-6">
                <div className="text-xs font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 mb-2">
                  Your Marks
                </div>

                <div className="flex items-baseline justify-center gap-2 mb-2">
                  <span className="font-display text-6xl sm:text-7xl font-extrabold text-primary tracking-tight">
                    {result.correct}
                  </span>
                  <span className="text-2xl sm:text-3xl font-bold text-gray-400">
                    / {result.scored}
                  </span>
                </div>

                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 text-primary font-bold text-sm">
                  <span>Score:</span>
                  <span>{percentage}%</span>
                </div>
              </div>
            ) : (
              <div className="p-6 rounded-2xl bg-[#F8F8F5] dark:bg-[#1B1E3F]/50 border border-[#EBEBE6] dark:border-[#2A2E52] mb-6">
                <div className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                  Thank you! Your poll responses have been recorded.
                </div>
              </div>
            )}

            {/* Return / Join Action */}
            <div>
              <button
                type="button"
                className="btn-primary w-full py-3 text-sm font-semibold shadow-sm flex items-center justify-center gap-2"
                onClick={() => router.push("/participant/join")}
              >
                <span>🚀</span> Done / Join Another Session
              </button>
            </div>
          </div>

          {/* Optional Live Q&A Section (Rendered when Q&A is Allowed) */}
          {result.allowQa ? (
            <div className="card p-6 shadow-md border border-[#E1E1DC] dark:border-[#2A2E52] bg-white dark:bg-[#12142B] rounded-2xl">
              <div className="flex items-center justify-between gap-2 mb-3 pb-3 border-b border-[#E1E1DC] dark:border-[#2A2E52]">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                  <h2 className="font-display font-bold text-sm text-gray-900 dark:text-gray-100">
                    Live Session Q&A
                  </h2>
                </div>
                <span className="text-[11px] font-semibold text-emerald-600 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                  Q&A Allowed
                </span>
              </div>

              <p className="text-xs text-gray-500 mb-4">
                Have a question about this quiz/poll or the lecture? Send it directly to the host.
              </p>

              <form onSubmit={handleAskQuestion} className="space-y-3">
                <textarea
                  rows={3}
                  className="field text-xs sm:text-sm"
                  placeholder="Type your question for the host..."
                  value={questionText}
                  onChange={(e) => setQuestionText(e.target.value)}
                />

                {qaError && <div className="text-xs text-red-500">{qaError}</div>}
                {qaSuccess && <div className="text-xs text-emerald-600 font-medium">{qaSuccess}</div>}

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={submittingQa || !questionText.trim()}
                    className="btn-primary text-xs py-2 px-4 shadow-xs"
                  >
                    {submittingQa ? "Sending..." : "Submit Question to Host"}
                  </button>
                </div>
              </form>

              {/* Submitted Questions by this user */}
              {myQuestions.length > 0 && (
                <div className="mt-4 pt-4 border-t border-[#E1E1DC] dark:border-[#2A2E52] space-y-2">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                    Your Questions Sent:
                  </div>
                  {myQuestions.map((q) => (
                    <div
                      key={q.id}
                      className="p-3 rounded-lg bg-[#F8F8F5] dark:bg-[#1B1E3F]/40 border border-[#EBEBE6] dark:border-[#2A2E52] text-xs space-y-1.5"
                    >
                      <div className="font-medium text-gray-800 dark:text-gray-200">"{q.text || q.questionText}"</div>
                      <div className="text-[10px] text-gray-400">
                        Sent {new Date(q.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </div>
                      {(q.answer || q.answerText) && (
                        <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-800 dark:text-emerald-300 text-xs">
                          <span className="font-bold mr-1">💬 Host Response:</span>
                          {q.answer || q.answerText}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="text-center text-xs text-gray-400">
              Q&A is not enabled for this session.
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
