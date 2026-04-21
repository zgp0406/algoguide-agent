const messages = document.getElementById("messages");
const form = document.getElementById("chat-form");
const input = document.getElementById("input");
const newChatButton = document.getElementById("new-chat");
const promptButtons = document.querySelectorAll("[data-prompt]");
const chatBadgeText = document.getElementById("chat-badge-text");
const statusDot = document.querySelector(".status-dot");
const recentChatsList = document.getElementById("recent-chats");

const history = [];
let readinessMessage = null;
let currentSessionId = null;
let recentSessions = [];
let connectionState = {
  ready: false,
  text: "正在检查 API 连接...",
};

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

function appendErrorMeta(messageEl, errorText) {
  if (!errorText) return;

  let meta = messageEl.querySelector(".message-meta");
  if (!meta) {
    meta = document.createElement("div");
    meta.className = "message-meta";
    messageEl.appendChild(meta);
  }

  const errorPill = document.createElement("span");
  errorPill.className = "meta-pill";
  errorPill.textContent = `错误：${errorText}`;
  meta.appendChild(errorPill);
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

function setMessageText(messageEl, text) {
  const content = messageEl.querySelector(".message-content");
  if (content) {
    content.textContent = text;
  }
}

function appendMessageMeta(messageEl, sourceList = [], usedRag = false) {
  if (messageEl.querySelector(".message-meta")) {
    return;
  }

  if (sourceList.length || usedRag) {
    messageEl.appendChild(createMeta(sourceList, usedRag));
  }
}

function formatSessionTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderRecentChats(sessions) {
  if (!recentChatsList) return;

  recentChatsList.innerHTML = "";
  if (!sessions.length) {
    const empty = document.createElement("div");
    empty.className = "session-empty";
    empty.textContent = "暂无会话记录，先发一条消息就会自动保存。";
    recentChatsList.appendChild(empty);
    return;
  }

  sessions.forEach((session) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `session-item${session.id === currentSessionId ? " active" : ""}`;
    button.dataset.sessionId = session.id;

    const title = document.createElement("div");
    title.className = "session-title";
    title.textContent = session.title || "新对话";
    button.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "session-meta";
    const parts = [];
    if (typeof session.message_count === "number") {
      parts.push(`${session.message_count} 条消息`);
    }
    const time = formatSessionTime(session.updated_at);
    if (time) {
      parts.push(time);
    }
    meta.textContent = parts.join(" · ");
    button.appendChild(meta);

    button.addEventListener("click", () => {
      openSession(session.id);
    });

    recentChatsList.appendChild(button);
  });
}

function renderConversation(messagesData = [], includeIntro = false) {
  messages.innerHTML = "";
  readinessMessage = appendMessage("assistant", connectionState.text);

  if (includeIntro) {
    appendMessage(
      "assistant",
      "新对话已开始。你可以直接问一个算法问题，我会先检索再回答。",
      { usedRag: true, sources: ["sample_algorithms.md"] }
    );
  }

  messagesData.forEach((message) => {
    appendMessage(message.role, message.content, {
      sources: Array.isArray(message.sources) ? message.sources : [],
      usedRag: Boolean(message.used_rag),
    });
  });
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

function setConnectionStatus(ready, text, model = "") {
  connectionState = { ready, text };

  if (chatBadgeText) {
    chatBadgeText.textContent = ready && model ? `已准备好 · ${model}` : ready ? "已准备好" : "未就绪";
  }

  if (statusDot) {
    statusDot.classList.toggle("ready", ready);
    statusDot.classList.toggle("not-ready", !ready);
  }

  if (readinessMessage) {
    const content = readinessMessage.querySelector(".message-content");
    if (content) {
      content.textContent = text;
    }
  } else {
    readinessMessage = appendMessage("assistant", text);
  }
}

readinessMessage = appendMessage("assistant", "正在检查 API 连接...");

async function loadStatus() {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch("/api/status", { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    const modelLabel = data.model ? `\n当前模型：${data.model}` : "";
    const baseUrlLabel = data.base_url ? `\n接口地址：${data.base_url}` : "";
    const details = data.error ? `\n原因：${data.error}` : "";
    setConnectionStatus(
      Boolean(data.ready),
      `${data.message || "状态已更新。"}${modelLabel}${baseUrlLabel}${details}`,
      data.model || ""
    );
  } catch (error) {
    const message =
      error?.name === "AbortError"
        ? "API 状态检查超时，将使用本地兜底回答。"
        : `API 状态检查失败：${error}`;
    setConnectionStatus(false, message);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function loadRecentChats() {
  try {
    const response = await fetch("/api/sessions?limit=10");
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    recentSessions = Array.isArray(data.sessions) ? data.sessions : [];
    renderRecentChats(recentSessions);

    if (!currentSessionId && recentSessions.length) {
      await openSession(recentSessions[0].id, { silent: true });
    } else {
      renderRecentChats(recentSessions);
    }
  } catch (error) {
    recentSessions = [];
    renderRecentChats(recentSessions);
    console.error("Failed to load recent chats:", error);
  }
}

async function openSession(sessionId, options = {}) {
  try {
    const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    const session = data.session;
    if (!session) {
      throw new Error("Session not found");
    }

    currentSessionId = session.id;
    history.length = 0;
    (session.messages || []).forEach((message) => {
      history.push({ role: message.role, content: message.content });
    });
    renderConversation(session.messages || [], false);
    renderRecentChats(recentSessions);
  } catch (error) {
    if (!options.silent) {
      appendMessage("assistant", `打开会话失败：${error}`);
    }
  }
}

loadStatus();
loadRecentChats();

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
  currentSessionId = null;
  history.length = 0;
  input.value = "";
  input.style.height = "auto";
  renderConversation([], true);
  renderRecentChats(recentSessions);
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

async function submitStreamingChat(text) {
  const controller = new AbortController();
  const response = await fetch("/api/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: text, history, session_id: currentSessionId }),
    signal: controller.signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status}`);
  }

  const assistantMessage = appendMessage("assistant", "正在生成...");
  const assistantContent = assistantMessage.querySelector(".message-content");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let currentEvent = "message";
  let currentData = [];
  let streamedAnswer = "";
  let meta = { sources: [], usedRag: false };
  let sawDelta = false;
  let streamedSessionId = currentSessionId;

  const handleEvent = (eventName, rawData) => {
    if (!rawData) return;

    let payload = null;
    try {
      payload = JSON.parse(rawData);
    } catch {
      payload = { text: rawData };
    }

    if (eventName === "meta") {
      if (payload.session_id) {
        streamedSessionId = String(payload.session_id);
        currentSessionId = streamedSessionId;
      }
      meta = {
        sources: Array.isArray(payload.sources) ? payload.sources : [],
        usedRag: Boolean(payload.used_rag),
      };
      if (payload.error) {
        appendErrorMeta(assistantMessage, String(payload.error));
      }
      return;
    }

    if (eventName === "delta") {
      const chunk = typeof payload.text === "string" ? payload.text : "";
      if (!chunk) return;
      if (!sawDelta) {
        streamedAnswer = "";
        sawDelta = true;
      }
      streamedAnswer += chunk;
      setMessageText(assistantMessage, streamedAnswer);
      scrollToBottom();
      return;
    }

    if (eventName === "done") {
      if (payload.session_id) {
        streamedSessionId = String(payload.session_id);
        currentSessionId = streamedSessionId;
      }
      const finalAnswer = typeof payload.answer === "string" ? payload.answer : streamedAnswer;
      if (finalAnswer && !sawDelta) {
        setMessageText(assistantMessage, finalAnswer);
      } else if (finalAnswer && finalAnswer !== streamedAnswer) {
        setMessageText(assistantMessage, finalAnswer);
      }

      appendMessageMeta(
        assistantMessage,
        Array.isArray(payload.sources) && payload.sources.length ? payload.sources : meta.sources,
        Boolean(payload.used_rag ?? meta.usedRag)
      );
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
      buffer = buffer.slice(newlineIndex + 1);

      if (line === "") {
        if (currentData.length) {
          handleEvent(currentEvent, currentData.join("\n"));
        }
        currentEvent = "message";
        currentData = [];
      } else if (line.startsWith("event:")) {
        currentEvent = line.slice(6).trim() || "message";
      } else if (line.startsWith("data:")) {
        currentData.push(line.slice(5).trimStart());
      }

      newlineIndex = buffer.indexOf("\n");
    }
  }

  buffer += decoder.decode();
  if (buffer.length) {
    const line = buffer.replace(/\r$/, "");
    if (line === "") {
      if (currentData.length) {
        handleEvent(currentEvent, currentData.join("\n"));
      }
    } else if (line.startsWith("event:")) {
      currentEvent = line.slice(6).trim() || "message";
    } else if (line.startsWith("data:")) {
      currentData.push(line.slice(5).trimStart());
    }
  }

  if (currentData.length) {
    handleEvent(currentEvent, currentData.join("\n"));
  }

  if (!sawDelta && !assistantContent.textContent.trim()) {
    setMessageText(assistantMessage, "请求完成，但没有返回内容。");
  }

  return { assistantMessage, sessionId: streamedSessionId };
}

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
    typing.remove();
    const result = await submitStreamingChat(text);
    const assistantMessage = result.assistantMessage;
    if (result.sessionId) {
      currentSessionId = result.sessionId;
    }
    const assistantText = assistantMessage.querySelector(".message-content")?.textContent || "";
    history.push({ role: "assistant", content: assistantText });
    await loadRecentChats();
  } catch (error) {
    typing.remove();
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history, session_id: currentSessionId }),
      });
      const data = await response.json();
      const assistantMessage = appendMessage("assistant", data.answer, {
        sources: data.sources || [],
        usedRag: Boolean(data.used_rag),
      });
      if (data.error) {
        appendErrorMeta(assistantMessage, data.error);
      }
      if (data.session_id) {
        currentSessionId = data.session_id;
      }
      history.push({
        role: "assistant",
        content: assistantMessage.querySelector(".message-content")?.textContent || data.answer,
      });
      await loadRecentChats();
    } catch (fallbackError) {
      appendMessage("assistant", `请求失败：${fallbackError}`);
    }
  }
});
