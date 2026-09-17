"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { io } from "socket.io-client";
import { SOCKET_URL } from "./api";

/**
 * Live session socket.
 *
 * The important part is `offsetRef`: participant devices have wildly unreliable
 * clocks, so every countdown is derived from
 *     remaining = (serverEndsAt - (Date.now() + offset))
 * where `offset` comes from an NTP-style round trip. Two phones five minutes
 * apart on wall-clock time still show the same number of seconds left.
 */
export function useSessionSocket({ sessionId, role = "participant", participantId = null, handlers = {} }) {
  const [connected, setConnected] = useState(false);
  const [state, setState] = useState(null);
  const socketRef = useRef(null);
  const offsetRef = useRef(0);

  // Handlers are re-created on every render; keeping them in a ref means the
  // socket isn't torn down and rebuilt each time the parent re-renders.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const serverNow = useCallback(() => Date.now() + offsetRef.current, []);

  useEffect(() => {
    if (!sessionId) return;

    const socket = io(SOCKET_URL, {
      transports: ["websocket", "polling"],
      reconnectionDelay: 400,
      reconnectionDelayMax: 3000,
    });
    socketRef.current = socket;

    function syncClock() {
      const sentAt = Date.now();
      socket.emit("time:sync", sentAt, (reply) => {
        if (!reply) return;
        const roundTrip = Date.now() - sentAt;
        // Assume the trip is symmetric: the server's "now" corresponds to
        // sentAt + roundTrip/2 on this device.
        offsetRef.current = reply.serverNow - (sentAt + roundTrip / 2);
      });
    }

    socket.on("connect", () => {
      setConnected(true);
      syncClock();
      socket.emit("session:join", { sessionId, role, participantId }, (reply) => {
        if (reply?.ok) {
          setState(reply.state);
          handlersRef.current.onState?.(reply.state);
        }
      });
    });

    socket.on("disconnect", () => setConnected(false));

    // Re-sync periodically so long sessions don't accumulate drift.
    const clockTimer = setInterval(syncClock, 30000);

    const events = {
      "activity:push":      (p) => handlersRef.current.onActivityPush?.(p),
      "activity:push:host": (p) => handlersRef.current.onActivityPushHost?.(p),
      "activity:close":     (p) => handlersRef.current.onActivityClose?.(p),
      "activity:ended":     (p) => handlersRef.current.onActivityEnded?.(p),
      "activity:auto_next": (p) => handlersRef.current.onAutoNext?.(p),
      "poll:update":        (p) => handlersRef.current.onTally?.(p),
      "stats:update":       (p) => handlersRef.current.onStats?.(p),
      "leaderboard:update": (p) => handlersRef.current.onLeaderboard?.(p),
      "score:update":       (p) => handlersRef.current.onScore?.(p),
      "qa:new":             (p) => handlersRef.current.onQaNew?.(p),
      "qa:update":          (p) => handlersRef.current.onQaUpdate?.(p),
      "presence:update":    (p) => handlersRef.current.onPresence?.(p),
      "session:status":     (p) => handlersRef.current.onSessionStatus?.(p),
      // Proctoring events
      "proctor:suspended":  (p) => handlersRef.current.onProctorSuspended?.(p),
      "proctor:resumed":    (p) => handlersRef.current.onProctorResumed?.(p),
      "proctor:rejected":   (p) => handlersRef.current.onProctorRejected?.(p),
      "proctor:request":    (p) => handlersRef.current.onProctorRequest?.(p),
    };

    for (const [event, fn] of Object.entries(events)) socket.on(event, fn);

    return () => {
      clearInterval(clockTimer);
      for (const event of Object.keys(events)) socket.off(event);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [sessionId, role, participantId]);

  return { connected, state, serverNow, socket: socketRef };
}

/**
 * Countdown driven by an absolute server timestamp rather than a decrementing
 * local counter, so a backgrounded tab catches up correctly on resume instead
 * of drifting behind by however long it was asleep.
 */
export function useCountdown(endsAt, serverNow) {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (!endsAt) {
      setRemaining(0);
      return;
    }
    const tick = () => {
      const ms = Math.max(0, endsAt - serverNow());
      setRemaining(ms);
      return ms;
    };
    tick();
    const timer = setInterval(() => {
      if (tick() <= 0) clearInterval(timer);
    }, 200);
    return () => clearInterval(timer);
  }, [endsAt, serverNow]);

  return {
    ms: remaining,
    seconds: Math.ceil(remaining / 1000),
    expired: endsAt ? remaining <= 0 : false,
  };
}

/**
 * Proctoring hook: detects tab switches and window blur, emits violations
 * to the server after a configurable grace period.
 *
 * Returns { suspended, rejectedByHost } state so the UI can show overlays.
 */
export function useProctor({ sessionId, participantId, socket, enabled = true, gracePeriodMs = 2000 }) {
  const [suspended, setSuspended] = useState(false);
  const [rejectedByHost, setRejectedByHost] = useState(false);
  const blurTimerRef = useRef(null);
  const suspendedRef = useRef(false);

  // Listen for host decisions coming via the parent socket handlers.
  // These are wired in the parent's handlers object, not here directly,
  // because the socket ref is managed in useSessionSocket.
  // We expose setters so the parent can call them.
  const handleResumed = useCallback(() => {
    setSuspended(false);
    setRejectedByHost(false);
    suspendedRef.current = false;
  }, []);

  const handleRejected = useCallback(() => {
    setSuspended(true);
    setRejectedByHost(true);
    suspendedRef.current = true;
  }, []);

  useEffect(() => {
    if (!enabled || !sessionId || !participantId || !socket?.current) return;

    function reportViolation(reason) {
      if (suspendedRef.current) return; // already suspended
      suspendedRef.current = true;
      setSuspended(true);
      socket.current.emit("proctor:violation", { participantId, sessionId, reason });
    }

    function onVisibilityChange() {
      if (document.visibilityState === "hidden") {
        // Start grace period timer
        blurTimerRef.current = setTimeout(() => {
          reportViolation("tab_hidden");
        }, gracePeriodMs);
      } else {
        // Came back before grace period — cancel
        if (blurTimerRef.current) {
          clearTimeout(blurTimerRef.current);
          blurTimerRef.current = null;
        }
      }
    }

    function onBlur() {
      if (!blurTimerRef.current) {
        blurTimerRef.current = setTimeout(() => {
          reportViolation("window_blur");
        }, gracePeriodMs);
      }
    }

    function onFocus() {
      if (blurTimerRef.current) {
        clearTimeout(blurTimerRef.current);
        blurTimerRef.current = null;
      }
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    };
  }, [enabled, sessionId, participantId, socket, gracePeriodMs]);

  return { suspended, rejectedByHost, handleResumed, handleRejected };
}
