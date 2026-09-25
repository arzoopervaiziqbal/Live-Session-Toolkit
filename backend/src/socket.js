const { Server } = require("socket.io");

let io = null;
// Map of linkId -> { hostSocketId: string, isScreenSharing: boolean }
const activeSessions = new Map();

function initSocket(server, clientUrl) {
  io = new Server(server, {
    cors: {
      origin: "*", // allow frontend connection from any local/remote host
      methods: ["GET", "POST", "PATCH", "DELETE"],
    },
    transports: ["websocket", "polling"],
  });

  io.on("connection", (socket) => {
    let currentLinkId = null;
    let userRole = "participant";

    socket.on("join-session", ({ linkId, role, participantId, displayName }) => {
      if (!linkId) return;
      currentLinkId = String(linkId).toLowerCase().trim();
      userRole = role || "participant";
      const room = `session-${currentLinkId}`;
      socket.join(room);

      if (!activeSessions.has(currentLinkId)) {
        activeSessions.set(currentLinkId, { hostSocketId: null, isScreenSharing: false, viewers: new Set() });
      }
      const sessionData = activeSessions.get(currentLinkId);

      if (userRole === "host") {
        sessionData.hostSocketId = socket.id;
        // Inform host of current viewers count
        socket.emit("viewer-count-update", { count: sessionData.viewers.size });
      } else {
        sessionData.viewers.add(socket.id);
        // If host is currently sharing screen, immediately notify this newly joined participant
        if (sessionData.isScreenSharing && sessionData.hostSocketId) {
          socket.emit("screen-share-started", { hostSocketId: sessionData.hostSocketId });
          if (sessionData.lastFrame) {
            socket.emit("screen-frame", { frame: sessionData.lastFrame });
          }
        }
        // Update host with viewer count
        if (sessionData.hostSocketId) {
          io.to(sessionData.hostSocketId).emit("viewer-count-update", { count: sessionData.viewers.size });
        }
      }
    });

    // Participant requests screen sync (e.g. on mount or reconnect)
    socket.on("request-screen-sync", ({ linkId }) => {
      const lid = String(linkId || currentLinkId).toLowerCase().trim();
      if (!lid) return;
      const sessionData = activeSessions.get(lid);
      if (sessionData && sessionData.isScreenSharing && sessionData.hostSocketId) {
        socket.emit("screen-share-started", { hostSocketId: sessionData.hostSocketId });
        if (sessionData.lastFrame) {
          socket.emit("screen-frame", { frame: sessionData.lastFrame });
        }
      }
    });

    // Host toggles Q&A
    socket.on("qa-toggle", ({ linkId, allowQa }) => {
      const lid = String(linkId || currentLinkId).toLowerCase().trim();
      if (!lid) return;
      io.to(`session-${lid}`).emit("qa-updated", { allowQa: Boolean(allowQa) });
    });

    // Participant asks question
    socket.on("qa-new-question", ({ linkId, item, qaFeed, activityId }) => {
      const targets = new Set([
        String(linkId || currentLinkId || "").toLowerCase().trim(),
        String(activityId || "").toLowerCase().trim(),
      ]);
      targets.forEach((lid) => {
        if (lid) io.to(`session-${lid}`).emit("qa-new-question", { item, qaFeed });
      });
    });

    // Host answers / updates Q&A
    socket.on("qa-answered", ({ linkId, qaFeed, answeredItem, questionId }) => {
      const lid = String(linkId || currentLinkId).toLowerCase().trim();
      if (!lid) return;
      io.to(`session-${lid}`).emit("qa-answered", { qaFeed, answeredItem, questionId });
    });

    // Screen Sharing: Host starts
    socket.on("screen-share-start", ({ linkId }) => {
      const lid = String(linkId || currentLinkId).toLowerCase().trim();
      if (!lid) return;
      const sessionData = activeSessions.get(lid) || { viewers: new Set() };
      sessionData.isScreenSharing = true;
      sessionData.hostSocketId = socket.id;
      activeSessions.set(lid, sessionData);

      // Broadcast to all participants in this session
      socket.to(`session-${lid}`).emit("screen-share-started", { hostSocketId: socket.id });
    });

    // Screen Sharing: Host stops
    socket.on("screen-share-stop", ({ linkId }) => {
      const lid = String(linkId || currentLinkId).toLowerCase().trim();
      if (!lid) return;
      const sessionData = activeSessions.get(lid);
      if (sessionData) {
        sessionData.isScreenSharing = false;
        sessionData.lastFrame = null;
      }
      socket.to(`session-${lid}`).emit("screen-share-stopped");
    });

    // WebRTC Signaling: Participant requests stream from host
    socket.on("screen-share-request", ({ hostSocketId, participantName }) => {
      if (hostSocketId) {
        io.to(hostSocketId).emit("screen-share-participant-ready", {
          participantSocketId: socket.id,
          participantName: participantName || "Student",
        });
      }
    });

    // WebRTC Signaling: Host sends Offer to a specific participant
    socket.on("screen-share-offer", ({ targetSocketId, offer }) => {
      if (targetSocketId && offer) {
        io.to(targetSocketId).emit("screen-share-offer", {
          hostSocketId: socket.id,
          offer,
        });
      }
    });

    // WebRTC Signaling: Participant sends Answer to Host
    socket.on("screen-share-answer", ({ hostSocketId, answer }) => {
      if (hostSocketId && answer) {
        io.to(hostSocketId).emit("screen-share-answer", {
          participantSocketId: socket.id,
          answer,
        });
      }
    });

    // WebRTC Signaling: ICE Candidate exchange
    socket.on("screen-share-ice", ({ targetSocketId, candidate }) => {
      if (targetSocketId && candidate) {
        io.to(targetSocketId).emit("screen-share-ice", {
          fromSocketId: socket.id,
          candidate,
        });
      }
    });

    // Frame streaming (compressed snapshot) broadcast & buffering
    socket.on("screen-frame", ({ linkId, frame }) => {
      const lid = String(linkId || currentLinkId).toLowerCase().trim();
      if (!lid || !frame) return;
      const sessionData = activeSessions.get(lid);
      if (sessionData) {
        sessionData.lastFrame = frame;
        sessionData.isScreenSharing = true;
      }
      socket.to(`session-${lid}`).emit("screen-frame", { frame });
    });

    // Disconnect cleanup
    socket.on("disconnect", () => {
      if (currentLinkId && activeSessions.has(currentLinkId)) {
        const sessionData = activeSessions.get(currentLinkId);
        if (sessionData.hostSocketId === socket.id) {
          sessionData.hostSocketId = null;
          sessionData.isScreenSharing = false;
          sessionData.lastFrame = null;
          io.to(`session-${currentLinkId}`).emit("screen-share-stopped");
        } else {
          sessionData.viewers.delete(socket.id);
          if (sessionData.hostSocketId) {
            io.to(sessionData.hostSocketId).emit("viewer-count-update", { count: sessionData.viewers.size });
          }
        }
      }
    });
  });

  return io;
}

function getIO() {
  return io;
}

function emitToSession(linkId, event, data) {
  if (!io || !linkId) return;
  const room = `session-${String(linkId).toLowerCase().trim()}`;
  io.to(room).emit(event, data);
}

module.exports = {
  initSocket,
  getIO,
  emitToSession,
};
