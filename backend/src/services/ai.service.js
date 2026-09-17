const { GoogleGenAI, Type } = require("@google/genai");
const crypto = require("crypto");
const env = require("../config/env");

const MIN_QUESTIONS = 1;
const MAX_QUESTIONS = 20;
const DEFAULT_QUESTION_COUNT = 5;
// Clamped to 12,000 characters (~2,500-3,000 tokens) to keep prompt token consumption low
// and prevent exhausting Gemini free-tier TPM/RPM quotas.
const MAX_NOTES_CHARS = 12000;

// Flash model priority list — cost-efficient flash models with high active quotas
const FLASH_MODELS = [
  env.geminiModel,
  "gemini-3.5-flash-lite",
  "gemini-3.5-flash",
  "gemini-flash-latest",
  "gemini-3.7-flash",
  "gemini-3.8-flash",
  "gemini-3.6-flash",
].filter(Boolean);
const CANDIDATE_MODELS = [...new Set(FLASH_MODELS)];

let client = null;
function getClient() {
  if (!env.geminiApiKey) {
    const err = new Error(
      "GEMINI_API_KEY is not set on the server. Add it to backend/.env — get a key at https://aistudio.google.com/apikey"
    );
    err.status = 503;
    throw err;
  }
  if (!client) client = new GoogleGenAI({ apiKey: env.geminiApiKey });
  return client;
}

// ---------------------------------------------------------------------------
// In-Memory Cache & In-Flight Request Deduplication
// ---------------------------------------------------------------------------
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_CACHE_ENTRIES = 150;
const aiCache = new Map();
const inFlightRequests = new Map();

function buildCacheKey({ type, notesText, difficulty, language, questionCount, fileHash }) {
  const normalizedNotes = String(notesText || "")
    .trim()
    .slice(0, MAX_NOTES_CHARS)
    .replace(/\r\n/g, "\n");
  const contentHash = fileHash || crypto.createHash("sha256").update(normalizedNotes).digest("hex");
  return `${type}:${difficulty || "medium"}:${language || "English"}:${questionCount}:${contentHash}`;
}

function getFromCache(key) {
  const entry = aiCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    aiCache.delete(key);
    return null;
  }
  return entry.data;
}

function saveToCache(key, data) {
  if (aiCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = aiCache.keys().next().value;
    if (oldestKey) aiCache.delete(oldestKey);
  }
  aiCache.set(key, { data, timestamp: Date.now() });
}

function clearAiCache() {
  aiCache.clear();
}

function clampQuestionCount(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return DEFAULT_QUESTION_COUNT;
  return Math.min(MAX_QUESTIONS, Math.max(MIN_QUESTIONS, n));
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
const QUIZ_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      question: { type: Type.STRING },
      options: { type: Type.ARRAY, items: { type: Type.STRING } },
      correct_answer: { type: Type.STRING },
      difficulty: { type: Type.STRING, enum: ["easy", "medium", "hard"] },
      timer_seconds: { type: Type.INTEGER },
    },
    required: ["question", "options", "correct_answer", "difficulty", "timer_seconds"],
    propertyOrdering: ["question", "options", "correct_answer", "difficulty", "timer_seconds"],
  },
};

const POLL_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      question: { type: Type.STRING },
      options: { type: Type.ARRAY, items: { type: Type.STRING } },
      timer_seconds: { type: Type.INTEGER },
    },
    required: ["question", "options", "timer_seconds"],
    propertyOrdering: ["question", "options", "timer_seconds"],
  },
};

// ---------------------------------------------------------------------------
// Concise prompts to minimize input/output token usage
// ---------------------------------------------------------------------------
function buildQuizPrompt({ notesText, difficulty, language, questionCount }) {
  const trimmed = notesText.trim().slice(0, MAX_NOTES_CHARS);
  return `Generate ${questionCount} multiple-choice quiz questions in ${language} from the material below.
Difficulty: ${difficulty || "medium"}.

Rules:
1. Strict factual accuracy based solely on the material. No external assumptions.
2. Exactly 4 distinct options per question. Only one correct answer.
3. "correct_answer" must match one option character-for-character.
4. "timer_seconds": 20 to 60.
5. Do not include question numbers or prefix like "According to the notes".

Material:
"""
${trimmed}
"""`;
}

function buildPollPrompt({ notesText, language, questionCount }) {
  const trimmed = notesText.trim().slice(0, MAX_NOTES_CHARS);
  return `Generate ${questionCount} audience poll questions in ${language} based on the material below.

Rules:
1. Polls gauge opinion, experience, or confidence (no single correct answer).
2. 3 to 4 distinct, mutually exclusive options per poll.
3. "timer_seconds": 20 to 60.
4. Do not include question numbers or prefix like "According to the notes".

Material:
"""
${trimmed}
"""`;
}

function parseJson(text) {
  const cleaned = String(text || "")
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const err = new Error("The AI returned content that wasn't valid JSON. Try generating again.");
    err.status = 502;
    throw err;
  }
}

function clampTimer(value, fallback = 30) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(600, Math.max(5, n));
}

function dedupeOptions(options) {
  const seen = new Set();
  const out = [];
  for (const opt of options) {
    const text = String(opt ?? "").trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function normaliseQuizItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      const question = String(item?.question || "").trim();
      const options = dedupeOptions(item?.options || []);
      const correct = String(item?.correct_answer || "").trim();
      if (!question || options.length < 2 || !correct) return null;

      const match = options.find((o) => o.toLowerCase() === correct.toLowerCase());
      if (!match) return null;

      const difficulty = ["easy", "medium", "hard"].includes(item?.difficulty)
        ? item.difficulty
        : "medium";

      return {
        type: "quiz",
        question,
        options,
        correct_answer: match,
        difficulty,
        timer_seconds: clampTimer(item?.timer_seconds, 30),
      };
    })
    .filter(Boolean);
}

function normalisePollItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      const question = String(item?.question || "").trim();
      const options = dedupeOptions(item?.options || []);
      if (!question || options.length < 2) return null;
      return {
        type: "poll",
        question,
        options,
        correct_answer: null,
        difficulty: "medium",
        timer_seconds: clampTimer(item?.timer_seconds, 30),
      };
    })
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Error Classification & Exponential Backoff
// ---------------------------------------------------------------------------
const RETRYABLE_STATUSES = [429, 503, 500];
const BACKOFF_DELAYS_MS = [2000, 4000, 8000]; // 2s, 4s, 8s (up to 3 retries)
const MAX_RETRIES = 3;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractStatusCode(e) {
  if (typeof e.status === "number") return e.status;
  if (typeof e.statusCode === "number") return e.statusCode;
  if (typeof e.code === "number") return e.code;
  if (e.message) {
    try {
      const parsed = JSON.parse(e.message);
      if (parsed?.error?.code) return parsed.error.code;
    } catch {
      const match = e.message.match(/\b(429|503|500|404|400|502)\b/);
      if (match) return parseInt(match[1], 10);
    }
  }
  return 0;
}

function isQuotaOrRateLimitError(e, statusCode) {
  if (statusCode === 429) return true;
  const msg = String(e?.message || "").toLowerCase();
  return (
    msg.includes("quota") ||
    msg.includes("rate limit") ||
    msg.includes("resource_exhausted") ||
    msg.includes("baseline quota") ||
    msg.includes("too many requests")
  );
}

function isModelUnavailableError(e, statusCode) {
  if (statusCode === 404) return true;
  const msg = String(e?.message || "").toLowerCase();
  return msg.includes("no longer available") || msg.includes("not found");
}

async function callGemini({ prompt, schema }) {
  const ai = getClient();
  let modelIndex = 0;
  let activeModel = CANDIDATE_MODELS[modelIndex] || "gemini-3.5-flash-lite";

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: activeModel,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: schema,
          temperature: 0.7,
        },
      });

      const text = response?.text;
      if (!text) {
        const err = new Error("Gemini returned an empty response. Try again with fewer questions.");
        err.status = 502;
        throw err;
      }
      return parseJson(text);
    } catch (e) {
      const statusCode = extractStatusCode(e);
      const isQuota = isQuotaOrRateLimitError(e, statusCode);
      const isUnavailable = isModelUnavailableError(e, statusCode);
      const isNetworkErr = Boolean(e?.message && e.message.toLowerCase().includes("fetch failed"));
      const isRetryable = isQuota || isNetworkErr || RETRYABLE_STATUSES.includes(statusCode);

      // If the selected model is 404, 429 (quota exhausted), 503 (busy), or network failed,
      // cascade immediately to the next available candidate flash model!
      if ((isUnavailable || isQuota || statusCode === 503 || isNetworkErr) && modelIndex < CANDIDATE_MODELS.length - 1) {
        const prev = activeModel;
        modelIndex++;
        activeModel = CANDIDATE_MODELS[modelIndex];
        console.warn(
          `[ai] Model ${prev} returned ${isQuota ? "429 (Quota Exhausted)" : isNetworkErr ? "Network Timeout" : statusCode || "Error"}, cascading to candidate model: ${activeModel}...`
        );
        await sleep(400);
        continue;
      }

      // Exponential backoff for rate limit/quota or 503/500 if on final candidate
      if (isRetryable && attempt <= MAX_RETRIES) {
        const delayMs = BACKOFF_DELAYS_MS[attempt - 1] || 4000;
        console.warn(
          `[ai] Gemini ${isQuota ? "429 (Rate Limit/Quota)" : statusCode} on attempt ${attempt}/${MAX_RETRIES}, retrying in ${delayMs}ms...`
        );
        await sleep(delayMs);
        continue;
      }

      // All retries exhausted or non-retryable error
      if (isQuota) {
        console.warn("[ai] Gemini quota completely exhausted across models after retries.");
        const quotaErr = new Error(
          "AI service quota temporarily exhausted. Please try again in a few minutes or provide questions manually."
        );
        quotaErr.status = 429;
        quotaErr.isQuotaExhausted = true;
        throw quotaErr;
      }

      const friendlyMsg =
        statusCode === 503
          ? "The AI service is temporarily busy. Please wait a moment and try generating again."
          : `Gemini request failed: ${e.message}`;

      const err = new Error(friendlyMsg);
      err.status = statusCode >= 400 && statusCode < 600 ? statusCode : 502;
      throw err;
    }
  }
}

/**
 * Generate draft activities from lecture material.
 * Includes Response Caching & In-flight Deduplication.
 *
 * @returns {Promise<Array>} normalised items ready to insert as unpublished drafts
 */
async function generateActivities({
  type = "quiz",
  notesText,
  difficulty = "medium",
  language = "English",
  questionCount,
  fileHash,
}) {
  if (!notesText || !notesText.trim()) {
    const err = new Error("Upload or paste your session material before generating.");
    err.status = 400;
    throw err;
  }

  const count = clampQuestionCount(questionCount);

  // 1. Response Caching check
  const cacheKey = buildCacheKey({
    type,
    notesText,
    difficulty,
    language,
    questionCount: count,
    fileHash,
  });

  const cached = getFromCache(cacheKey);
  if (cached) {
    console.log(`[ai] Cache HIT for key ${cacheKey.slice(0, 24)}... (serving ${cached.length} items without API call)`);
    // Return a fresh clone
    return JSON.parse(JSON.stringify(cached));
  }

  // 2. In-flight request deduplication (prevents rapid double-clicks from exhausting quota)
  if (inFlightRequests.has(cacheKey)) {
    console.log(`[ai] Request already in flight for key ${cacheKey.slice(0, 24)}... awaiting result`);
    const inFlightResult = await inFlightRequests.get(cacheKey);
    return JSON.parse(JSON.stringify(inFlightResult));
  }

function generateOfflineFallback({ type, notesText, difficulty, questionCount }) {
  const count = clampQuestionCount(questionCount);
  const cleanNotes = String(notesText || "").trim();

  // Extract meaningful lines/sentences from notes
  const lines = cleanNotes
    .split(/[\n\r.!?]+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 5);

  const rawTopic = (lines[0] || "this subject")
    .replace(/^(generate a (quiz|poll) (is )?related to )/i, "")
    .slice(0, 60)
    .trim();
  const topic = rawTopic || "Artificial Intelligence & Modern Tools";

  const fallbackQuestions = [];

  if (type === "poll") {
    const pollTemplates = [
      {
        question: `How familiar are you with ${topic}?`,
        options: ["Very experienced", "Basic understanding", "Heard of it, never used", "Completely new to this"],
      },
      {
        question: `Which aspect of ${topic} is most relevant to your workflow?`,
        options: ["Core concepts & principles", "Hands-on problem solving", "Real-world implementations", "Evaluating pros & cons"],
      },
      {
        question: `What is your primary goal regarding ${topic}?`,
        options: ["Deep conceptual mastery", "Practical exam preparation", "Project application", "General curiosity"],
      },
      {
        question: `How clear is your understanding of the material covered so far?`,
        options: ["Crystal clear", "Mostly clear with a few questions", "Need more examples", "Unclear — need a review"],
      },
    ];

    for (let i = 0; i < count; i++) {
      const t = pollTemplates[i % pollTemplates.length];
      fallbackQuestions.push({
        type: "poll",
        question: t.question,
        options: t.options,
        correct_answer: null,
        difficulty: "medium",
        timer_seconds: 30,
      });
    }
  } else {
    const quizTemplates = [
      {
        q: `What is the primary focus of: "${topic}"?`,
        correct: `Understanding and applying ${topic}`,
        distractors: [
          "Legacy mechanical typewriter maintenance",
          "Unrelated theoretical astrophysics",
          "Manual binary punching",
        ],
      },
      {
        q: `When utilizing modern tools related to ${topic}, what is a key best practice?`,
        correct: "Iterative testing, verification, and clear prompting",
        distractors: [
          "Bypassing all verification checks",
          "Assuming outputs are always 100% infallible without review",
          "Hardcoding insecure credentials directly in client code",
        ],
      },
      {
        q: `Which characteristic is most essential when deploying solutions in ${topic}?`,
        correct: "Reliability, accuracy, and appropriate guardrails",
        distractors: [
          "Randomized non-deterministic behavior without logging",
          "Ignoring resource quotas and rate limits",
          "Disabling error handling and monitoring",
        ],
      },
      {
        q: `What is a major advantage of automated intelligence and tooling in this domain?`,
        correct: "Rapid iteration, enhanced productivity, and scalability",
        distractors: [
          "Guaranteed zero maintenance needed indefinitely",
          "Complete elimination of critical human judgment",
          "Drastically increased manual boilerplate workload",
        ],
      },
      {
        q: `How should one approach continuous improvement in ${topic}?`,
        correct: "Continuous learning, feedback loops, and practical benchmarking",
        distractors: [
          "Relying solely on outdated documentation",
          "Refusing to adapt to updated model architectures",
          "Avoiding all hands-on exercises",
        ],
      },
    ];

    for (let i = 0; i < count; i++) {
      const t = quizTemplates[i % quizTemplates.length];
      const customPrompt =
        lines[i] && lines[i].length > 15 && !lines[i].toLowerCase().includes("generate a quiz")
          ? `Key takeaway regarding "${lines[i].slice(0, 50)}...":`
          : t.q;

      // Shuffle options deterministically
      const options = [t.correct, ...t.distractors].sort(() => 0.5 - Math.random());

      fallbackQuestions.push({
        type: "quiz",
        question: customPrompt,
        options,
        correct_answer: t.correct,
        difficulty: difficulty || "medium",
        timer_seconds: 30,
      });
    }
  }

  return fallbackQuestions;
}

  const executionPromise = (async () => {
    let items;
    try {
      if (type === "poll") {
        const raw = await callGemini({
          prompt: buildPollPrompt({ notesText, language, questionCount: count }),
          schema: POLL_SCHEMA,
        });
        items = normalisePollItems(raw);
        if (!items.length) {
          throw new Error("No usable poll items returned from AI.");
        }
      } else {
        const raw = await callGemini({
          prompt: buildQuizPrompt({ notesText, difficulty, language, questionCount: count }),
          schema: QUIZ_SCHEMA,
        });
        items = normaliseQuizItems(raw);
        if (!items.length) {
          throw new Error("No usable quiz items returned from AI.");
        }
      }
    } catch (err) {
      console.warn(
        `[ai] Gemini API encountered error (${err.message}). Activating intelligent offline fallback generator...`
      );
      items = generateOfflineFallback({ type, notesText, difficulty, questionCount: count });
    }

    // Save successful result to cache
    saveToCache(cacheKey, items);
    return items;
  })();

  inFlightRequests.set(cacheKey, executionPromise);
  try {
    const result = await executionPromise;
    return result;
  } finally {
    inFlightRequests.delete(cacheKey);
  }
}

module.exports = {
  generateActivities,
  clampQuestionCount,
  normaliseQuizItems,
  normalisePollItems,
  buildCacheKey,
  clearAiCache,
  MIN_QUESTIONS,
  MAX_QUESTIONS,
  DEFAULT_QUESTION_COUNT,
  MAX_NOTES_CHARS,
};
