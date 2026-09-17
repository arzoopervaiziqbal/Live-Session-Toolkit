const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api";
const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:5000";

// --------------------------------------------------------------------------
// Host auth storage
// --------------------------------------------------------------------------
export function getToken() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("lst_token_host");
}
export function setToken(token) {
  localStorage.setItem("lst_token_host", token);
}
export function clearToken() {
  localStorage.removeItem("lst_token_host");
}
export function getUser() {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem("lst_user_host");
  return raw ? JSON.parse(raw) : null;
}
export function setUser(user) {
  localStorage.setItem("lst_user_host", JSON.stringify(user));
}
export function clearUser() {
  localStorage.removeItem("lst_user_host");
}

export function tokenIsValid(token) {
  try {
    const payload = JSON.parse(
      atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))
    );
    if (payload.role !== "host") return false;
    if (payload.exp && payload.exp * 1000 < Date.now()) return false;
    return true;
  } catch {
    return false;
  }
}

// --------------------------------------------------------------------------
// Participant identity — a stable per-device id so a reload keeps the score
// --------------------------------------------------------------------------
export function getGuestId() {
  if (typeof window === "undefined") return null;
  let id = localStorage.getItem("lst_guest_id");
  if (!id) {
    id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `g_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem("lst_guest_id", id);
  }
  return id;
}

export function newClientToken() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `t_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

// --------------------------------------------------------------------------
// Request helper
// --------------------------------------------------------------------------
export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
    this.fieldErrors = body && body.errors ? body.errors : null;
    // Distinguishes "the server said no" from "the request never left the
    // device" — the offline queue only retries the latter.
    this.isNetworkError = status === 0;
  }
}

async function request(path, { method = "GET", body, auth = false, isForm = false, signal } = {}) {
  const headers = {};
  if (!isForm) headers["Content-Type"] = "application/json";
  if (auth) {
    const token = getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  let res;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      signal,
      body: isForm ? body : body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new ApiError("Can't reach the server. Check your connection.", 0, null);
  }

  const contentType = res.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await res.json() : await res.text();

  if (!res.ok) {
    const message = typeof data === "string" ? data : data.error || "Something went wrong.";
    throw new ApiError(message, res.status, typeof data === "object" ? data : null);
  }
  return data;
}

// --------------------------------------------------------------------------
// API surface
// --------------------------------------------------------------------------
export const api = {
  // auth
  register: (body) => request("/auth/host/register", { method: "POST", body }),
  login: (body) => request("/auth/host/login", { method: "POST", body }),
  me: () => request("/auth/host/me", { auth: true }),

  // sessions
  listSessions: () => request("/sessions", { auth: true }),
  createSession: (body) => request("/sessions", { method: "POST", body, auth: true }),
  getSession: (id) => request(`/sessions/${id}`, { auth: true }),
  updateSession: (id, body) => request(`/sessions/${id}`, { method: "PATCH", body, auth: true }),
  deleteSession: (id) => request(`/sessions/${id}`, { method: "DELETE", auth: true }),
  startSession: (id) => request(`/sessions/${id}/start`, { method: "POST", auth: true }),
  endSession: (id) => request(`/sessions/${id}/end`, { method: "POST", auth: true }),
  getLiveState: (id) => request(`/sessions/${id}/live`, { auth: true }),

  // material
  uploadNotesText: (id, notesText, append = false) =>
    request(`/sessions/${id}/notes`, { method: "POST", body: { notesText, append }, auth: true }),
  uploadNotesFile: (id, file, append = false) => {
    const form = new FormData();
    form.append("file", file);
    form.append("append", String(append));
    return request(`/sessions/${id}/notes`, { method: "POST", body: form, auth: true, isForm: true });
  },

  // activities
  listActivities: (sessionId, status) =>
    request(`/sessions/${sessionId}/activities${status ? `?status=${status}` : ""}`, { auth: true }),
  generateActivities: (sessionId, body) =>
    request(`/sessions/${sessionId}/activities/generate`, { method: "POST", body, auth: true }),
  createActivity: (sessionId, body) =>
    request(`/sessions/${sessionId}/activities`, { method: "POST", body, auth: true }),
  publishActivities: (sessionId, activityIds) =>
    request(`/sessions/${sessionId}/activities/publish`, {
      method: "POST",
      body: { activityIds },
      auth: true,
    }),
  updateActivity: (id, body) => request(`/activities/${id}`, { method: "PATCH", body, auth: true }),
  deleteActivity: (id) => request(`/activities/${id}`, { method: "DELETE", auth: true }),
  unpublishActivity: (id) => request(`/activities/${id}/unpublish`, { method: "POST", auth: true }),
  pushActivity: (id) => request(`/activities/${id}/push`, { method: "POST", auth: true }),
  closeActivity: (id) => request(`/activities/${id}/close`, { method: "POST", auth: true }),
  endActivity: (id) => request(`/activities/${id}/end`, { method: "POST", auth: true }),
  activityResults: (id) => request(`/activities/${id}/results`, { auth: true }),
  getSessionLeaderboard: (sessionId) => request(`/sessions/${sessionId}/leaderboard`, { auth: true }),

  // participant
  lookupSession: (code) => request(`/join/${encodeURIComponent(code)}`),
  joinSession: (body) => request("/join", { method: "POST", body }),
  participantState: (sessionId, participantId) =>
    request(`/join/${sessionId}/me?participantId=${encodeURIComponent(participantId)}`),
  submitResponse: (sessionId, body) =>
    request(`/join/${sessionId}/responses`, { method: "POST", body }),
  submitBatch: (sessionId, body) =>
    request(`/join/${sessionId}/responses/batch`, { method: "POST", body }),

  // Q&A
  listQuestions: (sessionId) => request(`/sessions/${sessionId}/qa`),
  postQuestion: (sessionId, body) => request(`/sessions/${sessionId}/qa`, { method: "POST", body }),
  updateQaItem: (id, body) => request(`/qa/${id}`, { method: "PATCH", body, auth: true }),
  deleteQaItem: (id) => request(`/qa/${id}`, { method: "DELETE", auth: true }),

  // reports
  getReport: (sessionId) => request(`/sessions/${sessionId}/report`, { auth: true }),
  reportExportUrl: (sessionId, format = "csv") =>
    `${API_URL}/sessions/${sessionId}/report/export?format=${format}`,
};

/**
 * The CSV export is a plain GET, but the route needs an Authorization header,
 * so it's fetched as a blob and handed to the browser as a download rather
 * than opened in a new tab.
 */
export async function downloadReport(sessionId, title = "session", format = "csv") {
  const res = await fetch(api.reportExportUrl(sessionId, format), {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new ApiError("Couldn't build the export.", res.status, null);

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-report.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function downloadExportBlob(sessionId, title, path, ext) {
  const url = `${API_URL}/sessions/${sessionId}/report/export/${path}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new ApiError("Couldn't build the export.", res.status, null);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-report.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

export const downloadPdf  = (id, title) => downloadExportBlob(id, title, "pdf",   "pdf");
export const downloadExcel = (id, title) => downloadExportBlob(id, title, "excel", "xlsx");
export const downloadWord  = (id, title) => downloadExportBlob(id, title, "word",  "docx");

export { API_URL, SOCKET_URL };
