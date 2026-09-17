const { Server } = require("socket.io");
const env = require("../config/env");
const { supabase, q } = require("../config/db");

let io = null;

const room = (sessionId) => `session:${sessionId}`;
const hostRoom = (sessionId) => `host:${sessionId}`;

// Server-side auto-close timers, keyed by activity id. A host can close early;
// this is the backstop so a question always ends even if the host tab dies.
const closeTimers = new Map();

// Proctor suspension state: participantId -> { socketId, sessionId, status }
// Kept in-memory — ephemeral per quiz attempt, no DB needed.
const proctorSuspensions = new Map();

// Online participants: sessionId -> Set<participantId>
const onlineParticipants = new Map();

/**
 * Participants must not receive correct_answer while a question is open —
 * it is trivially readable in devtools.
 */
function publicActivity(activity) {
  const { correct_answer, ...rest } = activity;
  return rest;
}

function trackOnline(sessionId, participantId, online) {
  if (!sessionId || !participantId) return;
  if (!onlineParticipants.has(sessionId)) onlineParticipants.set(sessionId, new Set());
  const set = onlineParticipants.get(sessionId);
  if (online) set.add(participantId);
  else set.delete(participantId);
}

function init(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: env.clientUrl, methods: ["GET", "POST"] },
    // Keeps reconnects quick when a participant's phone flips networks.
    pingInterval: 10000,
    pingTimeout: 8000,
  });

  io.on("connection", (socket) => {
    socket.data.sessionId = null;
    socket.data.role = null;
    socket.data.participantId = null;

    /**
     * Both hosts and participants join the same session room. Hosts also join a
     * host-only room, which is where answer counts and the unmasked tally go.
     */
    socket.on("session:join", async (payload = {}, ack) => {
      try {
        const { sessionId, role = "participant", participantId = null } = payload;
        if (!sessionId) return ack?.({ ok: false, error: "sessionId is required." });

        const session = await q(
          supabase.from("sessions").select("*").eq("id", sessionId).maybeSingle(),
          "load session for socket join"
        );
        if (!session) return ack?.({ ok: false, error: "Session not found." });

        socket.data.sessionId = sessionId;
        socket.data.role = role === "host" ? "host" : "participant";
        socket.data.participantId = participantId;

        socket.join(room(sessionId));
        if (socket.data.role === "host") socket.join(hostRoom(sessionId));

        // Track online presence for participants
        if (socket.data.role === "participant" && participantId) {
          trackOnline(sessionId, participantId, true);
        }

        // Late joiners and reconnects get the full current state, including how
        // much time is left on whatever question is open right now.
        const state = await buildSessionState(session);
        ack?.({ ok: true, state, serverNow: Date.now() });

        emitPresence(sessionId);
      } catch (err) {
        ack?.({ ok: false, error: err.message });
      }
    });

    /**
     * Round-trip clock sync. The client halves the round-trip to estimate its
     * offset from server time, then derives every countdown from that offset
     * instead of its own wall clock — which is what holds devices together
     * inside the 500ms budget even when a phone's clock is minutes off.
     */
    socket.on("time:sync", (clientSentAt, ack) => {
      ack?.({ clientSentAt, serverNow: Date.now() });
    });

    // -----------------------------------------------------------------------
    // Proctoring: participant reports a violation (tab switch / blur)
    // -----------------------------------------------------------------------
    socket.on("proctor:violation", async (payload = {}, ack) => {
      try {
        const { participantId, sessionId, reason = "tab_switch" } = payload;
        if (!participantId || !sessionId) return ack?.({ ok: false });

        // Record the suspension
        proctorSuspensions.set(participantId, {
          socketId: socket.id,
          sessionId,
          status: "suspended",
          reason,
          suspendedAt: Date.now(),
        });

        // Tell the participant they're suspended
        socket.emit("proctor:suspended", { reason });

        // Fetch the participant's name so the host sees it
        const participant = await q(
          supabase.from("participants").select("id, name").eq("id", participantId).maybeSingle(),
          "load participant for proctor"
        );

        // Notify the host
        getIO().to(hostRoom(sessionId)).emit("proctor:request", {
          participantId,
          name: participant?.name || "Unknown",
          reason,
          suspendedAt: Date.now(),
        });

        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, error: err.message });
      }
    });

    // -----------------------------------------------------------------------
    // Proctoring: host grants or rejects re-entry
    // -----------------------------------------------------------------------
    socket.on("proctor:decision", (payload = {}, ack) => {
      try {
        const { participantId, granted } = payload;
        if (!participantId) return ack?.({ ok: false });

        const suspension = proctorSuspensions.get(participantId);
        if (!suspension) return ack?.({ ok: false, error: "No active suspension." });

        proctorSuspensions.delete(participantId);

        // Send decision directly to that participant's socket
        const targetSocket = io.sockets.sockets.get(suspension.socketId);
        if (targetSocket) {
          targetSocket.emit(granted ? "proctor:resumed" : "proctor:rejected", {
            granted,
            participantId,
          });
        }

        ack?.({ ok: true, granted });
      } catch (err) {
        ack?.({ ok: false, error: err.message });
      }
    });

    socket.on("disconnect", () => {
      const { sessionId, participantId, role } = socket.data;
      if (sessionId) {
        if (role === "participant" && participantId) {
          trackOnline(sessionId, participantId, false);
        }
        emitPresence(sessionId);
      }
    });
  });

  console.log("[realtime] Socket.IO gateway ready");
  return io;
}

function getIO() {
  if (!io) throw new Error("Realtime gateway has not been initialised.");
  return io;
}

async function buildSessionState(session) {
  const participants = await q(
    supabase.from("participants").select("id").eq("session_id", session.id),
    "count participants"
  );

  let currentActivity = null;
  let endsAt = null;

  if (session.current_activity_id) {
    const activity = await q(
      supabase.from("activities").select("*").eq("id", session.current_activity_id).maybeSingle(),
      "load current activity"
    );
    if (activity && !activity.closed_at) {
      currentActivity = publicActivity(activity);
      const startedAt = new Date(session.activity_started_at).getTime();
      endsAt = startedAt + activity.timer_seconds * 1000;
    }
  }

  return {
    session: {
      id: session.id,
      title: session.title,
      status: session.status,
      sessionCode: session.session_code,
      activeCategories: session.active_categories,
      pushMode: session.push_mode || "single",
    },
    currentActivity,
    startedAt: session.activity_started_at ? new Date(session.activity_started_at).getTime() : null,
    endsAt,
    participantCount: participants.length,
  };
}

async function emitPresence(sessionId) {
  try {
    const participants = await q(
      supabase
        .from("participants")
        .select("id, name, joined_at, total_score")
        .eq("session_id", sessionId)
        .order("joined_at", { ascending: true }),
      "load participants for presence"
    );

    const onlineSet = onlineParticipants.get(sessionId) || new Set();
    const connected = io.sockets.adapter.rooms.get(room(sessionId))?.size || 0;

    const participantList = participants.map((p) => ({
      id: p.id,
      name: p.name,
      joinedAt: p.joined_at,
      score: p.total_score,
      isOnline: onlineSet.has(p.id),
    }));

    getIO().to(room(sessionId)).emit("presence:update", {
      participantCount: participants.length,
      connected,
      participants: participantList,
    });
  } catch {
    /* presence is best-effort */
  }
}

/**
 * Push a question to every joined device at the same instant.
 * `startedAt` / `endsAt` are absolute server timestamps, so every client runs
 * the same countdown regardless of when its own render happens.
 */
function pushActivity({ sessionId, activity, startedAt }) {
  const endsAt = startedAt + activity.timer_seconds * 1000;
  const payload = {
    activity: publicActivity(activity),
    startedAt,
    endsAt,
    serverNow: Date.now(),
  };

  getIO().to(room(sessionId)).emit("activity:push", payload);
  // Hosts get the answer key so they can display it on the presenter screen.
  getIO().to(hostRoom(sessionId)).emit("activity:push:host", {
    ...payload,
    correctAnswer: activity.correct_answer,
  });

  scheduleAutoClose({ sessionId, activity, endsAt });
  return { startedAt, endsAt };
}

function scheduleAutoClose({ sessionId, activity, endsAt }) {
  clearAutoClose(activity.id);
  const delay = Math.max(0, endsAt - Date.now()) + 1500; // grace for in-flight answers
  const timer = setTimeout(async () => {
    closeTimers.delete(activity.id);
    try {
      const { closeActivityInternal } = require("../controllers/activity.controller");
      await closeActivityInternal({ sessionId, activityId: activity.id, reason: "timer" });
    } catch (err) {
      console.error("[realtime] auto-close failed:", err.message);
    }
  }, delay);
  closeTimers.set(activity.id, timer);
}

function clearAutoClose(activityId) {
  const existing = closeTimers.get(activityId);
  if (existing) {
    clearTimeout(existing);
    closeTimers.delete(activityId);
  }
}

function emitActivityClosed({ sessionId, activityId, tally, correctAnswer }) {
  clearAutoClose(activityId);
  getIO().to(room(sessionId)).emit("activity:close", { activityId, tally, correctAnswer });
}

/** Real-time broadcast when an activity (quiz or poll) ends */
function emitActivityEnded({ sessionId, activityId, activityType, tally, leaderboard, details }) {
  clearAutoClose(activityId);
  const payload = {
    type: "ACTIVITY_ENDED",
    activityType: activityType || "quiz",
    sessionId,
    activityId,
    tally,
    leaderboard,
    details,
  };
  getIO().to(room(sessionId)).emit("activity:ended", payload);
  getIO().to(room(sessionId)).emit("activity:close", {
    activityId,
    tally,
    correctAnswer: details?.correctAnswer || null,
  });
  if (leaderboard) {
    getIO().to(room(sessionId)).emit("leaderboard:update", { leaderboard });
  }
}

/** Emit the next auto-pushed activity in bulk mode. */
function emitAutoNext({ sessionId, activity, startedAt, endsAt, index, total }) {
  getIO().to(hostRoom(sessionId)).emit("activity:auto_next", {
    activityId: activity.id,
    index,
    total,
    startedAt,
    endsAt,
  });
}

/** Live vote distribution — drives the bar chart on host and participant screens. */
function emitTally({ sessionId, tally }) {
  getIO().to(room(sessionId)).emit("poll:update", tally);
}

/** How many of the joined participants have answered the open question. */
function emitAnswerStats({ sessionId, activityId, answered, participantCount }) {
  getIO().to(hostRoom(sessionId)).emit("stats:update", {
    activityId,
    answered,
    participantCount,
  });
}

function emitLeaderboard({ sessionId, leaderboard }) {
  getIO().to(room(sessionId)).emit("leaderboard:update", { leaderboard });
}

function emitScore({ sessionId, participantId, totalScore, lastResult }) {
  getIO().to(room(sessionId)).emit("score:update", { participantId, totalScore, lastResult });
}

function emitQaNew({ sessionId, item }) {
  getIO().to(room(sessionId)).emit("qa:new", { item });
}

function emitQaUpdate({ sessionId, item }) {
  getIO().to(room(sessionId)).emit("qa:update", { item });
}

function emitSessionStatus({ sessionId, status }) {
  getIO().to(room(sessionId)).emit("session:status", { status });
}

module.exports = {
  init,
  getIO,
  publicActivity,
  pushActivity,
  clearAutoClose,
  emitActivityClosed,
  emitActivityEnded,
  emitAutoNext,
  emitTally,
  emitAnswerStats,
  emitLeaderboard,
  emitScore,
  emitQaNew,
  emitQaUpdate,
  emitSessionStatus,
  emitPresence,
};
