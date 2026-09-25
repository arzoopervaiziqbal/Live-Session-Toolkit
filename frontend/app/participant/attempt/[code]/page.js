"use client";
import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Navbar from "../../../../components/Navbar";
import { useLang } from "../../../../contexts/LangContext";
import { api } from "../../../../lib/api";
import { getSocket, RTC_CONFIG } from "../../../../lib/socket";

const QUESTION_TIME_LIMIT = 60; // 60 seconds per question

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

export default function AttemptPage() {
  const { t } = useLang();
  const params = useParams();
  const router = useRouter();

  const [guestName, setGuestName] = useState("");
  const [guestId, setGuestId] = useState(null);
  const [activity, setActivity] = useState(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState(QUESTION_TIME_LIMIT);
  const [answers, setAnswers] = useState({});
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [timedOutNotice, setTimedOutNotice] = useState(false);
  const [showQaModal, setShowQaModal] = useState(false);
  const [qaQuestion, setQaQuestion] = useState("");
  const [qaSending, setQaSending] = useState(false);
  const [qaMsg, setQaMsg] = useState("");
  const [unreadQaCount, setUnreadQaCount] = useState(0);

  // Anti-Cheat & Proctoring States
  const [isDisqualified, setIsDisqualified] = useState(false);
  const [disqualificationReason, setDisqualificationReason] = useState("");
  const [proctorWarning, setProctorWarning] = useState(null);
  const [hostNotice, setHostNotice] = useState(null);
  const [proctorViolationsCount, setProctorViolationsCount] = useState(0);
  const proctorCooldownRef = useRef(0);
  const initialDimensionsRef = useRef({ width: 0, height: 0 });

  // Screen Sharing State for Participant
  const [hostSharingScreen, setHostSharingScreen] = useState(false);
  const [screenExpanded, setScreenExpanded] = useState(true);
  const [screenFrameSrc, setScreenFrameSrc] = useState(null);
  const [remoteMediaStream, setRemoteMediaStream] = useState(null);

  const remoteVideoRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const pendingCandidatesRef = useRef([]);
  const notificationTimerRef = useRef(null);

  // Keep refs up-to-date for interval callback
  const answersRef = useRef(answers);
  answersRef.current = answers;

  const currentIndexRef = useRef(currentIndex);
  currentIndexRef.current = currentIndex;

  const activityRef = useRef(activity);
  activityRef.current = activity;

  const submittingRef = useRef(submitting);
  submittingRef.current = submitting;

  const guestIdRef = useRef(guestId);
  guestIdRef.current = guestId;

  function triggerNotification(notif) {
    if (notificationTimerRef.current) {
      clearTimeout(notificationTimerRef.current);
    }
    setQaNotification(notif);
    setUnreadQaCount((prev) => prev + 1);

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
    const storedGuestId = sessionStorage.getItem("sp_guest_id");
    const storedName = sessionStorage.getItem("sp_guest_name");
    if (!storedGuestId) {
      router.replace("/participant/join");
      return;
    }
    setGuestId(storedGuestId);
    setGuestName(storedName || "");
    api
      .joinByCode(params.code, storedGuestId, storedName || "Guest")
      .then((data) => {
        setActivity(data.activity);
        if (data.status === "disqualified") {
          setIsDisqualified(true);
          setDisqualificationReason("You were previously disqualified by the host.");
        }
      })
      .catch(() => router.replace("/participant/join"));
  }, [params.code, router]);

  // Real-time Socket.IO Connection: Q&A Toggle and Screen Sharing
  useEffect(() => {
    if (!params.code) return;
    const socket = getSocket();
    const linkId = String(params.code).toLowerCase().trim();

    function sendJoin() {
      const aliasRooms = new Set([
        String(params.code || "").toLowerCase().trim(),
        String(activity?.linkId || "").toLowerCase().trim(),
        String(activity?._id || "").toLowerCase().trim(),
      ]);
      aliasRooms.forEach((r) => {
        if (r) {
          socket.emit("join-session", {
            linkId: r,
            role: "participant",
            participantId: guestId,
            displayName: guestName,
          });
        }
      });
      // Request active screen share or buffered snapshot immediately
      socket.emit("request-screen-sync", { linkId: activity?.linkId || linkId });
    }

    sendJoin();
    socket.on("connect", sendJoin);

    // Real-time Q&A toggle from host
    socket.on("qa-updated", ({ allowQa }) => {
      setActivity((prev) => (prev ? { ...prev, allowQa: Boolean(allowQa) } : prev));
    });

    // Real-time Q&A updates
    socket.on("qa-new-question", ({ item, qaFeed }) => {
      setActivity((prev) => {
        if (!prev) return prev;
        const currentFeed = parseQaFeed(prev.qaFeed);
        const incoming = qaFeed ? parseQaFeed(qaFeed) : null;
        const exists = item?.id ? currentFeed.some((q) => q.id === item.id) : false;
        const updated = incoming || (exists ? currentFeed : [...currentFeed, item]);
        return { ...prev, qaFeed: updated };
      });
      if (item && item.participantId !== guestIdRef.current) {
        setUnreadQaCount((prev) => prev + 1);
      }
    });

    socket.on("qa-answered", ({ qaFeed, answeredItem, questionId }) => {
      const parsedFeed = parseQaFeed(qaFeed);
      setActivity((prev) => {
        if (!prev) return prev;
        const oldFeed = parseQaFeed(prev.qaFeed);

        let target = answeredItem;
        if (!target && questionId) {
          target = parsedFeed.find((q) => q.id === questionId);
        }
        if (!target) {
          target = parsedFeed.find((newQ) => {
            const oldQ = oldFeed.find((o) => o.id === newQ.id);
            const newAns = newQ.answer || newQ.answerText;
            const oldAns = oldQ ? (oldQ.answer || oldQ.answerText) : null;
            return newAns && newAns !== oldAns;
          });
        }

        if (target && (target.answer || target.answerText)) {
          const isMine = Boolean(target.participantId && target.participantId === guestIdRef.current);
          triggerNotification({
            id: target.id + "_" + Date.now(),
            targetId: target.id,
            isMyQuestion: isMine,
            questionText: target.text || target.questionText || "Question",
            replyText: target.answer || target.answerText,
            senderName: target.participantName || target.displayName || "Participant",
          });
        }

        return { ...prev, qaFeed: parsedFeed };
      });
    });

    socket.on("qa-deleted", ({ qaFeed }) => {
      setActivity((prev) => (prev ? { ...prev, qaFeed: parseQaFeed(qaFeed) } : prev));
    });

    // Host Decision on Proctor Violation (continue or fail student)
    socket.on("quiz-proctor-decision", (payload) => {
      const myGuestId = guestIdRef.current || guestId;
      const isTarget =
        (payload?.guestId && payload.guestId === myGuestId) ||
        (payload?.participantId && payload.participantId === myGuestId);
      if (!isTarget) return;

      if (payload?.decision === "fail") {
        setIsDisqualified(true);
        setDisqualificationReason(
          payload?.reason || "Disqualified by host for switching tabs or altering screen dimensions during quiz."
        );
        setProctorWarning(null);
      } else if (payload?.decision === "continue") {
        setProctorWarning(null);
        setHostNotice(payload?.message || "Host reviewed your activity and permitted you to continue the quiz. Please keep this tab active!");
        setTimeout(() => setHostNotice(null), 7000);
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
      pendingCandidatesRef.current = [];

      pc.ontrack = (event) => {
        if (event.streams && event.streams[0]) {
          remoteStreamRef.current = event.streams[0];
          setRemoteMediaStream(event.streams[0]);
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = event.streams[0];
            remoteVideoRef.current.play().catch(() => {});
          }
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

      // Request host to send WebRTC offer
      socket.emit("screen-share-request", {
        hostSocketId,
        participantName: guestName || "Student",
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
            if (event.streams && event.streams[0]) {
              remoteStreamRef.current = event.streams[0];
              setRemoteMediaStream(event.streams[0]);
              if (remoteVideoRef.current) {
                remoteVideoRef.current.srcObject = event.streams[0];
                remoteVideoRef.current.play().catch(() => {});
              }
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

        // Flush any queued ICE candidates
        while (pendingCandidatesRef.current.length > 0) {
          const cand = pendingCandidatesRef.current.shift();
          try {
            await pc.addIceCandidate(new RTCIceCandidate(cand));
          } catch (e) {}
        }

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socket.emit("screen-share-answer", {
          hostSocketId,
          answer,
        });
      } catch (err) {
        console.warn("Error answering WebRTC offer:", err);
      }
    });

    // WebRTC ICE candidates from host
    socket.on("screen-share-ice", async ({ candidate }) => {
      const pc = peerConnectionRef.current;
      if (pc && candidate) {
        try {
          if (pc.remoteDescription && pc.remoteDescription.type) {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } else {
            pendingCandidatesRef.current.push(candidate);
          }
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
      setRemoteMediaStream(null);
      remoteStreamRef.current = null;
      pendingCandidatesRef.current = [];
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = null;
      }
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }
    });

    return () => {
      socket.off("connect", sendJoin);
      socket.off("qa-updated");
      socket.off("qa-new-question");
      socket.off("qa-answered");
      socket.off("qa-deleted");
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
  }, [params.code, guestId, guestName]);

  // Ensure remote stream is bound whenever video mounts or expands
  useEffect(() => {
    if (remoteVideoRef.current && remoteMediaStream) {
      remoteVideoRef.current.srcObject = remoteMediaStream;
      remoteVideoRef.current.play().catch(() => {});
    }
  }, [remoteMediaStream, hostSharingScreen, screenExpanded]);

  // Reset timer when question index changes
  useEffect(() => {
    setTimeLeft(QUESTION_TIME_LIMIT);
    setTimedOutNotice(false);
  }, [currentIndex]);

  // 60-second Countdown Timer per question (ONLY when has questions!)
  useEffect(() => {
    if (!activity || !activity.questions || activity.questions.length === 0 || submitting) return;

    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          // Time expired for this question!
          handleTimeExpired();
          return QUESTION_TIME_LIMIT;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [activity, submitting, isDisqualified]);

  // Anti-Cheat Proctoring Monitor: Tab switch, Window blur, Screen cropping/resizing
  useEffect(() => {
    if (!hasQuestions || isDisqualified || submitting) return;

    if (typeof window !== "undefined") {
      initialDimensionsRef.current = {
        width: window.innerWidth,
        height: window.innerHeight,
      };
    }

    function triggerViolation(type, message) {
      const now = Date.now();
      if (now - proctorCooldownRef.current < 4000) return;
      proctorCooldownRef.current = now;

      setProctorViolationsCount((c) => c + 1);
      setProctorWarning({
        type,
        message,
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      });

      const targetCode = activity?.linkId || params.code;
      const payload = {
        linkId: targetCode,
        activityId: activity?._id,
        guestId: guestIdRef.current || guestId,
        participantId: guestIdRef.current || guestId,
        displayName: guestName || "Student",
        violationType: type,
        message,
      };

      try {
        const socket = getSocket();
        socket.emit("quiz-proctor-alert", payload);
      } catch (_) {}

      api.reportProctorViolation(targetCode, payload).catch(() => {});
    }

    function handleVisibilityChange() {
      if (document.hidden) {
        triggerViolation(
          "tab_switch",
          "Student switched browser tab or minimized the exam window."
        );
      }
    }

    function handleBlur() {
      triggerViolation(
        "window_blur",
        "Student switched window focus or clicked outside the exam."
      );
    }

    function handleResize() {
      const init = initialDimensionsRef.current;
      if (!init.width || !init.height) return;

      const dw = init.width - window.innerWidth;
      const dh = init.height - window.innerHeight;

      if (dw > 160 || dh > 160) {
        triggerViolation(
          "screen_crop",
          "Student cropped or resized the screen to split-screen/smaller dimensions."
        );
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", handleBlur);
    window.addEventListener("resize", handleResize);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("resize", handleResize);
    };
  }, [hasQuestions, isDisqualified, submitting, activity, params.code, guestId, guestName]);

  function handleTimeExpired() {
    const act = activityRef.current;
    if (!act || !act.questions || submittingRef.current) return;

    const cur = currentIndexRef.current;
    if (cur < act.questions.length - 1) {
      // Auto-advance to next question
      setTimedOutNotice(true);
      setCurrentIndex((prev) => prev + 1);
    } else {
      // Final question time expired: auto submit!
      executeSubmit(answersRef.current);
    }
  }

  function setAnswer(qId, value) {
    setAnswers((prev) => ({ ...prev, [qId]: value }));
  }

  async function executeSubmit(answersToSubmit) {
    if (submittingRef.current) return;
    setSubmitting(true);
    setError("");

    try {
      const data = await api.submitAnswers(params.code, guestId, answersToSubmit);
      sessionStorage.setItem("sp_last_result", JSON.stringify(data.result));
      router.push("/participant/result");
    } catch (err) {
      setError(err.body?.error || "Couldn't submit answers. Please try again.");
      setSubmitting(false);
    }
  }

  async function handleManualSubmit() {
    executeSubmit(answers);
  }

  function goToNext() {
    if (!activity?.questions) return;
    if (currentIndex < activity.questions.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    } else {
      handleManualSubmit();
    }
  }

  function goToPrev() {
    if (currentIndex > 0) {
      setCurrentIndex((prev) => prev - 1);
    }
  }

  async function submitLiveQuestion() {
    if (!qaQuestion.trim()) return;
    setQaSending(true);
    setQaMsg("");
    const targetCode = activity?.linkId || params.code;
    const textToSend = qaQuestion.trim();
    try {
      const res = await api.postParticipantQuestion(targetCode, {
        participantId: guestId,
        displayName: guestName || "Participant",
        questionText: textToSend,
      });

      // Emit over socket directly for instant delivery across all participants & host
      try {
        const socket = getSocket();
        socket.emit("qa-new-question", {
          linkId: targetCode,
          activityId: activity?._id,
          item: res?.item,
          qaFeed: res?.qaFeed,
        });
      } catch (_) {}

      // Update local state immediately
      if (res?.qaFeed) {
        setActivity((prev) => (prev ? { ...prev, qaFeed: res.qaFeed } : prev));
      } else if (res?.item) {
        setActivity((prev) => {
          if (!prev) return prev;
          const currentFeed = parseQaFeed(prev.qaFeed);
          return { ...prev, qaFeed: [...currentFeed, res.item] };
        });
      }

      setQaMsg("Question sent to host!");
      setQaQuestion("");
      setTimeout(() => {
        setQaMsg("");
        setShowQaModal(false);
      }, 1500);
    } catch (err) {
      setQaMsg(err.message || "Failed to send question.");
    } finally {
      setQaSending(false);
    }
  }

  const hasQuestions = Array.isArray(activity?.questions) && activity.questions.length > 0;

  const notificationBanner = qaNotification ? (
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

          <div className="mt-2.5 flex items-center justify-between text-[11px]">
            <span className="text-gray-400 text-[10px]">Just now</span>
            <button
              type="button"
              onClick={() => {
                if (hasQuestions) {
                  setShowQaModal(true);
                  setUnreadQaCount(0);
                } else {
                  const el = document.getElementById(`qa-item-${qaNotification.targetId}`);
                  if (el) {
                    el.scrollIntoView({ behavior: "smooth", block: "center" });
                    el.classList.add("ring-2", "ring-emerald-500", "transition-all");
                    setTimeout(() => el.classList.remove("ring-2", "ring-emerald-500"), 3500);
                  }
                }
                setQaNotification(null);
              }}
              className="text-emerald-400 hover:text-emerald-300 font-semibold underline underline-offset-2 flex items-center gap-1 cursor-pointer"
            >
              <span>View in Q&A</span>
              <span>→</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  ) : null;

  if (isDisqualified) {
    return (
      <main className="min-h-screen bg-[#FAFAF9] dark:bg-[#080915] text-gray-900 dark:text-gray-100 flex flex-col justify-between">
        <Navbar userName={guestName || undefined} logoutLabel={undefined} />

        <div className="max-w-md mx-auto px-6 py-12 text-center w-full my-auto">
          <div className="card p-8 bg-white dark:bg-[#12142B] border-2 border-rose-500 shadow-2xl rounded-3xl">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-rose-500/15 border-2 border-rose-500/30 flex items-center justify-center text-3xl">
              🚫
            </div>

            <div className="inline-block px-3 py-1 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 font-bold text-xs uppercase tracking-wider mb-2 border border-rose-500/20">
              Exam Disqualified
            </div>

            <h1 className="font-display text-xl sm:text-2xl font-black text-rose-600 dark:text-rose-400 mb-2">
              Quiz Attempt Terminated
            </h1>

            <p className="text-xs text-gray-600 dark:text-gray-300 mb-6 leading-relaxed">
              {disqualificationReason || "The host has marked your attempt as FAILED due to tab switching or screen cropping violations."}
            </p>

            <div className="p-4 rounded-2xl bg-rose-500/5 dark:bg-rose-950/20 border border-rose-500/20 mb-6 text-left space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500 font-medium">Participant:</span>
                <span className="font-bold text-gray-900 dark:text-gray-100">{guestName || "Student"}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500 font-medium">Exam Status:</span>
                <span className="font-bold text-rose-500">Failed (Disqualified)</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500 font-medium">Final Score:</span>
                <span className="font-mono font-bold text-rose-600">0 / {activity?.questions?.length || 0} Marks (0%)</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => router.push("/participant/join")}
              className="w-full btn-primary text-xs py-3 font-bold bg-rose-600 hover:bg-rose-700 text-white border-0 shadow-md cursor-pointer"
            >
              Exit Session
            </button>
          </div>
        </div>

        <div className="py-4 text-center text-[11px] text-gray-400">
          Live Session Toolkit Anti-Cheat Proctoring
        </div>
      </main>
    );
  }

  if (!activity) {
    return (
      <main className="min-h-screen">
        <Navbar userName={guestName || undefined} logoutLabel={undefined} />
        <div className="max-w-lg mx-auto px-6 py-16 text-center text-sm text-gray-400">
          Connecting to live session…
        </div>
      </main>
    );
  }

  const floatingQaButton = (
    <button
      type="button"
      id="student-floating-qa-btn"
      onClick={() => {
        setShowQaModal(true);
        setUnreadQaCount(0);
      }}
      style={{
        position: "fixed",
        bottom: "24px",
        right: "24px",
        zIndex: 9999,
      }}
      className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-2xl rounded-full px-4 py-2.5 flex items-center gap-2 border border-emerald-400/40 transition-all hover:scale-105 active:scale-95 cursor-pointer"
      aria-label="Open Q&A"
    >
      <span className="text-base sm:text-lg">💬</span>
      <span className="text-xs font-bold tracking-wide">Q&A</span>
      {unreadQaCount > 0 && (
        <span
          style={{ position: "absolute", top: "-6px", right: "-6px" }}
          className="bg-rose-500 text-white text-[10px] font-extrabold px-1.5 py-0.5 min-w-[20px] rounded-full flex items-center justify-center border-2 border-white dark:border-[#080915] shadow-md animate-pulse"
        >
          +{unreadQaCount}
        </span>
      )}
    </button>
  );

  const qaModalElement = showQaModal ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="card w-full max-w-lg p-6 bg-white dark:bg-[#12142B] border border-[#E1E1DC] dark:border-[#2A2E52] shadow-2xl rounded-2xl relative max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-3 mb-4 border-b border-[#E1E1DC] dark:border-[#2A2E52]">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <h3 className="font-display font-bold text-sm text-gray-900 dark:text-gray-100">
              Live Session Q&A
            </h3>
          </div>
          <button
            type="button"
            onClick={() => setShowQaModal(false)}
            className="text-gray-400 hover:text-gray-600 text-sm font-bold p-1 cursor-pointer"
          >
            ✕
          </button>
        </div>

        {!activity?.allowQa ? (
          <div>
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-700 dark:text-amber-400 text-xs text-center mb-4 font-medium">
              ⚠️ The host has temporarily paused Q&A for this session. You will be able to submit questions when the host re-enables it.
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                className="btn-secondary text-xs py-1.5 px-3 cursor-pointer"
                onClick={() => setShowQaModal(false)}
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-xs text-gray-500 mb-3">
              Have a doubt or question during this session? The host sees questions in real time and replies below.
            </p>

            <textarea
              rows={3}
              className="field text-xs sm:text-sm mb-2"
              placeholder="Type your question for the host..."
              value={qaQuestion}
              onChange={(e) => setQaQuestion(e.target.value)}
            />

            {qaMsg && (
              <div className={`text-xs mb-3 font-medium ${qaMsg.includes("sent") ? "text-emerald-600" : "text-red-500"}`}>
                {qaMsg}
              </div>
            )}

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                className="btn-secondary text-xs py-2 px-3 cursor-pointer"
                onClick={() => setShowQaModal(false)}
              >
                Close
              </button>
              <button
                type="button"
                className="btn-primary text-xs py-2 px-4 shadow-xs cursor-pointer font-bold"
                onClick={submitLiveQuestion}
                disabled={qaSending || !qaQuestion.trim()}
              >
                {qaSending ? "Sending..." : "Submit Question"}
              </button>
            </div>

            {/* Real-Time Questions and Host Replies List */}
            {parseQaFeed(activity?.qaFeed).length > 0 && (
              <div className="mt-5 pt-4 border-t border-[#E1E1DC] dark:border-[#2A2E52]">
                <div className="text-xs font-bold text-gray-800 dark:text-gray-200 mb-2.5 flex items-center justify-between">
                  <span>Questions & Host Replies ({parseQaFeed(activity?.qaFeed).length})</span>
                  <span className="text-[10px] text-gray-400 font-mono">Live Sync</span>
                </div>
                <div className="max-h-56 overflow-y-auto space-y-2.5 pr-1">
                  {parseQaFeed(activity?.qaFeed).map((q) => {
                    const isMyQ = q.participantId === guestId;
                    const ans = q.answer || q.answerText || "";
                    const prompt = q.text || q.questionText || "";
                    const name = q.participantName || q.displayName || "Participant";
                    const answered = Boolean(q.isAnswered || ans);

                    return (
                      <div
                        key={q.id}
                        className={`p-3 rounded-xl border text-xs transition-all ${
                          answered
                            ? "bg-emerald-500/[0.04] border-emerald-500/30"
                            : "bg-[#FAFAF9] dark:bg-[#1B1E3F]/40 border-gray-200 dark:border-[#2A2E52]"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1 mb-1">
                          <span className="font-semibold text-xs text-gray-900 dark:text-gray-100">
                            {name} {isMyQ && <span className="text-primary font-bold">(You)</span>}
                          </span>
                          {answered ? (
                            <span className="text-[10px] text-emerald-600 font-bold bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                              ✓ Answered
                            </span>
                          ) : (
                            <span className="text-[10px] text-amber-600 font-medium bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                              Pending Host
                            </span>
                          )}
                        </div>
                        <div className="text-gray-700 dark:text-gray-200 mb-1.5">"{prompt}"</div>
                        {answered && (
                          <div className="mt-1.5 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-900 dark:text-emerald-300">
                            <span className="font-bold mr-1">Host Response:</span>
                            {ans || "Question marked as answered by host."}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  ) : null;

  // IF NO QUESTIONS: RENDER DEDICATED LIVE ROOM (Screen Share + Live Q&A)
  if (!hasQuestions) {
    const qaList = parseQaFeed(activity.qaFeed);

    return (
      <main className="min-h-screen pb-28 sm:pb-32 bg-[#FAFAF9] dark:bg-[#080915] relative">
        {notificationBanner}
        <Navbar userName={guestName || undefined} logoutLabel={undefined} />

        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
          {/* Live Session Header */}
          <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500"></span>
                </span>
                <span className="text-xs font-bold text-rose-500 uppercase tracking-wider">
                  Live Session Active
                </span>
                <span className="text-[11px] font-mono text-gray-400 bg-[#E1E1DC] dark:bg-[#1B1E3F] px-2 py-0.5 rounded">
                  Code: {params.code}
                </span>
              </div>
              <h1 className="font-display text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">
                {activity.title}
              </h1>
            </div>

            <div className="flex items-center gap-2 text-xs">
              <span className="px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-semibold flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                Joined as {guestName || "Guest"}
              </span>
              <button
                type="button"
                onClick={() => {
                  setShowQaModal(true);
                  setUnreadQaCount(0);
                }}
                className="relative px-3 py-1 rounded-full bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
                title="Open Live Q&A"
              >
                <span>💬</span>
                <span>Live Q&A</span>
                {unreadQaCount > 0 && (
                  <span className="bg-rose-500 text-white text-[10px] font-extrabold px-1.5 py-0.2 min-w-[18px] rounded-full flex items-center justify-center shadow-xs animate-pulse">
                    +{unreadQaCount}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* Real-Time Screen Share Viewer */}
          <div className="card mb-6 p-4 border-2 border-primary/40 bg-[#0A0D1E] text-white shadow-xl rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between gap-2 pb-2.5 mb-2.5 border-b border-white/10">
              <div className="flex items-center gap-2">
                {hostSharingScreen ? (
                  <>
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500"></span>
                    </span>
                    <span className="text-xs font-bold text-gray-200 uppercase tracking-wider">
                      Host's Screen Broadcast
                    </span>
                    <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/15 px-1.5 py-0.5 rounded border border-emerald-500/30">
                      HD Real-Time
                    </span>
                  </>
                ) : (
                  <>
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                    <span className="text-xs font-semibold text-gray-300">
                      Live Screen Broadcast Standby
                    </span>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowQaModal(true);
                    setUnreadQaCount(0);
                  }}
                  className="text-[11px] bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/30 px-2.5 py-1 rounded-md transition-colors font-medium flex items-center gap-1 cursor-pointer"
                  title="Open Live Q&A"
                >
                  <span>💬</span>
                  <span>Q&A</span>
                  {unreadQaCount > 0 && (
                    <span className="bg-rose-500 text-white text-[9px] font-bold px-1 py-0.2 rounded-full animate-pulse">
                      +{unreadQaCount}
                    </span>
                  )}
                </button>
                {hostSharingScreen && (
                  <button
                    type="button"
                    onClick={() => setScreenExpanded((prev) => !prev)}
                    className="text-[11px] bg-white/10 hover:bg-white/20 text-gray-200 px-2.5 py-1 rounded-md transition-colors font-medium"
                  >
                    {screenExpanded ? "Minimize" : "Expand"}
                  </button>
                )}
              </div>
            </div>

            {hostSharingScreen ? (
              screenExpanded ? (
                <div className="relative aspect-video w-full bg-black rounded-xl overflow-hidden flex items-center justify-center border border-white/10">
                  <video
                    ref={(el) => {
                      remoteVideoRef.current = el;
                      if (el && remoteStreamRef.current) {
                        el.srcObject = remoteStreamRef.current;
                        el.play().catch(() => {});
                      }
                    }}
                    autoPlay
                    playsInline
                    muted
                    className={`w-full h-full object-contain ${
                      remoteMediaStream ? "block" : "hidden"
                    }`}
                  />
                  {!remoteMediaStream && screenFrameSrc && (
                    <img
                      src={screenFrameSrc}
                      alt="Host Live Screen"
                      className="w-full h-full object-contain block"
                    />
                  )}
                  {!remoteMediaStream && !screenFrameSrc && (
                    <div className="flex flex-col items-center justify-center p-8 text-center text-gray-400">
                      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mb-3" />
                      <div className="text-xs font-semibold text-gray-200">
                        Connecting to host screen broadcast…
                      </div>
                      <div className="text-[11px] text-gray-500 mt-1">
                        Receiving live video feed
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-[11px] text-gray-400 text-center py-2">
                  Screen share minimized. Click "Expand" to watch in high definition.
                </div>
              )
            ) : (
              <div className="aspect-video w-full bg-black/60 rounded-xl border border-white/5 flex flex-col items-center justify-center p-6 text-center">
                <div className="text-4xl mb-3 animate-pulse">📺</div>
                <div className="text-sm font-semibold text-gray-200 mb-1">
                  Waiting for Host to Share Screen
                </div>
                <p className="text-xs text-gray-400 max-w-sm">
                  The host is preparing their presentation. As soon as screen sharing starts, it will appear here in real time.
                </p>
              </div>
            )}
          </div>

          {/* Interactive Live Q&A Section */}
          <div className="card p-6 bg-white dark:bg-[#12142B] border border-[#E1E1DC] dark:border-[#2A2E52] shadow-sm rounded-2xl">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-4 mb-4 border-b border-[#E1E1DC] dark:border-[#2A2E52]">
              <div className="flex items-center gap-2">
                <span className="text-base">💬</span>
                <div>
                  <h3 className="font-display font-bold text-sm text-gray-900 dark:text-gray-100">
                    Live Session Q&A
                  </h3>
                  <p className="text-[11px] text-gray-500">
                    Ask questions live. The host sees questions in real-time and answers during the session.
                  </p>
                </div>
              </div>

              <div>
                {activity.allowQa ? (
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Q&A Active
                  </span>
                ) : (
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                    ⏸️ Q&A Paused by Host
                  </span>
                )}
              </div>
            </div>

            {/* Ask Host Input Box (if allowed) */}
            {activity.allowQa ? (
              <div className="mb-6 p-4 rounded-xl bg-[#FAF9F6] dark:bg-[#161836] border border-[#E1E1DC] dark:border-[#2A2E52]">
                <label className="label text-xs mb-1.5 font-bold">Ask Host a Question</label>
                <textarea
                  rows={2}
                  className="field text-xs sm:text-sm mb-2"
                  placeholder="Type your question for the host here..."
                  value={qaQuestion}
                  onChange={(e) => setQaQuestion(e.target.value)}
                />
                {qaMsg && (
                  <div className={`text-xs mb-2 font-medium ${qaMsg.includes("sent") ? "text-emerald-600" : "text-rose-500"}`}>
                    {qaMsg}
                  </div>
                )}
                <div className="flex justify-end">
                  <button
                    type="button"
                    className="btn-primary text-xs py-2 px-4 shadow-sm font-semibold flex items-center gap-1.5"
                    onClick={submitLiveQuestion}
                    disabled={qaSending || !qaQuestion.trim()}
                  >
                    <span>💬</span>
                    <span>{qaSending ? "Sending…" : "Submit Question"}</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-3.5 mb-6 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 text-xs">
                ⚠️ The host has currently paused Q&A submissions. You can see answers below and ask again when re-enabled.
              </div>
            )}

            {/* Live Questions Feed */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold uppercase tracking-wider text-gray-500">
                  Questions Feed ({qaList.length})
                </span>
                <span className="text-[11px] text-gray-400 font-mono">Real-time updates</span>
              </div>

              {qaList.length === 0 ? (
                <div className="py-8 text-center text-xs text-gray-400">
                  No questions asked yet. Be the first to ask the host a question!
                </div>
              ) : (
                <div className="space-y-3">
                  {qaList.map((q) => {
                    const isMyQuestion = q.participantId === guestId;
                    const questionAnswer = q.answer || q.answerText || "";
                    const questionPrompt = q.text || q.questionText || "";
                    const studentName = q.participantName || q.displayName || "Participant";
                    const isAnswered = Boolean(q.isAnswered || questionAnswer);

                    return (
                      <div
                        key={q.id}
                        id={`qa-item-${q.id}`}
                        className={`p-3.5 rounded-xl border transition-all ${
                          isAnswered
                            ? "bg-emerald-500/[0.04] border-emerald-500/30 dark:bg-emerald-950/10"
                            : "bg-[#FAFAF9] dark:bg-[#161836] border-[#E1E1DC] dark:border-[#2A2E52]"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-xs text-gray-900 dark:text-gray-100">
                              {studentName}
                            </span>
                            {isMyQuestion && (
                              <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-bold">
                                You
                              </span>
                            )}
                          </div>
                          {isAnswered ? (
                            <span className="text-[10px] font-bold text-emerald-600 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 flex items-center gap-1">
                              <span>✓</span> Answered
                            </span>
                          ) : (
                            <span className="text-[10px] font-medium text-amber-600 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                              Pending Host
                            </span>
                          )}
                        </div>

                        <p className="text-xs text-gray-700 dark:text-gray-200 mb-2">
                          "{questionPrompt}"
                        </p>

                        {isAnswered && (
                          <div className="mt-2.5 pt-2.5 border-t border-emerald-500/20 pl-3 border-l-2 border-l-emerald-500 bg-emerald-500/5 dark:bg-emerald-950/20 p-2.5 rounded-r-lg text-xs">
                            <div className="flex items-center gap-1.5 font-bold text-emerald-600 dark:text-emerald-400 mb-1">
                              <span>💬</span>
                              <span>Host's Reply:</span>
                            </div>
                            <div className="text-gray-900 dark:text-gray-100 font-medium">
                              {questionAnswer || "Question marked as answered by host."}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
        {floatingQaButton}
        {qaModalElement}
      </main>
    );
  }

  const currentQ = activity.questions[currentIndex];
  const isLastQuestion = currentIndex === activity.questions.length - 1;
  const progressPercent = ((QUESTION_TIME_LIMIT - timeLeft) / QUESTION_TIME_LIMIT) * 100;
  const timerUrgent = timeLeft <= 10;
  const timerWarning = timeLeft <= 20 && timeLeft > 10;

  return (
    <main className="min-h-screen pb-28 sm:pb-32 bg-[#FAFAF9] dark:bg-[#080915] relative">
      {notificationBanner}

      {/* Proctoring Warning Banner */}
      {proctorWarning && (
        <div
          role="alert"
          className="fixed top-6 left-1/2 -translate-x-1/2 z-50 max-w-lg w-[92%] bg-[#1A0B0E]/95 border-2 border-rose-500 text-white shadow-2xl rounded-2xl p-4 backdrop-blur-md animate-in slide-in-from-top-4 ring-4 ring-rose-500/20"
        >
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-400 flex items-center justify-center text-xl shrink-0">
              ⚠️
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-1 mb-1">
                <span className="text-xs font-bold text-rose-400 uppercase tracking-wider">
                  Anti-Cheat Warning (#{proctorViolationsCount})
                </span>
                <span className="text-[10px] text-gray-400 font-mono">
                  {proctorWarning.time}
                </span>
              </div>
              <div className="text-xs font-bold text-white mb-1">
                {proctorWarning.type === "screen_crop"
                  ? "Screen Cropping / Window Resize Detected!"
                  : "Tab Switch / Window Blur Detected!"}
              </div>
              <p className="text-[11px] text-gray-300 mb-3 leading-relaxed">
                You are not allowed to crop the screen or switch tabs during this quiz. Your host has been notified in real time and has the option to fail your exam or allow you to continue.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setProctorWarning(null)}
                  className="text-xs bg-rose-600 hover:bg-rose-500 text-white font-bold py-1.5 px-3.5 rounded-lg transition-colors cursor-pointer"
                >
                  Return to Exam Screen
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Host Decision Notice */}
      {hostNotice && (
        <div
          role="alert"
          className="fixed top-6 left-1/2 -translate-x-1/2 z-50 max-w-md w-[92%] bg-[#0A1A12]/95 border-2 border-emerald-500 text-white shadow-2xl rounded-2xl p-4 backdrop-blur-md animate-in slide-in-from-top-4 flex items-center gap-3"
        >
          <span className="text-2xl">✓</span>
          <div className="text-xs font-medium text-emerald-200">
            {hostNotice}
          </div>
        </div>
      )}

      <Navbar userName={guestName || undefined} logoutLabel={undefined} />

      <div className="max-w-xl mx-auto px-4 sm:px-6 py-8">
        {/* Quiz Title & Header */}
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">
              {activity.type || "Quiz"} • {activity.difficulty || "Medium"}
            </span>
            <h1 className="font-display text-xl font-bold text-gray-900 dark:text-gray-100">
              {activity.title}
            </h1>
          </div>

          {/* Header Actions: Q&A and 60s Countdown Timer Badge */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setShowQaModal(true);
                setUnreadQaCount(0);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-semibold transition-all cursor-pointer"
              title="Open Q&A"
            >
              <span>💬</span>
              <span>Q&A</span>
              {unreadQaCount > 0 && (
                <span className="bg-rose-500 text-white text-[10px] font-extrabold px-1.5 py-0.5 rounded-full animate-pulse">
                  +{unreadQaCount}
                </span>
              )}
            </button>

            <div
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-mono font-bold transition-all duration-300 shadow-xs ${
                timerUrgent
                  ? "bg-rose-500/15 border-rose-500/40 text-rose-600 animate-pulse scale-105"
                  : timerWarning
                  ? "bg-amber-500/15 border-amber-500/40 text-amber-600"
                  : "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
              }`}
              title="60 seconds for this question"
            >
              <span className="text-sm">{timerUrgent ? "🔥" : "⏱️"}</span>
              <span>{timeLeft}s</span>
            </div>
          </div>
        </div>

        {/* 60s Depleting Progress Bar */}
        <div className="w-full bg-[#E1E1DC] dark:bg-[#1B1E3F] h-2 rounded-full overflow-hidden mb-6">
          <div
            className={`h-full transition-all duration-1000 ease-linear rounded-full ${
              timerUrgent
                ? "bg-rose-500"
                : timerWarning
                ? "bg-amber-500"
                : "bg-emerald-500"
            }`}
            style={{ width: `${100 - progressPercent}%` }}
          />
        </div>

        {/* Question Progress Tracker Pills */}
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">
            Question {currentIndex + 1} of {activity.questions.length}
          </span>
          <div className="flex items-center gap-1.5">
            {activity.questions.map((q, idx) => {
              const hasAnswer = answers[q.questionId] !== undefined && answers[q.questionId] !== "";
              const isCurrent = idx === currentIndex;

              return (
                <button
                  key={q.questionId || idx}
                  type="button"
                  onClick={() => setCurrentIndex(idx)}
                  className={`w-6 h-6 rounded-full text-[11px] font-mono font-bold flex items-center justify-center transition-all ${
                    isCurrent
                      ? "ring-2 ring-primary ring-offset-2 bg-primary text-white scale-110"
                      : hasAnswer
                      ? "bg-emerald-500/20 text-emerald-600 border border-emerald-500/30"
                      : "bg-[#E1E1DC] dark:bg-[#1B1E3F] text-gray-400"
                  }`}
                  title={`Go to Question ${idx + 1}`}
                >
                  {idx + 1}
                </button>
              );
            })}
          </div>
        </div>

        {/* Timed-out Toast Alert */}
        {timedOutNotice && (
          <div className="mb-4 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 text-xs flex items-center justify-between">
            <span>⏱️ Time expired! Advanced to Question {currentIndex + 1}.</span>
            <button
              type="button"
              onClick={() => setTimedOutNotice(false)}
              className="text-amber-700 dark:text-amber-300 font-bold ml-2"
            >
              ✕
            </button>
          </div>
        )}

        {/* Real-Time Screen Share Viewer for Participant */}
        {hostSharingScreen && (
          <div className="card mb-6 p-4 border-2 border-primary/50 bg-[#0A0D1E] text-white shadow-xl rounded-2xl overflow-hidden">
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
                  ref={(el) => {
                    remoteVideoRef.current = el;
                    if (el && remoteStreamRef.current) {
                      el.srcObject = remoteStreamRef.current;
                      el.play().catch(() => {});
                    }
                  }}
                  autoPlay
                  playsInline
                  muted
                  className={`w-full h-full object-contain ${
                    remoteMediaStream ? "block" : "hidden"
                  }`}
                />
                {!remoteMediaStream && screenFrameSrc && (
                  <img
                    src={screenFrameSrc}
                    alt="Host Live Screen"
                    className="w-full h-full object-contain block"
                  />
                )}
                {!remoteMediaStream && !screenFrameSrc && (
                  <div className="flex flex-col items-center justify-center p-8 text-center text-gray-400">
                    <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mb-3" />
                    <div className="text-xs font-semibold text-gray-200">
                      Connecting to host screen broadcast…
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-[11px] text-gray-400 text-center py-1">
                Host screen minimized. Click "Expand Screen" above to view.
              </div>
            )}
          </div>
        )}

        {/* Active Question Card */}
        <div className="card p-6 mb-6 shadow-sm border border-[#E1E1DC] dark:border-[#2A2E52] bg-white dark:bg-[#12142B]">
          <div className="flex items-start gap-2 mb-4">
            <span className="font-mono text-xs font-bold px-2 py-0.5 rounded-md bg-primary/10 text-primary shrink-0">
              Q{currentIndex + 1}
            </span>
            <h2 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100 leading-snug">
              {currentQ.questionText}
            </h2>
          </div>

          {/* MCQ / Poll Options */}
          {(currentQ.type === "mcq" || currentQ.type === "poll") && (
            <div className="grid gap-2.5">
              {currentQ.options.map((opt, oi) => {
                const isSelected = answers[currentQ.questionId] === opt;

                return (
                  <div
                    key={oi}
                    onClick={() => setAnswer(currentQ.questionId, opt)}
                    className={`cursor-pointer text-xs sm:text-sm px-4 py-3 rounded-xl border transition-all flex items-center justify-between ${
                      isSelected
                        ? "border-primary bg-primary/10 text-primary font-medium shadow-xs ring-1 ring-primary"
                        : "border-[#E1E1DC] dark:border-[#2A2E52] hover:border-primary/50 hover:bg-[#F9F9F8] dark:hover:bg-[#1B1E3F]/40"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={`w-6 h-6 rounded-full flex items-center justify-center font-mono text-xs font-bold shrink-0 ${
                          isSelected
                            ? "bg-primary text-white"
                            : "bg-[#F0F0EB] dark:bg-[#1B1E3F] text-gray-500"
                        }`}
                      >
                        {String.fromCharCode(65 + oi)}
                      </span>
                      <span>{opt}</span>
                    </div>

                    {isSelected && <span className="text-primary font-bold text-sm">✓</span>}
                  </div>
                );
              })}
            </div>
          )}

          {/* Rating Scale (1 to 5) */}
          {currentQ.type === "rating" && (
            <div className="py-3">
              <div className="text-xs text-gray-500 mb-2">Select your rating from 1 to 5:</div>
              <div className="flex gap-3 justify-center sm:justify-start">
                {[1, 2, 3, 4, 5].map((n) => {
                  const isSelected = answers[currentQ.questionId] === n;

                  return (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setAnswer(currentQ.questionId, n)}
                      className={`w-12 h-12 flex flex-col items-center justify-center rounded-xl border cursor-pointer font-bold text-sm transition-all ${
                        isSelected
                          ? "border-primary bg-primary text-white shadow-xs scale-105"
                          : "border-[#E1E1DC] dark:border-[#2A2E52] hover:border-primary"
                      }`}
                    >
                      <span>{n}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Open Text Input */}
          {currentQ.type === "open_text" && (
            <div className="pt-2">
              <label className="label text-xs">Your Answer</label>
              <textarea
                className="field text-xs sm:text-sm"
                rows={4}
                placeholder="Type your response here..."
                value={answers[currentQ.questionId] || ""}
                onChange={(e) => setAnswer(currentQ.questionId, e.target.value)}
              />
            </div>
          )}
        </div>

        {/* Urgent Timer Alert Banner */}
        {timerUrgent && (
          <div className="mb-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs font-medium flex items-center justify-between animate-pulse">
            <span>⚠️ Hurry! Only {timeLeft} seconds remaining for this question.</span>
          </div>
        )}

        {error && <div className="error-text mb-4">{error}</div>}

        {/* Navigation & Submit Action Bar */}
        <div className="flex items-center justify-between gap-3 pt-2">
          <button
            type="button"
            className="btn-secondary text-xs py-2.5 px-4"
            onClick={goToPrev}
            disabled={currentIndex === 0 || submitting}
          >
            ← Previous
          </button>

          <div className="flex items-center gap-2">
            {isLastQuestion ? (
              <button
                type="button"
                className="btn-primary text-xs sm:text-sm py-2.5 px-6 font-bold flex items-center gap-2 shadow-sm"
                onClick={handleManualSubmit}
                disabled={submitting}
              >
                <span>{submitting ? "Submitting…" : "Submit Quiz 🎉"}</span>
              </button>
            ) : (
              <button
                type="button"
                className="btn-primary text-xs sm:text-sm py-2.5 px-5 font-semibold flex items-center gap-1.5 shadow-sm"
                onClick={goToNext}
                disabled={submitting}
              >
                <span>Next Question →</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {floatingQaButton}
      {qaModalElement}
    </main>
  );
}
