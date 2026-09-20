const env = require("../config/env");

const CATEGORY_SHAPES = {
  quiz: (count) =>
    `Generate ${count} multiple choice quiz questions. Each item: {"questionText": string, "type": "mcq", "options": [4 strings], "correctAnswer": string (must exactly match one option)}.`,
  poll: (count) =>
    `Generate ${count} poll questions for audience opinion or comprehension checks. Each item: {"questionText": string, "type": "poll", "options": [3 to 4 strings]}.`,
  feedback: (count) => {
    const half = Math.max(1, Math.round(count / 2));
    return `Generate ${count} feedback questions: ${half} of type "rating" (1-5 scale, no options array needed) and ${count - half} of type "open_text". Each item: {"questionText": string, "type": "rating" | "open_text"}.`;
  },
  qa: (count) =>
    `Generate ${count} seed discussion questions to kick off a live Q&A session. Each item: {"questionText": string, "type": "open_text"}.`,
};

const MIN_QUESTIONS = 1;
const MAX_QUESTIONS = 20;
const DEFAULT_QUESTION_COUNT = 5;

function clampQuestionCount(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return DEFAULT_QUESTION_COUNT;
  return Math.min(MAX_QUESTIONS, Math.max(MIN_QUESTIONS, n));
}

const DIFFICULTY_HINTS = {
  easy: "Keep the questions simple, testing basic recall and definitions.",
  medium: "Use a moderate difficulty, testing understanding and application of concepts.",
  hard: "Make the questions challenging, testing analysis, edge cases, or connections between concepts.",
};

function buildPrompt({ category, difficulty, notesText, language = "English", questionCount }) {
  const shapeFn = CATEGORY_SHAPES[category];
  if (!shapeFn) throw new Error(`Unsupported category: ${category}`);

  const count = clampQuestionCount(questionCount);
  const difficultyLine =
    category === "quiz" ? DIFFICULTY_HINTS[difficulty] || DIFFICULTY_HINTS.medium : "";

  return `You are generating structured content for a live session activity based on lecture notes.
${shapeFn(count)}
${difficultyLine}
Write the questionText and options in ${language}.
Return ONLY a raw JSON array with exactly ${count} items, no markdown fences, no commentary, no trailing text.
Lecture notes:
"""
${notesText.slice(0, 8000)}
"""`;
}

function parseItems(rawText) {
  const cleaned = rawText.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    throw new Error("Could not parse AI-generated content as JSON.");
  }
}

function shapeItems(items, category) {
  return items.map((item, index) => ({
    questionId: `q${index + 1}_${Date.now().toString(36)}`,
    type: item.type || (category === "quiz" ? "mcq" : category === "poll" ? "poll" : "open_text"),
    questionText: item.questionText || "",
    options: item.options || [],
    correctAnswer: item.correctAnswer || null,
    orderIndex: index,
    aiGenerated: true,
  }));
}

// Groq's chat completions API is OpenAI-compatible and free to use with a
// no-cost API key from console.groq.com (no billing/credit card required).
async function callGroq(prompt) {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.groqApiKey}`,
    },
    body: JSON.stringify({
      model: env.groqModel,
      max_tokens: 4000,
      // gpt-oss models spend part of the token budget "thinking" before
      // writing the answer; keep reasoning light so more tokens go to
      // the actual JSON output instead of being used up on reasoning.
      reasoning_effort: "low",
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AI generation failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  const choice = data.choices?.[0];
  const content = choice?.message?.content;
  if (!content) {
    const reason = choice?.finish_reason ? ` (finish_reason: ${choice.finish_reason})` : "";
    throw new Error(`AI response did not contain any text${reason}. Try again, or use fewer questions.`);
  }
  return content;
}

async function callGemini(prompt) {
  const candidateModels = [
    env.geminiModel,
    "gemini-3.5-flash",
    "gemini-flash-latest",
    "gemini-3.7-flash",
  ].filter((m, i, arr) => m && arr.indexOf(m) === i);

  let lastError = null;

  const apiKey = process.env.GEMINI_API_KEY || env.geminiApiKey;

  for (const model of candidateModels) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.7,
          },
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        lastError = new Error(`Gemini AI generation failed (${response.status}) with model ${model}: ${text}`);
        console.warn(`[Gemini] Model ${model} returned ${response.status}, trying next fallback model...`);
        continue;
      }

      const data = await response.json();
      const candidate = data.candidates?.[0];
      const text = candidate?.content?.parts?.[0]?.text;
      if (!text) {
        lastError = new Error(`Gemini AI response with model ${model} did not contain text.`);
        continue;
      }
      return text;
    } catch (err) {
      lastError = err;
      console.warn(`[Gemini] Error with model ${model}:`, err.message);
    }
  }

  throw lastError || new Error("All Gemini model generation attempts failed.");
}

async function callAnthropic(prompt) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY || env.anthropicApiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: env.anthropicModel,
      max_tokens: 4000,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AI generation failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  const textBlock = (data.content || []).find((b) => b.type === "text");
  if (!textBlock) throw new Error("AI response did not contain any text.");
  return textBlock.text;
}

async function generateQuestions({ category, difficulty, notesText, language, questionCount }) {
  const geminiKey = process.env.GEMINI_API_KEY || env.geminiApiKey;
  const groqKey = process.env.GROQ_API_KEY || env.groqApiKey;
  const anthropicKey = process.env.ANTHROPIC_API_KEY || env.anthropicApiKey;

  if (!geminiKey && !groqKey && !anthropicKey) {
    throw new Error(
      "No AI provider is configured on the server. Set GEMINI_API_KEY in backend/.env."
    );
  }

  const prompt = buildPrompt({ category, difficulty, notesText, language, questionCount });

  let rawText;
  if (geminiKey) {
    rawText = await callGemini(prompt);
  } else if (groqKey) {
    rawText = await callGroq(prompt);
  } else {
    rawText = await callAnthropic(prompt);
  }

  const items = parseItems(rawText);

  return shapeItems(items, category);
}

module.exports = { generateQuestions, buildPrompt, clampQuestionCount, MIN_QUESTIONS, MAX_QUESTIONS, DEFAULT_QUESTION_COUNT };