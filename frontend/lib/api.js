const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api";

export function getToken(role) {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(`sp_token_${role}`);
}

export function setToken(role, token) {
  localStorage.setItem(`sp_token_${role}`, token);
}

export function clearToken(role) {
  localStorage.removeItem(`sp_token_${role}`);
}

export function getUser(role) {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(`sp_user_${role}`);
  return raw ? JSON.parse(raw) : null;
}

export function tokenHasRole(token, role) {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.role === role;
  } catch {
    return false;
  }
}

export function setUser(role, user) {
  localStorage.setItem(`sp_user_${role}`, JSON.stringify(user));
}

export function clearUser(role) {
  localStorage.removeItem(`sp_user_${role}`);
}

// Generic JSON request helper. Pass role ("host" | "participant") to attach that token.
async function request(path, { method = "GET", body, role, isForm = false } = {}) {
  const headers = {};
  if (!isForm) headers["Content-Type"] = "application/json";
  if (role) {
    const token = getToken(role);
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });

  const contentType = res.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await res.json() : await res.text();

  if (!res.ok) {
    const err = new Error(typeof data === "string" ? data : data.error || "Request failed");
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

export const api = {
  hostRegister: (body) => request("/auth/host/register", { method: "POST", body }),
  hostLogin: (body) => request("/auth/host/login", { method: "POST", body }),
  participantRegister: (body) => request("/auth/participant/register", { method: "POST", body }),
  participantLogin: (body) => request("/auth/participant/login", { method: "POST", body }),

  listSessions: () => request("/sessions", { role: "host" }),
  createSession: (body) => request("/sessions", { method: "POST", body, role: "host" }),
  getSession: (id) => request(`/sessions/${id}`, { role: "host" }),
  updateSession: (id, body) => request(`/sessions/${id}`, { method: "PATCH", body, role: "host" }),
  deleteSession: (id) => request(`/sessions/${id}`, { method: "DELETE", role: "host" }),

  createActivity: (sessionId, body) =>
    request(`/sessions/${sessionId}/activities`, { method: "POST", body, role: "host" }),
  uploadNotesText: (activityId, notesText) =>
    request(`/activities/${activityId}/upload-notes`, { method: "POST", body: { notesText }, role: "host" }),
  uploadNotesFile: (activityId, file) => {
    const form = new FormData();
    form.append("file", file);
    return request(`/activities/${activityId}/upload-notes`, { method: "POST", body: form, role: "host", isForm: true });
  },
  updateActivity: (activityId, body) =>
    request(`/activities/${activityId}`, { method: "PATCH", body, role: "host" }),
  generateQuestions: (activityId, language, questionCount, append = false, notesText) =>
    request(`/activities/${activityId}/generate`, {
      method: "POST",
      body: { language, questionCount, append, notesText },
      role: "host",
    }),
  updateQuestion: (activityId, qId, patch) =>
    request(`/activities/${activityId}/questions/${qId}`, { method: "PATCH", body: patch, role: "host" }),
  addQuestion: (activityId, count = 1) =>
    request(`/activities/${activityId}/questions`, { method: "POST", body: { count }, role: "host" }),
  removeQuestion: (activityId, qId) =>
    request(`/activities/${activityId}/questions/${qId}`, { method: "DELETE", role: "host" }),
  publishActivity: (activityId) => request(`/activities/${activityId}/publish`, { method: "POST", role: "host" }),
  getResults: (activityId) => request(`/activities/${activityId}/results`, { role: "host" }),

  joinByCode: (linkId, guestId, name) =>
    request(`/join/${linkId}?guestId=${encodeURIComponent(guestId)}&name=${encodeURIComponent(name || "Guest")}`),
  submitAnswers: (linkId, guestId, answers) =>
    request(`/join/${linkId}/submit`, { method: "POST", body: { guestId, answers } }),
};

export { API_URL };
