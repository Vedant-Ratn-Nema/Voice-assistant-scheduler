let sessionId = null;
const chatEl = document.getElementById("chat");
const chatForm = document.getElementById("chatForm");
const inputEl = document.getElementById("textInput");
const micBtn = document.getElementById("micBtn");
const ttsToggle = document.getElementById("ttsToggle");

function addMessage(role, text) {
  const el = document.createElement("div");
  el.className = `msg ${role}`;
  el.textContent = text;
  chatEl.appendChild(el);
  chatEl.scrollTop = chatEl.scrollHeight;
}

function speak(text) {
  if (!ttsToggle.checked || !window.speechSynthesis) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.04;
  utterance.pitch = 1;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

async function initSession() {
  const res = await fetch("/api/session", { method: "POST" });
  const data = await res.json();
  sessionId = data.sessionId;
}

async function sendMessage(text) {
  if (!sessionId) await initSession();
  addMessage("user", text);

  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId,
      text,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    addMessage("bot", `Error: ${data.error || "Unknown server error"}`);
    return;
  }
  addMessage("bot", data.message);
  speak(data.message);
}

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = inputEl.value.trim();
  if (!text) return;
  inputEl.value = "";
  await sendMessage(text);
});

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onresult = async (event) => {
    const transcript = event.results[0][0].transcript;
    await sendMessage(transcript);
  };

  recognition.onerror = () => {
    micBtn.textContent = "🎤 Push to Talk";
  };

  recognition.onend = () => {
    micBtn.textContent = "🎤 Push to Talk";
  };

  micBtn.addEventListener("mousedown", () => {
    micBtn.textContent = "Listening...";
    recognition.start();
  });
  micBtn.addEventListener("mouseup", () => {
    recognition.stop();
  });
  micBtn.addEventListener("touchstart", () => {
    micBtn.textContent = "Listening...";
    recognition.start();
  });
  micBtn.addEventListener("touchend", () => {
    recognition.stop();
  });
} else {
  micBtn.disabled = true;
  micBtn.textContent = "Speech recognition unsupported in this browser";
}

addMessage("bot", "Hi! I can help you schedule a meeting. How long should it be?");
