const messages = document.getElementById("messages");
const form = document.getElementById("chat-form");
const input = document.getElementById("input");
const newChatButton = document.getElementById("new-chat");
const promptButtons = document.querySelectorAll("[data-prompt]");

const history = [];

function scrollToBottom() {
  messages.scrollTop = messages.scrollHeight;
}

function createMeta(sourceList = [], usedRag = false) {
  const meta = document.createElement("div");
  meta.className = "message-meta";

  if (usedRag) {
    const rag = document.createElement("span");
    rag.className = "meta-pill";
    rag.textContent = "RAG 已启用";
    meta.appendChild(rag);
  }

  if (sourceList.length) {
    const source = document.createElement("span");
    source.className = "meta-pill";
    source.textContent = `来源：${sourceList.join(", ")}`;
    meta.appendChild(source);
  }

  return meta;
}

function appendMessage(role, text, options = {}) {
  const el = document.createElement("div");
  el.className = `message ${role}`;

  const content = document.createElement("div");
  content.className = "message-content";
  content.textContent = text;
  el.appendChild(content);

  if (role === "assistant" && (options.sources?.length || options.usedRag)) {
    el.appendChild(createMeta(options.sources, options.usedRag));
  }

  messages.appendChild(el);
  scrollToBottom();
  return el;
}

function appendTyping() {
  const el = document.createElement("div");
  el.className = "message assistant";
  const typing = document.createElement("div");
  typing.className = "typing";
  typing.innerHTML = "<span></span><span></span><span></span>";
  el.appendChild(typing);
  messages.appendChild(el);
  scrollToBottom();
  return el;
}

appendMessage(
  "assistant",
  "你好，我可以先帮你检索笔记，再用结构化的方式讲解算法思路。",
  { usedRag: true, sources: ["sample_algorithms.md"] }
);

promptButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const prompt = button.dataset.prompt || "";
    input.value = prompt;
    input.focus();
    input.dispatchEvent(new Event("input"));
    // Keep the clicked shortcut visually active, like a sidebar selection.
    promptButtons.forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
  });
});

newChatButton?.addEventListener("click", () => {
  messages.innerHTML = "";
  history.length = 0;
  input.value = "";
  input.style.height = "auto";
  appendMessage(
    "assistant",
    "新对话已开始。你可以直接问一个算法问题，我会先检索再回答。",
    { usedRag: true, sources: ["sample_algorithms.md"] }
  );
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

input.addEventListener("input", () => {
  // Auto-grow the composer to match the current input length.
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 220)}px`;
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) return;

  appendMessage("user", text);
  history.push({ role: "user", content: text });
  input.value = "";
  input.style.height = "auto";

  const typing = appendTyping();

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, history }),
    });
    const data = await response.json();
    typing.remove();
    appendMessage("assistant", data.answer, {
      sources: data.sources || [],
      usedRag: Boolean(data.used_rag),
    });
    history.push({ role: "assistant", content: data.answer });
  } catch (error) {
    typing.remove();
    appendMessage("assistant", `请求失败：${error}`);
  }
});
