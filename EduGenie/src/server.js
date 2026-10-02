require("dotenv").config();

const path = require("path");
const express = require("express");
const { GoogleGenAI } = require("@google/genai");

const app = express();
const PORT = process.env.PORT || 5000;
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const API_KEY = (process.env.GEMINI_API_KEY || "").trim();

const MAX_QUESTION_LENGTH = 2000;
const MAX_TOPIC_LENGTH = 200;

// Create the Gemini client only if a key exists (key stays on the server)
const ai = API_KEY ? new GoogleGenAI({ apiKey: API_KEY }) : null;

app.use(express.json({ limit: "50kb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

// ---------- Helpers ----------

const BASE_PROMPT =
  "You are EduGenie, a friendly AI learning assistant for college students. " +
  "Answer clearly and accurately in a student-friendly tone. " +
  "Use short paragraphs, bullet points and headings (markdown) where helpful. " +
  "Include a small example whenever it helps understanding. " +
  "If the question is not academic, still answer politely but briefly.";

const MODE_PROMPTS = {
  ask: BASE_PROMPT,
  simple:
    BASE_PROMPT +
    " The student wants a VERY SIMPLE explanation. Explain like they are a beginner, " +
    "use everyday analogies, avoid jargon, and keep it short.",
  example:
    BASE_PROMPT +
    " The student wants EXAMPLES. Give a brief definition, then 2-3 clear, practical examples " +
    "(include code snippets if the topic is programming).",
  study:
    BASE_PROMPT +
    " The student wants STUDY ASSISTANCE. Provide: Key Points, Important Terms, " +
    "a Quick Revision Summary, and 3 likely exam questions.",
};

function sendError(res, status, message) {
  return res.status(status).json({ success: false, error: message });
}

function mapGeminiError(err) {
  const status = err && (err.status || err.code);
  const msg = String((err && err.message) || "").toLowerCase();

  if (status === 400 && msg.includes("api key")) {
    return [401, "The Gemini API key is invalid. Please check your .env file."];
  }
  if (status === 401 || status === 403) {
    return [502, "Gemini rejected the request. Check that your API key is valid and has access."];
  }
  if (status === 404) {
    return [502, "The Gemini model was not found. Check GEMINI_MODEL in your .env file."];
  }
  if (status === 429) {
    return [429, "Gemini rate limit reached. Please wait a moment and try again."];
  }
  if (status === 503 || status === 500) {
    return [502, "Gemini is busy right now. Please try again in a few seconds."];
  }
  if (msg.includes("fetch failed") || msg.includes("enotfound") || msg.includes("econnreset") || msg.includes("etimedout")) {
    return [502, "Network error while contacting Gemini. Check your internet connection."];
  }
  return [500, "Something went wrong while talking to Gemini. Please try again."];
}

function requireKey(res) {
  if (!ai) {
    sendError(
      res,
      500,
      "Gemini API key is missing on the server. Add GEMINI_API_KEY to your .env file and restart."
    );
    return false;
  }
  return true;
}

// ---------- Routes ----------

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    status: "ok",
    geminiConfigured: Boolean(ai),
    model: MODEL,
  });
});

app.post("/api/ask", async (req, res) => {
  try {
    const question = typeof req.body.question === "string" ? req.body.question.trim() : "";
    const mode = MODE_PROMPTS[req.body.mode] ? req.body.mode : "ask";

    if (!question) return sendError(res, 400, "Please enter a question.");
    if (question.length > MAX_QUESTION_LENGTH) {
      return sendError(res, 400, `Question is too long (max ${MAX_QUESTION_LENGTH} characters).`);
    }
    if (!requireKey(res)) return;

    const response = await ai.models.generateContent({
      model: MODEL,
      contents: question,
      config: { systemInstruction: MODE_PROMPTS[mode], temperature: 0.6 },
    });

    const answer = response && response.text ? response.text.trim() : "";
    if (!answer) {
      return sendError(res, 502, "Gemini returned an empty response. Try rephrasing your question.");
    }

    res.json({ success: true, mode, answer });
  } catch (err) {
    console.error("[/api/ask] error:", err && err.message);
    const [status, message] = mapGeminiError(err);
    sendError(res, status, message);
  }
});

app.post("/api/quiz", async (req, res) => {
  try {
    const topic = typeof req.body.topic === "string" ? req.body.topic.trim() : "";

    if (!topic) return sendError(res, 400, "Please enter a topic for the quiz.");
    if (topic.length > MAX_TOPIC_LENGTH) {
      return sendError(res, 400, `Topic is too long (max ${MAX_TOPIC_LENGTH} characters).`);
    }
    if (!requireKey(res)) return;

    const prompt =
      `Create a quiz for college students on the topic: "${topic}".\n` +
      "Return EXACTLY 5 multiple-choice questions.\n" +
      "Each question must have exactly 4 options and one correct answer.\n" +
      "Respond ONLY with JSON in this exact shape:\n" +
      '{"topic": "string", "questions": [{"question": "string", "options": ["string","string","string","string"], "answerIndex": 0, "explanation": "string"}]}\n' +
      "answerIndex is the 0-based index of the correct option. Do not include option letters (A/B/C/D) inside the option text.";

    const response = await ai.models.generateContent({
      model: MODEL,
      contents: prompt,
      config: {
        systemInstruction: "You are EduGenie, an expert college quiz generator. Output valid JSON only.",
        responseMimeType: "application/json",
        temperature: 0.7,
      },
    });

    let raw = response && response.text ? response.text.trim() : "";
    raw = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/, "").trim();

    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return sendError(res, 502, "Gemini returned an invalid quiz format. Please try again.");
    }

    const questions = Array.isArray(data.questions) ? data.questions : [];
    const clean = questions
      .filter(
        (q) =>
          q &&
          typeof q.question === "string" &&
          Array.isArray(q.options) &&
          q.options.length === 4 &&
          Number.isInteger(q.answerIndex) &&
          q.answerIndex >= 0 &&
          q.answerIndex <= 3
      )
      .slice(0, 5)
      .map((q) => ({
        question: q.question,
        options: q.options.map(String),
        answerIndex: q.answerIndex,
        explanation: typeof q.explanation === "string" ? q.explanation : "",
      }));

    if (clean.length === 0) {
      return sendError(res, 502, "Gemini returned an invalid quiz. Please try again.");
    }

    res.json({ success: true, topic: data.topic || topic, questions: clean });
  } catch (err) {
    console.error("[/api/quiz] error:", err && err.message);
    const [status, message] = mapGeminiError(err);
    sendError(res, status, message);
  }
});

// Unknown API routes
app.use("/api", (req, res) => sendError(res, 404, "API route not found."));

// Invalid JSON and other server errors
app.use((err, req, res, next) => {
  if (err && err.type === "entity.parse.failed") {
    return sendError(res, 400, "Invalid request format.");
  }
  console.error("Server error:", err && err.message);
  sendError(res, 500, "Internal server error. Please try again later.");
});

app.listen(PORT, () => {
  console.log(`EduGenie running at http://localhost:${PORT}`);
  if (!ai) console.warn("WARNING: GEMINI_API_KEY is missing. Create a .env file (see .env.example).");
});
