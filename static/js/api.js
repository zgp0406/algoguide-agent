// Generated from script.js - see static/js/ for modular source
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
    const response = await fetch("/api/sessions?limit=50");
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
    showWorkspaceView("chat");
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
    updateLearningProgress(session, session.messages || []);
    renderRecentChats(recentSessions);
  } catch (error) {
    if (!options.silent) {
      appendMessage("assistant", `打开会话失败：${error}`);
    }
  }
}
