// EduGenie frontend. It only talks to our own backend (never to Gemini directly).

const $ = (id) => document.getElementById(id);

const questionEl = $("question");
const askBtn = $("askBtn");
const clearBtn = $("clearBtn");
const askError = $("askError");
const askLoader = $("askLoader");
const responseBox = $("responseBox");
const responseBody = $("responseBody");
const charCount = $("charCount");
const copyBtn = $("copyBtn");

const topicEl = $("topic");
const quizBtn = $("quizBtn");
const quizClearBtn = $("quizClearBtn");
const quizError = $("quizError");
const quizLoader = $("quizLoader");
const quizBox = $("quizBox");
const quizTitle = $("quizTitle");
const quizQuestions = $("quizQuestions");
const checkBtn = $("checkBtn");
const keyBtn = $("keyBtn");
const scoreEl = $("score");
const answerKeyEl = $("answerKey");

let currentMode = "ask";
let currentQuiz = [];
let lastAnswerText = "";

const PLACEHOLDERS = {
  ask: "e.g. Explain DBMS in simple terms",
  simple: "Enter a topic to get a very simple explanation, e.g. Recursion",
  example: "Enter a topic to get examples, e.g. Binary search",
  study: "Enter a topic for study notes, e.g. Normalization",
};

// ---------- Helpers ----------

function showError(el, message) {
  el.textContent = message;
  el.hidden = false;
}
function hideError(el) {
  el.hidden = true;
  el.textContent = "";
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Small, safe markdown renderer (escapes HTML first)
function renderMarkdown(text) {
  const codeBlocks = [];
  let src = escapeHtml(text).replace(/```[a-zA-Z0-9]*\n?([\s\S]*?)```/g, (_, code) => {
    codeBlocks.push(code);
    return `@@CODE${codeBlocks.length - 1}@@`;
  });

  const inline = (s) =>
    s
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");

  const lines = src.split("\n");
  let html = "";
  let list = null; // "ul" | "ol"
  let para = [];

  const flushPara = () => {
    if (para.length) {
      html += `<p>${inline(para.join("<br>"))}</p>`;
      para = [];
    }
  };
  const closeList = () => {
    if (list) {
      html += `</${list}>`;
      list = null;
    }
  };

  for (const line of lines) {
    let m;
    if (/^@@CODE\d+@@$/.test(line.trim())) {
      flushPara(); closeList();
      html += line.trim();
    } else if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      flushPara(); closeList();
      const level = Math.min(m[1].length + 1, 4);
      html += `<h${level}>${inline(m[2])}</h${level}>`;
    } else if ((m = line.match(/^\s*[-*+]\s+(.*)$/))) {
      flushPara();
      if (list !== "ul") { closeList(); html += "<ul>"; list = "ul"; }
      html += `<li>${inline(m[1])}</li>`;
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      flushPara();
      if (list !== "ol") { closeList(); html += "<ol>"; list = "ol"; }
      html += `<li>${inline(m[1])}</li>`;
    } else if (line.trim() === "") {
      flushPara(); closeList();
    } else {
      closeList();
      para.push(line);
    }
  }
  flushPara(); closeList();

  return html.replace(/@@CODE(\d+)@@/g, (_, i) => `<pre><code>${codeBlocks[i].trim()}</code></pre>`);
}

// Calls our backend and returns parsed JSON or throws a friendly Error
async function postJSON(url, body) {
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error("Cannot reach the EduGenie server. Make sure it is running (npm start).");
  }

  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    throw new Error("Server error: received an invalid response from the server.");
  }

  if (!res.ok || !data.success) {
    throw new Error(data && data.error ? data.error : "Server error. Please try again.");
  }
  return data;
}

// ---------- Gemini status ----------

async function checkStatus() {
  const box = $("status");
  const text = $("statusText");
  try {
    const res = await fetch("/api/health");
    const data = await res.json();
    if (data.geminiConfigured) {
      box.className = "status online";
      text.textContent = "Gemini AI Online";
    } else {
      box.className = "status offline";
      text.textContent = "API Key Missing";
    }
  } catch (e) {
    box.className = "status offline";
    text.textContent = "Server Offline";
  }
}

// ---------- Modes ----------

function setMode(mode) {
  currentMode = mode;
  document.querySelectorAll(".mode").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
  questionEl.placeholder = PLACEHOLDERS[mode];
}

document.querySelectorAll(".mode").forEach((btn) => {
  btn.addEventListener("click", () => setMode(btn.dataset.mode));
});

document.querySelectorAll(".feature[data-mode]").forEach((btn) => {
  btn.addEventListener("click", () => {
    setMode(btn.dataset.mode);
    $("ask").scrollIntoView({ behavior: "smooth" });
    questionEl.focus();
  });
});

document.querySelectorAll(".chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    questionEl.value = chip.dataset.q;
    charCount.textContent = questionEl.value.length;
    questionEl.focus();
  });
});

// ---------- Ask ----------

questionEl.addEventListener("input", () => {
  charCount.textContent = questionEl.value.length;
});

questionEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) askBtn.click();
});

askBtn.addEventListener("click", async () => {
  hideError(askError);
  const question = questionEl.value.trim();

  if (!question) {
    showError(askError, "Please enter a question before asking EduGenie.");
    questionEl.focus();
    return;
  }

  askBtn.disabled = true;
  askLoader.hidden = false;
  responseBox.hidden = true;

  try {
    const data = await postJSON("/api/ask", { question, mode: currentMode });
    lastAnswerText = data.answer;
    responseBody.innerHTML = renderMarkdown(data.answer);
    responseBox.hidden = false;
    responseBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (err) {
    showError(askError, err.message);
  } finally {
    askBtn.disabled = false;
    askLoader.hidden = true;
  }
});

clearBtn.addEventListener("click", () => {
  questionEl.value = "";
  charCount.textContent = "0";
  responseBody.innerHTML = "";
  responseBox.hidden = true;
  hideError(askError);
  lastAnswerText = "";
  questionEl.focus();
});

copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(lastAnswerText);
    copyBtn.textContent = "Copied!";
  } catch (e) {
    copyBtn.textContent = "Copy failed";
  }
  setTimeout(() => (copyBtn.textContent = "Copy"), 1500);
});

// ---------- Quiz ----------

const LETTERS = ["A", "B", "C", "D"];

function renderQuiz(data) {
  currentQuiz = data.questions;
  quizTitle.textContent = `Quiz: ${data.topic}`;
  quizQuestions.innerHTML = currentQuiz
    .map(
      (q, i) => `
      <div class="q" id="q${i}">
        <div class="q-text">Q${i + 1}. ${escapeHtml(q.question)}</div>
        ${q.options
          .map(
            (opt, j) => `
          <label class="opt" data-q="${i}" data-o="${j}">
            <input type="radio" name="q${i}" value="${j}" />
            <span><strong>${LETTERS[j]}.</strong> ${escapeHtml(opt)}</span>
          </label>`
          )
          .join("")}
        <div class="explain" id="exp${i}" hidden></div>
      </div>`
    )
    .join("");

  scoreEl.hidden = true;
  answerKeyEl.hidden = true;
  quizBox.hidden = false;
}

function buildAnswerKey() {
  answerKeyEl.innerHTML =
    "<h4>🔑 Answer Key</h4><ol>" +
    currentQuiz
      .map(
        (q) =>
          `<li><strong>${LETTERS[q.answerIndex]}.</strong> ${escapeHtml(q.options[q.answerIndex])}` +
          (q.explanation ? `<br><span class="muted">${escapeHtml(q.explanation)}</span>` : "") +
          `</li>`
      )
      .join("") +
    "</ol>";
}

quizBtn.addEventListener("click", async () => {
  hideError(quizError);
  const topic = topicEl.value.trim();

  if (!topic) {
    showError(quizError, "Please enter a topic to generate a quiz.");
    topicEl.focus();
    return;
  }

  quizBtn.disabled = true;
  quizLoader.hidden = false;
  quizBox.hidden = true;

  try {
    const data = await postJSON("/api/quiz", { topic });
    renderQuiz(data);
  } catch (err) {
    showError(quizError, err.message);
  } finally {
    quizBtn.disabled = false;
    quizLoader.hidden = true;
  }
});

topicEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") quizBtn.click();
});

checkBtn.addEventListener("click", () => {
  let correct = 0;
  let answered = 0;

  currentQuiz.forEach((q, i) => {
    const chosen = document.querySelector(`input[name="q${i}"]:checked`);
    const opts = document.querySelectorAll(`.opt[data-q="${i}"]`);
    opts.forEach((o) => o.classList.remove("correct", "wrong"));

    opts[q.answerIndex].classList.add("correct");
    if (chosen) {
      answered++;
      if (Number(chosen.value) === q.answerIndex) correct++;
      else opts[Number(chosen.value)].classList.add("wrong");
    }

    const exp = $(`exp${i}`);
    if (q.explanation) {
      exp.textContent = "💡 " + q.explanation;
      exp.hidden = false;
    }
  });

  scoreEl.textContent = `You scored ${correct} / ${currentQuiz.length}` +
    (answered < currentQuiz.length ? ` (${currentQuiz.length - answered} unanswered)` : "");
  scoreEl.hidden = false;

  buildAnswerKey();
  answerKeyEl.hidden = false;
});

keyBtn.addEventListener("click", () => {
  buildAnswerKey();
  answerKeyEl.hidden = !answerKeyEl.hidden ? true : false;
  if (!answerKeyEl.hidden) answerKeyEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
});

quizClearBtn.addEventListener("click", () => {
  topicEl.value = "";
  quizBox.hidden = true;
  quizQuestions.innerHTML = "";
  currentQuiz = [];
  hideError(quizError);
  topicEl.focus();
});

// ---------- Init ----------
checkStatus();
setMode("ask");
