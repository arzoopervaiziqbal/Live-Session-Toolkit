import { io } from "socket.io-client";
import { API_URL } from "./api";

let socketInstance = null;

// Determine socket server URL from API_URL (strip trailing /api)
function getSocketUrl() {
  if (typeof window !== "undefined") {
    // If API_URL is relative or absolute
    try {
      const u = new URL(API_URL, window.location.origin);
      return `${u.protocol}//${u.host}`;
    } catch {
      return "http://localhost:5000";
    }
  }
  return "http://localhost:5000";
}

export function getSocket() {
  if (!socketInstance) {
    const url = getSocketUrl();
    socketInstance = io(url, {
      transports: ["websocket", "polling"],
      autoConnect: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });
  }
  return socketInstance;
}

export const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun3.l.google.com:19302" },
    { urls: "stun:stun.services.mozilla.com" },
  ],
};
