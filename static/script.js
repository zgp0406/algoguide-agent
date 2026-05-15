const messages = document.getElementById("messages");
const form = document.getElementById("chat-form");
const input = document.getElementById("input");
const newChatButton = document.getElementById("new-chat");
const promptButtons = document.querySelectorAll("[data-prompt]");
const chatBadgeText = document.getElementById("chat-badge-text");
const statusDot = document.querySelector(".status-dot");
const recentChatsList = document.getElementById("recent-chats");
const knowledgeToggleButton = document.getElementById("knowledge-toggle");
const knowledgePanel = document.getElementById("knowledge-panel");
const knowledgeBaseSelect = document.getElementById("knowledge-base-select");
const knowledgeBaseNameInput = document.getElementById("knowledge-base-name");
const knowledgeFileInput = document.getElementById("knowledge-file");
const knowledgeUploadButton = document.getElementById("knowledge-upload-btn");
const knowledgePreview = document.getElementById("knowledge-preview");

const history = [];
let readinessMessage = null;
let currentSessionId = null;
let recentSessions = [];
let knowledgeBases = [];
let pendingKnowledgeDraft = null;
let knowledgePanelVisible = false;
let sessionContextMenu = null;
let sessionContextTarget = null;
// 用来防止用户在上一轮还没结束时重复提交，导致历史和会话状态错乱。
let isSubmitting = false;
// 这个状态专门显示“发送中 / 生成中”，和 API 就绪状态分开管理。
let chatPhaseText = "";
let knowledgeUploadPhaseText = "";
let connectionState = {
  ready: false,
  text: "正在检查 API 连接...",
  model: "",
};
const NEW_KNOWLEDGE_BASE_VALUE = "__new__";

function scrollToBottom() {
  messages.scrollTop = messages.scrollHeight;
}

function createMeta(sourceList = [], usedRag = false, knowledgeBase = "") {
  const meta = document.createElement("div");
  meta.className = "message-meta";

  if (knowledgeBase) {
    const kb = document.createElement("span");
    kb.className = "meta-pill";
    if (usedRag) {
      kb.textContent = `知识库：${knowledgeBase}`;
      kb.title = `知识库：${knowledgeBase}`;
      meta.appendChild(kb);

      const rag = document.createElement("span");
      rag.className = "meta-pill";
      rag.textContent = "RAG 已启用";
      meta.appendChild(rag);
    } else {
      kb.textContent = `知识库：${knowledgeBase} · 模型推理`;
      kb.title = "知识库已启用，未找到直接相关内容。本次回答主要基于模型推理。";
      meta.appendChild(kb);
    }
  }

  if (sourceList.length) {
    const source = document.createElement("span");
    source.className = "meta-pill";
    source.textContent = `来源：${sourceList.join(", ")}`;
    meta.appendChild(source);
  }

  return meta;
}

function formatEvidenceScore(score) {
  if (typeof score !== "number" || Number.isNaN(score)) {
    return "";
  }
  if (score <= 1) {
    return `相关度 ${Math.round(score * 100)}%`;
  }
  return `分数 ${score.toFixed(2)}`;
}

function createEvidenceBlock(evidence = []) {
  const details = document.createElement("details");
  details.className = "message-evidence";

  const summary = document.createElement("summary");
  summary.textContent = `参考片段 ${evidence.length ? `(${evidence.length})` : ""}`.trim();
  details.appendChild(summary);

  const list = document.createElement("div");
  list.className = "evidence-list";

  evidence.forEach((item, index) => {
    const card = document.createElement("article");
    card.className = "evidence-item";

    const heading = document.createElement("div");
    heading.className = "evidence-heading";

    const kb = document.createElement("span");
    kb.className = "evidence-kb";
    kb.textContent = item?.knowledge_base_name ? String(item.knowledge_base_name) : "全库检索";
    heading.appendChild(kb);

    const source = document.createElement("span");
    source.className = "evidence-source";
    source.textContent = item?.source ? String(item.source) : `来源 ${index + 1}`;
    heading.appendChild(source);

    if (item?.location) {
      const location = document.createElement("span");
      location.className = "evidence-location";
      location.textContent = String(item.location);
      heading.appendChild(location);
    }

    const score = formatEvidenceScore(Number(item?.score));
    if (score) {
      const scoreEl = document.createElement("span");
      scoreEl.className = "evidence-score";
      scoreEl.textContent = score;
      heading.appendChild(scoreEl);
    }

    card.appendChild(heading);

    const excerpt = document.createElement("p");
    excerpt.className = "evidence-excerpt";
    excerpt.textContent = item?.excerpt ? String(item.excerpt) : "没有可展示的片段。";
    card.appendChild(excerpt);

    list.appendChild(card);
  });

  details.appendChild(list);
  return details;
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

  if (role === "assistant" && (options.sources?.length || options.usedRag || options.knowledgeBase)) {
    el.appendChild(createMeta(options.sources, options.usedRag, options.knowledgeBase));
  }

  if (role === "assistant" && Array.isArray(options.evidence) && options.evidence.length) {
    el.appendChild(createEvidenceBlock(options.evidence));
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

function appendMessageMeta(messageEl, sourceList = [], usedRag = false, knowledgeBase = "") {
  if (messageEl.querySelector(".message-meta")) {
    return;
  }

  if (sourceList.length || usedRag || knowledgeBase) {
    messageEl.appendChild(createMeta(sourceList, usedRag, knowledgeBase));
  }
}

function appendMessageEvidence(messageEl, evidence = []) {
  if (!Array.isArray(evidence) || !evidence.length || messageEl.querySelector(".message-evidence")) {
    return;
  }
  messageEl.appendChild(createEvidenceBlock(evidence));
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

function getSelectedKnowledgeBase() {
  if (!knowledgeBaseSelect) {
    return { kind: "builtin", id: "", name: "" };
  }
  const value = knowledgeBaseSelect.value;
  if (value === NEW_KNOWLEDGE_BASE_VALUE) {
    return {
      kind: "new",
      id: "",
      name: String(knowledgeBaseNameInput?.value || "").trim(),
    };
  }
  return {
    kind: "existing",
    id: value,
    name: knowledgeBases.find((item) => item.id === value)?.name || "",
  };
}

function syncKnowledgeBaseNameVisibility() {
  if (!knowledgeBaseNameInput || !knowledgeBaseSelect) return;
  const isNew = knowledgeBaseSelect.value === NEW_KNOWLEDGE_BASE_VALUE;
  knowledgeBaseNameInput.hidden = !isNew;
  if (!isNew) {
    knowledgeBaseNameInput.value = "";
  }
}

function setKnowledgePanelVisible(visible) {
  knowledgePanelVisible = Boolean(visible);
  if (knowledgePanel) {
    knowledgePanel.hidden = !knowledgePanelVisible;
  }
  if (knowledgeToggleButton) {
    knowledgeToggleButton.textContent = knowledgePanelVisible ? "收起知识库" : "添加知识库";
  }
  if (knowledgePanelVisible && knowledgePreview && knowledgePreview.classList.contains("knowledge-preview-empty")) {
    knowledgePreview.focus?.();
  }
}

function renderKnowledgeBaseOptions(selectedId = "") {
  if (!knowledgeBaseSelect) return;

  knowledgeBaseSelect.innerHTML = "";

  knowledgeBases.forEach((item) => {
    const option = document.createElement("option");
    option.value = String(item.id);
    option.textContent = `${item.name} (${item.document_count || 0} 文档)`;
    if (item.id === selectedId) {
      option.selected = true;
    }
    knowledgeBaseSelect.appendChild(option);
  });

  const divider = document.createElement("option");
  divider.value = NEW_KNOWLEDGE_BASE_VALUE;
  divider.textContent = "新建知识库...";
  if (!selectedId && knowledgeBases.length === 0) {
    divider.selected = true;
  }
  knowledgeBaseSelect.appendChild(divider);

  if (selectedId && !knowledgeBases.some((item) => item.id === selectedId)) {
    knowledgeBaseSelect.value = NEW_KNOWLEDGE_BASE_VALUE;
  } else if (!knowledgeBaseSelect.value) {
    knowledgeBaseSelect.value = knowledgeBases[0]?.id || NEW_KNOWLEDGE_BASE_VALUE;
  }

  syncKnowledgeBaseNameVisibility();
}

function setKnowledgePreviewEmpty(message = "上传 PDF 或 Word 文档后，会在这里看到摘要和切块预览。") {
  pendingKnowledgeDraft = null;
  if (!knowledgePreview) return;
  knowledgePreview.innerHTML = "";
  knowledgePreview.classList.add("knowledge-preview-empty");
  knowledgePreview.textContent = message;
}

function renderKnowledgePreview(draft) {
  if (!knowledgePreview) return;

  knowledgePreview.innerHTML = "";
  knowledgePreview.classList.remove("knowledge-preview-empty");

  const header = document.createElement("div");
  header.className = "knowledge-preview-header";

  const title = document.createElement("strong");
  title.textContent = draft.file_name || "未命名文档";
  header.appendChild(title);

  const status = document.createElement("span");
  const target = getSelectedKnowledgeBase();
  status.className = "knowledge-preview-status";
  status.textContent =
    target.kind === "new"
      ? `目标：新建 ${target.name || "未命名知识库"}`
      : `目标：${target.name || "未选择知识库"}`;
  header.appendChild(status);
  knowledgePreview.appendChild(header);

  const summary = document.createElement("p");
  summary.className = "knowledge-preview-summary";
  summary.textContent = draft.summary || "暂无摘要。";
  knowledgePreview.appendChild(summary);

  const meta = document.createElement("div");
  meta.className = "knowledge-preview-meta";
  const parts = [];
  if (draft.char_count) parts.push(`${draft.char_count} 字符`);
  if (draft.block_count) parts.push(`${draft.block_count} 片段`);
  if (draft.chunk_count) parts.push(`${draft.chunk_count} 切块`);
  if (draft.skipped_block_count) parts.push(`跳过 ${draft.skipped_block_count} 公式块`);
  if (draft.extraction_mode === "ocr") parts.push("OCR 兜底");
  meta.textContent = parts.join(" · ");
  knowledgePreview.appendChild(meta);

  const list = document.createElement("div");
  list.className = "knowledge-preview-list";

  (Array.isArray(draft.preview_chunks) ? draft.preview_chunks : []).forEach((chunk) => {
    const card = document.createElement("article");
    card.className = "knowledge-preview-item";

    const itemMeta = document.createElement("div");
    itemMeta.className = "knowledge-preview-item-meta";

    const source = document.createElement("span");
    source.textContent = chunk.source || draft.file_name || "";
    itemMeta.appendChild(source);

    if (chunk.location) {
      const location = document.createElement("span");
      location.textContent = chunk.location;
      itemMeta.appendChild(location);
    }

    card.appendChild(itemMeta);

    const excerpt = document.createElement("p");
    excerpt.textContent = chunk.text || "";
    card.appendChild(excerpt);

    list.appendChild(card);
  });

  knowledgePreview.appendChild(list);

  if (draft.skipped_block_count) {
    const warning = document.createElement("div");
    warning.className = "knowledge-preview-warning";
    warning.textContent = "检测到较多公式块，已自动跳过，仅保留正文用于入库。";
    knowledgePreview.appendChild(warning);
  }

  if (draft.extraction_warning) {
    const warning = document.createElement("div");
    warning.className = "knowledge-preview-warning";
    warning.textContent = draft.extraction_warning;
    knowledgePreview.appendChild(warning);
  }

  const footer = document.createElement("div");
  footer.className = "knowledge-preview-actions";

  const confirmButton = document.createElement("button");
  confirmButton.type = "button";
  confirmButton.className = "knowledge-confirm-button";
  confirmButton.textContent = "确认入库";
  confirmButton.addEventListener("click", confirmKnowledgeDraft);
  footer.appendChild(confirmButton);

  const tip = document.createElement("span");
  tip.className = "knowledge-preview-tip";
  tip.textContent = "确认后会重建索引并立即可检索。";
  footer.appendChild(tip);

  knowledgePreview.appendChild(footer);
  pendingKnowledgeDraft = draft;
}

async function loadKnowledgeBases() {
  try {
    const response = await fetch("/api/knowledge-bases");
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    knowledgeBases = Array.isArray(data.knowledge_bases) ? data.knowledge_bases : [];
    renderKnowledgeBaseOptions(String(data.default_knowledge_base_id || knowledgeBases[0]?.id || ""));
  } catch (error) {
    knowledgeBases = [];
    renderKnowledgeBaseOptions();
    console.error("Failed to load knowledge bases:", error);
  }
}

async function uploadKnowledgeDocument() {
  if (!knowledgeFileInput || !knowledgeFileInput.files?.length) {
    window.alert("先选择一个 PDF 或 Word 文件。");
    return;
  }

  const file = knowledgeFileInput.files[0];
  const target = getSelectedKnowledgeBase();
  if (target.kind === "new" && !target.name) {
    window.alert("请先输入新知识库名称。");
    return;
  }

  const formData = new FormData();
  formData.append("file", file);
  if (target.kind === "existing" && target.id) {
    formData.append("knowledge_base_id", target.id);
  }
  if (target.kind === "new" && target.name) {
    formData.append("knowledge_base_name", target.name);
  }

  if (knowledgeUploadButton) knowledgeUploadButton.disabled = true;
  if (knowledgePreview) {
    knowledgePreview.classList.remove("knowledge-preview-empty");
    knowledgePreview.textContent = "正在解析文档，请稍候...";
  }

  try {
    const response = await fetch("/api/knowledge/upload", {
      method: "POST",
      body: formData,
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.detail || `HTTP ${response.status}`);
    }
    if (Array.isArray(data.knowledge_bases)) {
      knowledgeBases = data.knowledge_bases;
      const currentTargetId = target.kind === "existing" ? target.id : "";
      renderKnowledgeBaseOptions(currentTargetId);
      if (target.kind === "new" && knowledgeBaseNameInput) {
        knowledgeBaseNameInput.value = target.name;
      }
    }
    renderKnowledgePreview(data.draft);
  } catch (error) {
    setKnowledgePreviewEmpty(`上传解析失败：${error}`);
  } finally {
    if (knowledgeUploadButton) knowledgeUploadButton.disabled = false;
  }
}

async function confirmKnowledgeDraft() {
  if (!pendingKnowledgeDraft?.draft_id) {
    window.alert("请先上传文档并完成预览。");
    return;
  }

  const target = getSelectedKnowledgeBase();
  if (target.kind === "new" && !target.name) {
    window.alert("请先输入新知识库名称。");
    return;
  }

  const payload = {
    draft_id: pendingKnowledgeDraft.draft_id,
  };
  if (target.kind === "existing" && target.id) {
    payload.knowledge_base_id = target.id;
  }
  if (target.kind === "new" && target.name) {
    payload.knowledge_base_name = target.name;
  }

  if (knowledgePreview) {
    knowledgePreview.classList.remove("knowledge-preview-empty");
    knowledgePreview.textContent = "正在确认入库并重建索引...";
  }

  try {
    const response = await fetch("/api/knowledge/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.detail || `HTTP ${response.status}`);
    }

    if (Array.isArray(data.knowledge_bases)) {
      knowledgeBases = data.knowledge_bases;
      const selectedId = data.knowledge_base?.id || target.id || "";
      renderKnowledgeBaseOptions(selectedId);
    }

    if (knowledgeFileInput) {
      knowledgeFileInput.value = "";
    }
    pendingKnowledgeDraft = null;
    const resultMessage = document.createElement("div");
    resultMessage.className = "knowledge-preview-success";
    resultMessage.textContent = `已入库：${data.document?.filename || "文档"}。索引已更新。`;
    if (knowledgePreview) {
      knowledgePreview.innerHTML = "";
      knowledgePreview.classList.remove("knowledge-preview-empty");
      knowledgePreview.appendChild(resultMessage);
    }
  } catch (error) {
    setKnowledgePreviewEmpty(`确认入库失败：${error}`);
  }
}

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
  const ok = window.confirm("确定删除这个会话吗？删除后无法恢复。");
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
  } catch (error) {
    window.alert(`删除会话失败：${error}`);
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
    const parts = [];
    if (typeof session.message_count === "number") {
      parts.push(`${session.message_count} 条消息`);
    }
    const time = formatSessionTime(session.updated_at);
    if (time) {
      parts.push(time);
    }
    meta.textContent = parts.join(" · ");
    item.appendChild(meta);

    if (session.summary) {
      const summary = document.createElement("div");
      summary.className = "session-summary";
      summary.textContent = session.summary;
      item.appendChild(summary);
    }

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
  const nextTitle = window.prompt("请输入新的会话标题", currentTitle || "新对话");
  if (nextTitle === null) return;

  const title = nextTitle.trim();
  if (!title) {
    window.alert("标题不能为空。");
    return;
  }

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
      ].slice(0, 10);
      renderRecentChats(recentSessions);
    }
  } catch (error) {
    window.alert(`修改标题失败：${error}`);
  }
}

function renderConversation(messagesData = [], includeIntro = false) {
  messages.innerHTML = "";
  readinessMessage = appendMessage("assistant", connectionState.text);

  if (includeIntro) {
    appendMessage(
      "assistant",
      "新对话已开始。你可以直接问一个算法问题，我会先检索再回答。",
      { usedRag: true, sources: ["sample_algorithms.md"], knowledgeBase: "全库检索" }
    );
  }

  messagesData.forEach((message) => {
    appendMessage(message.role, message.content, {
      sources: Array.isArray(message.sources) ? message.sources : [],
      evidence: Array.isArray(message.evidence) ? message.evidence : [],
      usedRag: Boolean(message.used_rag),
      knowledgeBase: "全库检索",
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

// 统一更新右上角状态文案，既能显示连接状态，也能显示发送/生成过程。
function renderChatBadge() {
  if (!chatBadgeText) return;

  if (chatPhaseText) {
    chatBadgeText.textContent = chatPhaseText;
    return;
  }

  const { ready, model } = connectionState;
  chatBadgeText.textContent = ready && model ? `已准备好 · ${model}` : ready ? "已准备好" : "未就绪";
}

function setChatPhase(text = "") {
  chatPhaseText = text;
  renderChatBadge();
}

function setComposerBusy(busy) {
  const submitButton = form.querySelector('button[type="submit"]');
  if (input) {
    input.disabled = busy;
  }
  if (submitButton) {
    submitButton.disabled = busy;
  }
  if (newChatButton) {
    newChatButton.disabled = busy;
  }
  promptButtons.forEach((button) => {
    button.disabled = busy;
  });
}

function setConnectionStatus(ready, text, model = "") {
  connectionState = { ready, text, model };
  renderChatBadge();

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

// 把最新会话摘要合并到左侧列表，避免每次回复都重新请求整份列表。
function upsertRecentSession(session) {
  if (!session || !session.id) return;

  const normalized = {
    id: String(session.id),
    title: String(session.title || "新对话"),
    updated_at: String(session.updated_at || ""),
    message_count: Number(session.message_count || 0),
    summary: String(session.summary || ""),
  };

  recentSessions = [
    normalized,
    ...recentSessions.filter((item) => item.id !== normalized.id),
  ].slice(0, 10);

  renderRecentChats(recentSessions);
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
loadKnowledgeBases();
loadRecentChats();
setKnowledgePanelVisible(false);

knowledgeBaseSelect?.addEventListener("change", () => {
  syncKnowledgeBaseNameVisibility();
  if (pendingKnowledgeDraft) {
    renderKnowledgePreview(pendingKnowledgeDraft);
  }
});

knowledgeBaseNameInput?.addEventListener("input", () => {
  if (pendingKnowledgeDraft) {
    renderKnowledgePreview(pendingKnowledgeDraft);
  }
});

knowledgeUploadButton?.addEventListener("click", uploadKnowledgeDocument);

knowledgeToggleButton?.addEventListener("click", () => {
  setKnowledgePanelVisible(!knowledgePanelVisible);
});

document.addEventListener("click", () => {
  hideSessionContextMenu();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    hideSessionContextMenu();
  }
});

window.addEventListener("scroll", hideSessionContextMenu, true);
window.addEventListener("resize", hideSessionContextMenu);

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

  // 这一步说明请求已经发出并拿到了流式响应，界面切到“生成中”更直观。
  setChatPhase("生成中...");
  const assistantMessage = appendMessage("assistant", "正在生成...");
  const assistantContent = assistantMessage.querySelector(".message-content");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let currentEvent = "message";
  let currentData = [];
  let streamedAnswer = "";
  let meta = { sources: [], usedRag: false, knowledgeBase: "" };
  let evidence = [];
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
        knowledgeBase: String(payload.knowledge_base || ""),
      };
      evidence = Array.isArray(payload.evidence) ? payload.evidence : evidence;
      if (payload.error) {
        appendErrorMeta(assistantMessage, String(payload.error));
      }
      appendMessageEvidence(assistantMessage, evidence);
      if (payload.session) {
        upsertRecentSession(payload.session);
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
        Boolean(payload.used_rag ?? meta.usedRag),
        String(payload.knowledge_base || meta.knowledgeBase || "")
      );
      appendMessageEvidence(
        assistantMessage,
        Array.isArray(payload.evidence) && payload.evidence.length ? payload.evidence : evidence
      );
      if (payload.session) {
        upsertRecentSession(payload.session);
      }
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
  if (isSubmitting) return;
  const text = input.value.trim();
  if (!text) return;

  appendMessage("user", text);
  history.push({ role: "user", content: text });
  input.value = "";
  input.style.height = "auto";

  // 先把按钮锁住，并把状态切到“发送中”，避免用户以为页面没有反应。
  setChatPhase("发送中...");
  const typing = appendTyping();
  isSubmitting = true;
  setComposerBusy(true);

  try {
    if (typing.isConnected) {
      typing.remove();
    }
    const result = await submitStreamingChat(text);
    const assistantMessage = result.assistantMessage;
    if (result.sessionId) {
      currentSessionId = result.sessionId;
    }
    if (result.session) {
      upsertRecentSession(result.session);
    }
    const assistantText = assistantMessage.querySelector(".message-content")?.textContent || "";
    history.push({ role: "assistant", content: assistantText });
  } catch (error) {
    if (typing.isConnected) {
      typing.remove();
    }
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history, session_id: currentSessionId }),
      });
      const data = await response.json();
      const assistantMessage = appendMessage("assistant", data.answer, {
        sources: data.sources || [],
        evidence: Array.isArray(data.evidence) ? data.evidence : [],
        usedRag: Boolean(data.used_rag),
        knowledgeBase: String(data.knowledge_base || ""),
      });
      if (data.error) {
        appendErrorMeta(assistantMessage, data.error);
      }
      if (data.session_id) {
        currentSessionId = data.session_id;
      }
      if (data.session) {
        upsertRecentSession(data.session);
      }
      history.push({
        role: "assistant",
        content: assistantMessage.querySelector(".message-content")?.textContent || data.answer,
      });
    } catch (fallbackError) {
      appendMessage("assistant", `请求失败：${fallbackError}`);
    }
  } finally {
    if (typing.isConnected) {
      typing.remove();
    }
    isSubmitting = false;
    setComposerBusy(false);
    setChatPhase("");
  }
});
