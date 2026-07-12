// Generated from script.js - see static/js/ for modular source
function ensureSessionContextMenu() {
  if (sessionContextMenu) return sessionContextMenu;

  const menu = document.createElement("div");
  menu.className = "session-context-menu";
  menu.hidden = true;
  menu.innerHTML = `
    <button type="button" data-action="rename">重命名</button>
    <button type="button" data-action="delete" class="danger">删除</button>
  `;

  menu.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button || !sessionContextTarget) return;
    const action = button.dataset.action;
    const target = sessionContextTarget;
    hideSessionContextMenu();
    if (action === "rename") {
      await renameSession(target.id, target.title || "新对话");
    } else if (action === "delete") {
      await deleteSession(target.id);
    }
  });

  document.body.appendChild(menu);
  sessionContextMenu = menu;
  return menu;
}

function hideSessionContextMenu() {
  if (!sessionContextMenu) return;
  sessionContextMenu.hidden = true;
  sessionContextTarget = null;
}

function showSessionContextMenu(session, x, y) {
  const menu = ensureSessionContextMenu();
  sessionContextTarget = session;
  menu.hidden = false;
  menu.style.left = "0px";
  menu.style.top = "0px";

  const { innerWidth, innerHeight } = window;
  const rect = menu.getBoundingClientRect();
  const width = rect.width || 160;
  const height = rect.height || 92;
  const left = Math.min(x, innerWidth - width - 8);
  const top = Math.min(y, innerHeight - height - 8);
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.max(8, top)}px`;
}

async function deleteSession(sessionId) {
  const ok = await confirmDialog({
    title: "删除会话",
    message: "确定删除这个会话吗？删除后无法恢复。",
    confirmText: "删除",
    danger: true,
  });
  if (!ok) return;

  try {
    const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    if (!data.deleted) {
      throw new Error("删除失败");
    }

    recentSessions = recentSessions.filter((item) => item.id !== sessionId);
    if (currentSessionId === sessionId) {
      currentSessionId = recentSessions[0]?.id || null;
      history.length = 0;
      if (currentSessionId) {
        await openSession(currentSessionId, { silent: true });
      } else {
        renderConversation([], true);
      }
    } else {
      renderRecentChats(recentSessions);
    }
    showToast("会话已删除。", "success");
  } catch (error) {
    showToast(`删除会话失败：${error}`, "error");
  }
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
    const item = document.createElement("div");
    item.className = `session-item${session.id === currentSessionId ? " active" : ""}`;
    item.dataset.sessionId = session.id;
    item.tabIndex = 0;
    item.setAttribute("role", "button");

    const header = document.createElement("div");
    header.className = "session-item-header";

    const title = document.createElement("div");
    title.className = "session-title";
    title.textContent = session.title || "新对话";
    title.title = session.title || "新对话";
    header.appendChild(title);
    item.appendChild(header);

    const meta = document.createElement("div");
    meta.className = "session-meta";
    const time = formatSessionTime(session.updated_at);
    meta.textContent = time || "";
    item.appendChild(meta);

    item.addEventListener("click", () => {
      openSession(session.id);
    });

    item.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      showSessionContextMenu(
        {
          id: session.id,
          title: session.title || "新对话",
        },
        event.clientX,
        event.clientY
      );
    });

    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openSession(session.id);
      }
    });

    recentChatsList.appendChild(item);
  });
}

async function renameSession(sessionId, currentTitle) {
  const nextTitle = await promptDialog({
    title: "重命名会话",
    message: "给这次对话取一个更方便回看的标题。",
    initialValue: currentTitle || "新对话",
    placeholder: "会话标题",
    required: true,
    requiredMessage: "标题不能为空。",
  });
  if (nextTitle === null) return;

  const title = nextTitle.trim();

  try {
    const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/title`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    if (data.session) {
      if (currentSessionId === sessionId) {
        currentSessionId = String(data.session.id || sessionId);
      }
      recentSessions = [
        {
          id: String(data.session.id || sessionId),
          title: String(data.session.title || title),
          updated_at: String(data.session.updated_at || ""),
          summary: String(data.session.summary || ""),
          message_count: Array.isArray(data.session.messages) ? data.session.messages.length : 0,
        },
        ...recentSessions.filter((item) => item.id !== sessionId),
      ].slice(0, 50);
      renderRecentChats(recentSessions);
    }
    showToast("会话标题已更新。", "success");
  } catch (error) {
    showToast(`修改标题失败：${error}`, "error");
  }
}
