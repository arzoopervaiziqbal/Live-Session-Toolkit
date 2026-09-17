"use client";
import { api, ApiError } from "./api";

/**
 * Local-first answer queue (PRD 9.3 / 10.1).
 *
 * Every answer is written to IndexedDB *before* the network call is attempted.
 * If the request fails for a connectivity reason the record stays queued and is
 * retried when the device comes back online. Each record carries a clientToken
 * that the server treats as an idempotency key, so retrying is always safe —
 * a replay can never double-score.
 *
 * IndexedDB rather than localStorage because it survives quota pressure better
 * and doesn't block the main thread while a question is being answered.
 */

const DB_NAME = "lst_offline";
const DB_VERSION = 1;
const STORE = "pending_responses";

let dbPromise = null;

function openDb() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "clientToken" });
        store.createIndex("sessionId", "sessionId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    // If IndexedDB is unavailable (private mode, old browser) we fall back to
    // localStorage rather than losing the answer entirely.
    req.onerror = () => resolve(null);
  });

  return dbPromise;
}

// ---- localStorage fallback ------------------------------------------------
const LS_KEY = "lst_pending_responses";

function lsRead() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "[]");
  } catch {
    return [];
  }
}
function lsWrite(items) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(items));
  } catch {
    /* quota exhausted — nothing further we can do client-side */
  }
}

// ---- storage API ----------------------------------------------------------
async function put(record) {
  const db = await openDb();
  if (!db) {
    const items = lsRead().filter((i) => i.clientToken !== record.clientToken);
    items.push(record);
    lsWrite(items);
    return;
  }
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(record);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function remove(clientToken) {
  const db = await openDb();
  if (!db) {
    lsWrite(lsRead().filter((i) => i.clientToken !== clientToken));
    return;
  }
  await new Promise((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(clientToken);
    tx.oncomplete = resolve;
    tx.onerror = resolve;
  });
}

export async function listPending(sessionId = null) {
  const db = await openDb();
  if (!db) {
    const items = lsRead();
    return sessionId ? items.filter((i) => i.sessionId === sessionId) : items;
  }
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => {
      const items = req.result || [];
      resolve(sessionId ? items.filter((i) => i.sessionId === sessionId) : items);
    };
    req.onerror = () => resolve([]);
  });
}

// ---------------------------------------------------------------------------
// Submission
// ---------------------------------------------------------------------------

/**
 * Queue-then-send. Returns { status, result }.
 *   status "sent"   — the server graded it, `result` holds the outcome
 *   status "queued" — saved locally, will retry automatically
 */
export async function submitAnswer({ sessionId, participantId, activityId, answer, clientToken, responseTimeMs }) {
  const record = {
    clientToken,
    sessionId,
    participantId,
    activityId,
    answer,
    responseTimeMs,
    queuedAt: Date.now(),
    attempts: 0,
  };

  // Durable first. If the tab is closed the instant after this line, the answer
  // is still on disk and goes out on the next visit.
  await put(record);

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { status: "queued", result: null };
  }

  try {
    const data = await api.submitResponse(sessionId, {
      participantId,
      activityId,
      answer,
      clientToken,
      responseTimeMs,
    });
    await remove(clientToken);
    return { status: "sent", result: data.result, duplicate: Boolean(data.duplicate) };
  } catch (err) {
    // A 4xx means the server understood and rejected it — retrying won't help,
    // so drop it rather than looping forever.
    if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
      await remove(clientToken);
      throw err;
    }
    return { status: "queued", result: null };
  }
}

/**
 * Flush everything queued for a session in one batch request.
 * Returns { accepted, failed, remaining, totalScore }.
 */
export async function flushQueue(sessionId, participantId) {
  const pending = (await listPending(sessionId)).filter((r) => r.participantId === participantId);
  if (!pending.length) return { accepted: 0, failed: 0, remaining: 0, totalScore: null };

  try {
    const data = await api.submitBatch(sessionId, {
      participantId,
      responses: pending.map((r) => ({
        activityId: r.activityId,
        answer: r.answer,
        clientToken: r.clientToken,
        responseTimeMs: r.responseTimeMs,
      })),
    });

    for (const result of data.results || []) {
      // Clear anything the server accepted, plus anything it permanently
      // rejected — a 4xx will never succeed on a retry.
      const permanentlyRejected = !result.ok && result.status >= 400 && result.status < 500;
      if (result.ok || permanentlyRejected) await remove(result.clientToken);
    }

    const remaining = (await listPending(sessionId)).filter((r) => r.participantId === participantId).length;
    return { accepted: data.accepted, failed: data.failed, remaining, totalScore: data.totalScore };
  } catch {
    // Still offline. Leave the queue intact for the next attempt.
    return { accepted: 0, failed: 0, remaining: pending.length, totalScore: null };
  }
}

/**
 * Wires up automatic retry: on the `online` event, on tab refocus, and on a
 * slow poll as a backstop for networks that come back without firing `online`.
 * Returns an unsubscribe function.
 */
export function startAutoSync({ sessionId, participantId, onSync, intervalMs = 15000 }) {
  if (typeof window === "undefined") return () => {};

  let stopped = false;
  let running = false;

  async function attempt() {
    if (stopped || running) return;
    if (navigator.onLine === false) return;
    running = true;
    try {
      const result = await flushQueue(sessionId, participantId);
      if (!stopped && (result.accepted || result.remaining)) onSync?.(result);
    } finally {
      running = false;
    }
  }

  const onOnline = () => attempt();
  const onVisible = () => {
    if (document.visibilityState === "visible") attempt();
  };

  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisible);
  const timer = setInterval(attempt, intervalMs);

  attempt();

  return () => {
    stopped = true;
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisible);
    clearInterval(timer);
  };
}

/** Live online/offline flag for the connection banner. */
export function useOnlineStatus(React) {
  const { useState, useEffect } = React;
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  return online;
}
