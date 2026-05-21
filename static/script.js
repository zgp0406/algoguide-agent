const messages = document.getElementById("messages");
const form = document.getElementById("chat-form");
const input = document.getElementById("input");
const newChatButton = document.getElementById("new-chat");
const promptButtons = document.querySelectorAll("[data-prompt]");
const chatBadgeText = document.getElementById("chat-badge-text");
const statusDot = document.querySelector(".status-dot");
const recentChatsList = document.getElementById("recent-chats");
const chatView = document.getElementById("chat-view");
const knowledgeManagerView = document.getElementById("knowledge-manager-view");
const knowledgeManagerLink = document.getElementById("knowledge-manager-link");
const knowledgeBackChatButton = document.getElementById("knowledge-back-chat");
const knowledgeToggleButton = document.getElementById("knowledge-toggle");
const knowledgePanel = document.getElementById("knowledge-panel");
const knowledgeBaseSelect = document.getElementById("knowledge-base-select");
const knowledgeBaseNameInput = document.getElementById("knowledge-base-name");
const knowledgeFileInput = document.getElementById("knowledge-file");
const knowledgeUploadButton = document.getElementById("knowledge-upload-btn");
const knowledgePreview = document.getElementById("knowledge-preview");
const knowledgeDashboard = document.getElementById("knowledge-dashboard");
const knowledgeOverlay = document.getElementById("knowledge-overlay");
const knowledgeDrawer = document.getElementById("knowledge-drawer");
const knowledgeDrawerTitle = document.getElementById("knowledge-drawer-title");
const knowledgeDrawerContent = document.getElementById("knowledge-drawer-content");
const knowledgeDrawerClose = document.getElementById("knowledge-drawer-close");
const toastRoot = document.getElementById("toast-root");
const appDialogRoot = document.getElementById("app-dialog-root");

const history = [];
let readinessMessage = null;
let currentSessionId = null;
let recentSessions = [];
let knowledgeBases = [];
let knowledgeDocumentsCache = new Map();
let expandedKnowledgeBaseIds = new Set();
let activeKnowledgeDocumentId = "";
let knowledgeDrawerRequestId = 0;
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

function toastTitle(type) {
  const titles = {
    success: "操作成功",
    warning: "需要处理",
    error: "操作失败",
    info: "提示",
  };
  return titles[type] || titles.info;
}

function showToast(message, type = "info", title = "") {
  if (!toastRoot) return;

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;

  const heading = document.createElement("strong");
  heading.textContent = title || toastTitle(type);
  toast.appendChild(heading);

  const body = document.createElement("span");
  body.textContent = String(message || "");
  toast.appendChild(body);

  toastRoot.appendChild(toast);
  window.setTimeout(() => {
    toast.remove();
  }, type === "error" ? 5200 : 3200);
}

function clearDialog() {
  if (!appDialogRoot) return;
  appDialogRoot.innerHTML = "";
  appDialogRoot.hidden = true;
}

function openDialog(options = {}) {
  if (!appDialogRoot) {
    return Promise.resolve(null);
  }

  clearDialog();
  appDialogRoot.hidden = false;

  const dialog = document.createElement("section");
  dialog.className = "app-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");

  const title = document.createElement("h2");
  title.textContent = options.title || "确认操作";
  dialog.appendChild(title);

  if (options.message) {
    const message = document.createElement("p");
    message.textContent = options.message;
    dialog.appendChild(message);
  }

  let input = null;
  if (options.input) {
    input = document.createElement("input");
    input.type = "text";
    input.value = options.initialValue || "";
    input.placeholder = options.placeholder || "";
    dialog.appendChild(input);
  }

  const error = document.createElement("div");
  error.className = "app-dialog-error";
  dialog.appendChild(error);

  const actions = document.createElement("div");
  actions.className = "app-dialog-actions";

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "app-dialog-cancel";
  cancelButton.textContent = options.cancelText || "取消";
  actions.appendChild(cancelButton);

  const confirmButton = document.createElement("button");
  confirmButton.type = "button";
  confirmButton.className = `app-dialog-confirm${options.danger ? " danger" : ""}`;
  confirmButton.textContent = options.confirmText || "确认";
  actions.appendChild(confirmButton);

  dialog.appendChild(actions);
  appDialogRoot.appendChild(dialog);

  return new Promise((resolve) => {
    let resolved = false;

    const finish = (value) => {
      if (resolved) return;
      resolved = true;
      document.removeEventListener("keydown", handleKeydown, true);
      appDialogRoot.removeEventListener("pointerdown", handleBackdrop);
      clearDialog();
      resolve(value);
    };

    const confirm = () => {
      if (!input) {
        finish(true);
        return;
      }
      const value = input.value.trim();
      if (options.required && !value) {
        error.textContent = options.requiredMessage || "内容不能为空。";
        input.focus();
        return;
      }
      finish(value);
    };

    const handleKeydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finish(null);
      }
      if (event.key === "Enter" && input && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        confirm();
      }
    };

    const handleBackdrop = (event) => {
      if (event.target === appDialogRoot) {
        finish(null);
      }
    };

    cancelButton.addEventListener("click", () => finish(null));
    confirmButton.addEventListener("click", confirm);
    appDialogRoot.addEventListener("pointerdown", handleBackdrop);
    document.addEventListener("keydown", handleKeydown, true);

    window.setTimeout(() => {
      if (input) {
        input.focus();
        input.select();
      } else {
        confirmButton.focus();
      }
    }, 0);
  });
}

function promptDialog(options = {}) {
  return openDialog({ ...options, input: true, confirmText: options.confirmText || "保存" });
}

function confirmDialog(options = {}) {
  return openDialog({ ...options, confirmText: options.confirmText || "确认" });
}

function showWorkspaceView(view) {
  const showKnowledge = view === "knowledge";
  if (chatView) {
    chatView.hidden = showKnowledge;
  }
  if (knowledgeManagerView) {
    knowledgeManagerView.hidden = !showKnowledge;
  }
  if (knowledgeManagerLink) {
    knowledgeManagerLink.classList.toggle("active", showKnowledge);
  }
  if (showKnowledge) {
    loadKnowledgeBases();
  } else {
    closeKnowledgeDrawer();
  }
}

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

function formatErrorLabel(errorText, errorType = "", errorMessage = "") {
  const labels = {
    model_config: "模型配置",
    model_request: "模型请求",
    retrieval: "知识检索",
    storage: "会话存储",
    unknown: "系统异常",
  };
  const label = labels[errorType] || "错误";
  const message = String(errorMessage || errorText || "").trim();
  return message ? `${label}：${message}` : label;
}

function appendErrorMeta(messageEl, errorText, errorType = "", errorMessage = "") {
  if (!errorText && !errorMessage && !errorType) return;

  let meta = messageEl.querySelector(".message-meta");
  if (!meta) {
    meta = document.createElement("div");
    meta.className = "message-meta";
    messageEl.appendChild(meta);
  }

  const errorPill = document.createElement("span");
  errorPill.className = "meta-pill";
  errorPill.textContent = formatErrorLabel(errorText, errorType, errorMessage);
  if (errorText) {
    errorPill.title = String(errorText);
  }
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

function formatKnowledgeTime(value) {
  if (!value) return "暂无更新";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "暂无更新";
  return date.toLocaleString("zh-CN", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatKnowledgeDate(value) {
  if (!value) return "暂无";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "暂无";
  return date.toLocaleDateString("zh-CN", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
  });
}

function formatCompactCount(value) {
  const number = Number(value) || 0;
  if (number >= 10000) {
    return `${(number / 10000).toFixed(number >= 100000 ? 0 : 1)}w`;
  }
  return String(number);
}

function normalizeKnowledgeDocument(doc = {}) {
  const chunkCount = Number(doc.chunk_count || 0);
  return {
    id: String(doc.id || ""),
    title: String(doc.title || doc.filename || "未命名文档"),
    filename: String(doc.filename || doc.title || "未命名文档"),
    knowledge_base_id: String(doc.knowledge_base_id || ""),
    knowledge_base_name: String(doc.knowledge_base_name || ""),
    created_at: String(doc.created_at || ""),
    updated_at: String(doc.updated_at || ""),
    chunk_count: chunkCount,
    status: String(doc.status || (chunkCount > 0 ? "已入库" : "待完善")),
    summary: String(doc.summary || ""),
    text: String(doc.text || ""),
    preview_chunks: Array.isArray(doc.preview_chunks) ? doc.preview_chunks : [],
    source_type: String(doc.source_type || ""),
    mime_type: String(doc.mime_type || ""),
  };
}

function getKnowledgeDocuments(kbId) {
  return knowledgeDocumentsCache.get(String(kbId || "")) || [];
}

function findKnowledgeDocListContainer(kbId) {
  const safeId = String(kbId || "").replace(/"/g, '\\"');
  return document.querySelector(`[data-doc-list-for="${safeId}"]`);
}

async function refreshExpandedKnowledgeDocuments({ force = true } = {}) {
  const ids = [...expandedKnowledgeBaseIds].filter(Boolean);
  for (const kbId of ids) {
    const documents = await loadKnowledgeBaseDocuments(kbId, { force });
    renderKnowledgeBaseDocuments(kbId, documents, false);
  }
}

async function parseJsonError(response) {
  try {
    const data = await response.json();
    return data?.detail || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(await parseJsonError(response));
  }
  return response.json();
}

function setKnowledgeDrawerVisible(visible) {
  const isVisible = Boolean(visible);
  if (knowledgeDrawer) {
    knowledgeDrawer.hidden = !isVisible;
    knowledgeDrawer.setAttribute("aria-hidden", String(!isVisible));
    knowledgeDrawer.style.display = isVisible ? "flex" : "none";
  }
  if (knowledgeOverlay) {
    knowledgeOverlay.hidden = !isVisible;
    knowledgeOverlay.style.display = isVisible ? "block" : "none";
  }
}

function closeKnowledgeDrawer() {
  knowledgeDrawerRequestId += 1;
  activeKnowledgeDocumentId = "";
  if (knowledgeDrawerContent) {
    knowledgeDrawerContent.innerHTML = '<div class="knowledge-drawer-empty">请选择一个文档查看详情。</div>';
  }
  setKnowledgeDrawerVisible(false);
}

function renderKnowledgeDrawerDocument(doc = {}) {
  if (!knowledgeDrawerContent || !knowledgeDrawerTitle) return;

  const detail = normalizeKnowledgeDocument(doc);
  knowledgeDrawerTitle.textContent = detail.title || "文档详情";
  knowledgeDrawerContent.innerHTML = "";

  const metaGrid = document.createElement("div");
  metaGrid.className = "knowledge-drawer-meta-grid";

  const metaItems = [
    { label: "所属知识库", value: detail.knowledge_base_name || "暂无数据" },
    { label: "上传时间", value: formatKnowledgeTime(detail.created_at || detail.updated_at) },
    { label: "更新时间", value: formatKnowledgeTime(detail.updated_at || detail.created_at) },
    { label: "切块数量", value: detail.chunk_count > 0 ? `${detail.chunk_count} 块` : "暂无数据" },
    { label: "入库状态", value: detail.status || "暂无数据" },
  ];

  metaItems.forEach((item) => {
    const box = document.createElement("div");
    box.className = "knowledge-drawer-meta-item";

    const label = document.createElement("span");
    label.textContent = item.label;
    box.appendChild(label);

    const value = document.createElement("strong");
    value.textContent = item.value || "暂无数据";
    box.appendChild(value);

    metaGrid.appendChild(box);
  });
  knowledgeDrawerContent.appendChild(metaGrid);

  const drawerToolbar = document.createElement("div");
  drawerToolbar.className = "knowledge-drawer-toolbar";

  const editToggleButton = document.createElement("button");
  editToggleButton.type = "button";
  editToggleButton.className = "secondary-action-button";
  editToggleButton.textContent = "编辑文档";
  drawerToolbar.appendChild(editToggleButton);

  if (detail.source_type !== "seed") {
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "secondary-action-button danger-action-button";
    deleteButton.textContent = "删除文档";
    deleteButton.addEventListener("click", () => {
      deleteKnowledgeDocument(detail);
    });
    drawerToolbar.appendChild(deleteButton);
  }

  knowledgeDrawerContent.appendChild(drawerToolbar);

  let editSection = null;

  editToggleButton.addEventListener("click", () => {
    if (editSection) {
      editSection.remove();
      editSection = null;
      editToggleButton.textContent = "编辑文档";
      return;
    }

    editSection = document.createElement("section");
    editSection.className = "knowledge-drawer-section knowledge-drawer-edit";
    const editTitle = document.createElement("h3");
    editTitle.textContent = "编辑文档";
    editSection.appendChild(editTitle);

    const titleInput = document.createElement("input");
    titleInput.className = "knowledge-drawer-input";
    titleInput.type = "text";
    titleInput.value = detail.title || "";
    titleInput.placeholder = "文档标题";
    editSection.appendChild(titleInput);

    const textInput = document.createElement("textarea");
    textInput.className = "knowledge-drawer-textarea";
    textInput.rows = 10;
    textInput.value = detail.text || "";
    textInput.placeholder = "文档正文";
    editSection.appendChild(textInput);

    const editActions = document.createElement("div");
    editActions.className = "knowledge-drawer-actions";

    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.className = "primary-action-button";
    saveButton.textContent = "保存并重建索引";
    saveButton.addEventListener("click", () => {
      updateKnowledgeDocument(detail, {
        title: titleInput.value,
        text: textInput.value,
      });
    });
    editActions.appendChild(saveButton);

    editSection.appendChild(editActions);
    drawerToolbar.insertAdjacentElement("afterend", editSection);
    editToggleButton.textContent = "收起编辑";
  });

  const summarySection = document.createElement("section");
  summarySection.className = "knowledge-drawer-section";
  const summaryTitle = document.createElement("h3");
  summaryTitle.textContent = "文档摘要";
  summarySection.appendChild(summaryTitle);
  const summary = document.createElement("p");
  summary.className = "knowledge-drawer-summary";
  summary.textContent = detail.summary || "暂无数据";
  summarySection.appendChild(summary);
  knowledgeDrawerContent.appendChild(summarySection);

  const previewSection = document.createElement("section");
  previewSection.className = "knowledge-drawer-section";
  const previewTitle = document.createElement("h3");
  previewTitle.textContent = "分段 / 切块预览";
  previewSection.appendChild(previewTitle);

  const previewList = document.createElement("div");
  previewList.className = "knowledge-drawer-preview-list";
  const previewChunks = Array.isArray(detail.preview_chunks) ? detail.preview_chunks : [];

  if (!previewChunks.length) {
    const empty = document.createElement("div");
    empty.className = "knowledge-drawer-empty";
    empty.textContent = "暂无数据";
    previewList.appendChild(empty);
  } else {
    previewChunks.forEach((chunk, index) => {
      const card = document.createElement("article");
      card.className = "knowledge-drawer-preview-card";

      const heading = document.createElement("div");
      heading.className = "knowledge-drawer-preview-heading";
      const label = document.createElement("strong");
      label.textContent = chunk.location || `切块 ${index + 1}`;
      heading.appendChild(label);
      const source = document.createElement("span");
      source.textContent = chunk.source || detail.title || "暂无数据";
      heading.appendChild(source);
      card.appendChild(heading);

      const text = document.createElement("p");
      text.textContent = chunk.text || "暂无数据";
      card.appendChild(text);

      previewList.appendChild(card);
    });
  }

  previewSection.appendChild(previewList);
  knowledgeDrawerContent.appendChild(previewSection);
  setKnowledgeDrawerVisible(true);
}

async function fetchKnowledgeDocumentDetail(documentId, fallbackDocument = null) {
  const requestId = ++knowledgeDrawerRequestId;
  if (!documentId) {
    if (fallbackDocument) {
      renderKnowledgeDrawerDocument(fallbackDocument);
    }
    return;
  }

  try {
    const data = await requestJson(`/api/knowledge-documents/${encodeURIComponent(documentId)}`);
    if (requestId !== knowledgeDrawerRequestId) return;
    if (data?.document) {
      renderKnowledgeDrawerDocument(data.document);
      return;
    }
    throw new Error("文档不存在");
  } catch (error) {
    if (requestId !== knowledgeDrawerRequestId) return;
    if (fallbackDocument) {
      renderKnowledgeDrawerDocument(fallbackDocument);
      return;
    }
    if (knowledgeDrawerContent) {
      knowledgeDrawerContent.innerHTML = `<div class="knowledge-drawer-empty">文档详情加载失败：${String(error)}</div>`;
    }
    setKnowledgeDrawerVisible(true);
  }
}

async function loadKnowledgeBaseDocuments(kbId, { force = false } = {}) {
  const id = String(kbId || "");
  if (!id) return [];
  if (!force && knowledgeDocumentsCache.has(id)) {
    return knowledgeDocumentsCache.get(id) || [];
  }

  try {
    const data = await requestJson(`/api/knowledge-bases/${encodeURIComponent(id)}/documents`);
    const documents = Array.isArray(data.documents) ? data.documents.map(normalizeKnowledgeDocument) : [];
    knowledgeDocumentsCache.set(id, documents);
    return documents;
  } catch (error) {
    console.error("Failed to load knowledge base documents:", error);
    return knowledgeDocumentsCache.get(id) || [];
  }
}

function renderKnowledgeBaseDocuments(kbId, documents = [], loading = false) {
  const container = findKnowledgeDocListContainer(kbId);
  if (!container) return;

  const list = Array.isArray(documents) ? documents : [];
  container.innerHTML = "";

  if (loading) {
    const loadingEl = document.createElement("div");
    loadingEl.className = "knowledge-docs-empty";
    loadingEl.textContent = "正在加载文档列表...";
    container.appendChild(loadingEl);
    return;
  }

  if (!list.length) {
    const empty = document.createElement("div");
    empty.className = "knowledge-docs-empty";
    empty.textContent = "暂无文档";
    container.appendChild(empty);
    return;
  }

  list.forEach((doc) => {
    const item = document.createElement("article");
    item.className = "knowledge-doc-item";
    item.dataset.documentId = doc.id || "";
    item.dataset.kbId = String(kbId || "");
    item.tabIndex = 0;
    item.setAttribute("role", "button");

    const top = document.createElement("div");
    top.className = "knowledge-doc-item-top";
    const title = document.createElement("strong");
    title.textContent = doc.title || doc.filename || "未命名文档";
    top.appendChild(title);
    const status = document.createElement("span");
    status.className = "knowledge-doc-status";
    status.textContent = doc.status || "已入库";
    top.appendChild(status);
    item.appendChild(top);

    const meta = document.createElement("div");
    meta.className = "knowledge-doc-item-meta";
    const metaParts = [
      doc.knowledge_base_name || "暂无数据",
      formatKnowledgeTime(doc.updated_at || doc.created_at),
      doc.chunk_count > 0 ? `${doc.chunk_count} 切块` : "暂无切块",
    ].filter(Boolean);
    meta.textContent = metaParts.join(" · ");
    item.appendChild(meta);

    if (doc.summary) {
      const summary = document.createElement("p");
      summary.className = "knowledge-doc-item-summary";
      summary.textContent = doc.summary;
      item.appendChild(summary);
    }

    const actions = document.createElement("div");
    actions.className = "knowledge-doc-actions";

    const viewButton = document.createElement("button");
    viewButton.type = "button";
    viewButton.className = "knowledge-action-button";
    viewButton.textContent = "查看";
    viewButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      activeKnowledgeDocumentId = doc.id || "";
      fetchKnowledgeDocumentDetail(doc.id, doc);
    });
    actions.appendChild(viewButton);

    const renameButton = document.createElement("button");
    renameButton.type = "button";
    renameButton.className = "knowledge-action-button";
    renameButton.textContent = "重命名";
    renameButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      renameKnowledgeDocument(doc);
    });
    actions.appendChild(renameButton);

    if (doc.source_type !== "seed") {
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "knowledge-action-button danger";
      deleteButton.textContent = "删除";
      deleteButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        deleteKnowledgeDocument(doc);
      });
      actions.appendChild(deleteButton);
    }

    item.appendChild(actions);

    item.addEventListener("click", (event) => {
      event.stopPropagation();
      activeKnowledgeDocumentId = doc.id || "";
      fetchKnowledgeDocumentDetail(doc.id, doc);
    });

    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        activeKnowledgeDocumentId = doc.id || "";
        fetchKnowledgeDocumentDetail(doc.id, doc);
      }
    });

    container.appendChild(item);
  });
}

async function refreshKnowledgeState(selectedKbId = "") {
  try {
    const data = await requestJson("/api/knowledge-bases");
    knowledgeBases = Array.isArray(data.knowledge_bases) ? data.knowledge_bases : [];
    knowledgeDocumentsCache.clear();
    renderKnowledgeBaseOptions(String(selectedKbId || data.default_knowledge_base_id || knowledgeBases[0]?.id || ""));
    renderKnowledgeDashboard(knowledgeBases);
    await refreshExpandedKnowledgeDocuments({ force: true });
  } catch (error) {
    showToast(`刷新知识库失败：${error}`, "error");
  }
}

async function renameKnowledgeDocument(doc) {
  const documentId = String(doc?.id || "");
  if (!documentId) return;

  const nextTitle = await promptDialog({
    title: "重命名文档",
    message: "为这个文档设置一个更容易识别的标题。",
    initialValue: doc.title || doc.filename || "未命名文档",
    placeholder: "文档标题",
    required: true,
    requiredMessage: "文档标题不能为空。",
  });
  if (nextTitle === null) return;
  const title = nextTitle.trim();

  try {
    const data = await requestJson(`/api/knowledge-documents/${encodeURIComponent(documentId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (Array.isArray(data.knowledge_bases)) {
      knowledgeBases = data.knowledge_bases;
      knowledgeDocumentsCache.delete(String(doc.knowledge_base_id || ""));
      renderKnowledgeDashboard(knowledgeBases);
      await refreshExpandedKnowledgeDocuments({ force: true });
    } else {
      await refreshKnowledgeState(doc.knowledge_base_id || "");
    }
    if (activeKnowledgeDocumentId === documentId) {
      fetchKnowledgeDocumentDetail(documentId, data.document || doc);
    }
    showToast("文档标题已更新。", "success");
  } catch (error) {
    showToast(`重命名文档失败：${error}`, "error");
  }
}

async function updateKnowledgeDocument(doc, values) {
  const documentId = String(doc?.id || "");
  if (!documentId) return;

  const title = String(values?.title || "").trim();
  const text = String(values?.text || "").trim();
  if (!title) {
    showToast("文档标题不能为空。", "warning");
    return;
  }
  if (!text) {
    showToast("文档正文不能为空。", "warning");
    return;
  }

  try {
    const data = await requestJson(`/api/knowledge-documents/${encodeURIComponent(documentId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, text }),
    });
    knowledgeBases = Array.isArray(data.knowledge_bases) ? data.knowledge_bases : knowledgeBases;
    const kbId = String(data.document?.knowledge_base_id || doc.knowledge_base_id || "");
    knowledgeDocumentsCache.delete(kbId);
    renderKnowledgeBaseOptions(kbId);
    renderKnowledgeDashboard(knowledgeBases);
    await refreshExpandedKnowledgeDocuments({ force: true });
    if (data.document) {
      activeKnowledgeDocumentId = String(data.document.id || documentId);
      renderKnowledgeDrawerDocument(data.document);
    }
    showToast("文档已保存，索引已重建。", "success");
  } catch (error) {
    showToast(`保存文档失败：${error}`, "error");
  }
}

async function deleteKnowledgeDocument(doc) {
  const documentId = String(doc?.id || "");
  if (!documentId) return;

  const title = doc.title || doc.filename || "该文档";
  const confirmed = await confirmDialog({
    title: "删除文档",
    message: `确认删除「${title}」吗？删除后会从检索索引中移除。`,
    confirmText: "删除",
    danger: true,
  });
  if (!confirmed) {
    return;
  }

  try {
    const data = await requestJson(`/api/knowledge-documents/${encodeURIComponent(documentId)}`, {
      method: "DELETE",
    });
    if (activeKnowledgeDocumentId === documentId) {
      closeKnowledgeDrawer();
    }
    knowledgeBases = Array.isArray(data.knowledge_bases) ? data.knowledge_bases : knowledgeBases;
    const kbId = String(data.knowledge_base_id || doc.knowledge_base_id || "");
    knowledgeDocumentsCache.delete(kbId);
    renderKnowledgeBaseOptions(kbId);
    renderKnowledgeDashboard(knowledgeBases);
    await refreshExpandedKnowledgeDocuments({ force: true });
    showToast("文档已删除，索引已更新。", "success");
  } catch (error) {
    showToast(`删除文档失败：${error}`, "error");
  }
}

async function renameKnowledgeBase(kb) {
  const kbId = String(kb?.id || "");
  if (!kbId) return;

  const nextName = await promptDialog({
    title: "重命名知识库",
    message: "知识库名称会同步显示在引用和文档列表中。",
    initialValue: kb.name || "未命名知识库",
    placeholder: "知识库名称",
    required: true,
    requiredMessage: "知识库名称不能为空。",
  });
  if (nextName === null) return;
  const name = nextName.trim();

  try {
    const data = await requestJson(`/api/knowledge-bases/${encodeURIComponent(kbId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    knowledgeBases = Array.isArray(data.knowledge_bases) ? data.knowledge_bases : knowledgeBases;
    knowledgeDocumentsCache.delete(kbId);
    renderKnowledgeBaseOptions(kbId);
    renderKnowledgeDashboard(knowledgeBases);
    if (expandedKnowledgeBaseIds.has(kbId)) {
      const documents = await loadKnowledgeBaseDocuments(kbId, { force: true });
      renderKnowledgeBaseDocuments(kbId, documents, false);
    }
    showToast("知识库名称已更新。", "success");
  } catch (error) {
    showToast(`重命名知识库失败：${error}`, "error");
  }
}

async function deleteKnowledgeBase(kb) {
  const kbId = String(kb?.id || "");
  if (!kbId) return;

  const name = kb.name || "该知识库";
  const count = Number(kb.document_count || 0);
  const confirmed = await confirmDialog({
    title: "删除知识库",
    message: `确认删除「${name}」吗？其中 ${count} 个文档会一并从索引中移除。`,
    confirmText: "删除",
    danger: true,
  });
  if (!confirmed) {
    return;
  }

  try {
    const data = await requestJson(`/api/knowledge-bases/${encodeURIComponent(kbId)}`, {
      method: "DELETE",
    });
    expandedKnowledgeBaseIds.delete(kbId);
    knowledgeDocumentsCache.delete(kbId);
    knowledgeBases = Array.isArray(data.knowledge_bases) ? data.knowledge_bases : knowledgeBases.filter((item) => item.id !== kbId);
    renderKnowledgeBaseOptions(String(data.default_knowledge_base_id || knowledgeBases[0]?.id || ""));
    renderKnowledgeDashboard(knowledgeBases);
    closeKnowledgeDrawer();
    showToast("知识库已删除。", "success");
  } catch (error) {
    showToast(`删除知识库失败：${error}`, "error");
  }
}

async function toggleKnowledgeBaseDocuments(kbId) {
  const id = String(kbId || "");
  if (!id) return;

  if (expandedKnowledgeBaseIds.has(id)) {
    expandedKnowledgeBaseIds.delete(id);
    renderKnowledgeDashboard(knowledgeBases);
    return;
  }

  expandedKnowledgeBaseIds.add(id);
  renderKnowledgeDashboard(knowledgeBases);
  if (!knowledgeDocumentsCache.has(id)) {
    renderKnowledgeBaseDocuments(id, [], true);
  }

  const documents = await loadKnowledgeBaseDocuments(id);
  if (!expandedKnowledgeBaseIds.has(id)) return;
  renderKnowledgeBaseDocuments(id, documents, false);
}

function renderKnowledgeDashboard(knowledgeBases = []) {
  if (!knowledgeDashboard) return;

  const list = Array.isArray(knowledgeBases) ? knowledgeBases : [];
  const totalKnowledgeBases = list.length;
  const totalDocuments = list.reduce((sum, item) => sum + Number(item?.document_count || 0), 0);
  const totalChunks = list.reduce((sum, item) => sum + Number(item?.chunk_count || 0), 0);
  const latestUpdate = list.reduce((latest, item) => {
    const updatedAt = String(item?.updated_at || "");
    if (!updatedAt) return latest;
    if (!latest) return updatedAt;
    return updatedAt > latest ? updatedAt : latest;
  }, "");
  const maxDocuments = Math.max(1, ...list.map((item) => Number(item?.document_count || 0)));
  const maxChunks = Math.max(1, ...list.map((item) => Number(item?.chunk_count || 0)));

  knowledgeDashboard.innerHTML = "";
  knowledgeDashboard.classList.toggle("knowledge-dashboard-empty", !list.length);

  if (!list.length) {
    expandedKnowledgeBaseIds.clear();
    const empty = document.createElement("div");
    empty.className = "knowledge-dashboard-empty-state";
    empty.textContent = "暂无知识库数据，上传文档后会在这里显示总览。";
    knowledgeDashboard.appendChild(empty);
    return;
  }

  const header = document.createElement("div");
  header.className = "knowledge-dashboard-header";
  const title = document.createElement("div");
  title.className = "knowledge-dashboard-title";
  title.innerHTML = "<strong>知识库总览</strong><span>文档、切块和更新时间一眼可见</span>";
  header.appendChild(title);
  const update = document.createElement("div");
  update.className = "knowledge-dashboard-update";
  update.textContent = `最近更新：${formatKnowledgeTime(latestUpdate)}`;
  header.appendChild(update);
  knowledgeDashboard.appendChild(header);

  const metrics = document.createElement("div");
  metrics.className = "knowledge-dashboard-metrics";
  [
    { label: "知识库", value: totalKnowledgeBases },
    { label: "文档", value: totalDocuments },
    { label: "切块", value: totalChunks },
    { label: "最新", value: formatKnowledgeDate(latestUpdate) },
  ].forEach((item) => {
    const card = document.createElement("div");
    card.className = "knowledge-metric-card";
    const label = document.createElement("span");
    label.className = "knowledge-metric-label";
    label.textContent = item.label;
    card.appendChild(label);
    const value = document.createElement("strong");
    value.className = "knowledge-metric-value";
    value.textContent = typeof item.value === "number" ? formatCompactCount(item.value) : String(item.value);
    card.appendChild(value);
    metrics.appendChild(card);
  });
  knowledgeDashboard.appendChild(metrics);

  const listEl = document.createElement("div");
  listEl.className = "knowledge-dashboard-list";
  const visibleKnowledgeBaseIds = new Set(list.map((item) => String(item.id || "")).filter(Boolean));
  expandedKnowledgeBaseIds.forEach((id) => {
    if (!visibleKnowledgeBaseIds.has(id)) {
      expandedKnowledgeBaseIds.delete(id);
    }
  });

  list.forEach((item) => {
    const kbId = String(item.id || "");
    const isExpanded = expandedKnowledgeBaseIds.has(kbId);
    const card = document.createElement("article");
    card.className = `knowledge-dashboard-item${isExpanded ? " expanded" : ""}`;
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-expanded", String(isExpanded));
    card.dataset.kbId = kbId;

    const top = document.createElement("div");
    top.className = "knowledge-dashboard-item-top";
    const nameWrap = document.createElement("div");
    nameWrap.className = "knowledge-dashboard-name-wrap";
    const name = document.createElement("strong");
    name.textContent = item.name || "未命名知识库";
    nameWrap.appendChild(name);
    const inlineRenameButton = document.createElement("button");
    inlineRenameButton.type = "button";
    inlineRenameButton.className = "knowledge-inline-action";
    inlineRenameButton.textContent = "修改名称";
    inlineRenameButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      renameKnowledgeBase(item);
    });
    nameWrap.appendChild(inlineRenameButton);
    top.appendChild(nameWrap);
    const kind = document.createElement("span");
    kind.className = "knowledge-dashboard-kind";
    kind.textContent = item.kind === "builtin" ? "内置" : "自定义";
    top.appendChild(kind);
    card.appendChild(top);

    if (item.kind !== "builtin") {
      const actions = document.createElement("div");
      actions.className = "knowledge-kb-actions";

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "knowledge-action-button danger";
      deleteButton.textContent = "删除";
      deleteButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        deleteKnowledgeBase(item);
      });
      actions.appendChild(deleteButton);

      card.appendChild(actions);
    }

    const meta = document.createElement("div");
    meta.className = "knowledge-dashboard-item-meta";
    meta.textContent = `${item.document_count || 0} 文档 · ${item.chunk_count || 0} 切块`;
    card.appendChild(meta);

    const bars = document.createElement("div");
    bars.className = "knowledge-dashboard-bars";

    const docBar = document.createElement("div");
    docBar.className = "knowledge-dashboard-bar-row";
    docBar.innerHTML = `
      <span>文档</span>
      <div class="knowledge-dashboard-bar-track"><span class="knowledge-dashboard-bar-fill"></span></div>
      <strong>${formatCompactCount(item.document_count || 0)}</strong>
    `;
    const docFill = docBar.querySelector(".knowledge-dashboard-bar-fill");
    if (docFill) {
      docFill.style.width = `${Math.max(8, Math.round(((Number(item.document_count || 0) / maxDocuments) || 0) * 100))}%`;
    }
    bars.appendChild(docBar);

    const chunkBar = document.createElement("div");
    chunkBar.className = "knowledge-dashboard-bar-row";
    chunkBar.innerHTML = `
      <span>切块</span>
      <div class="knowledge-dashboard-bar-track"><span class="knowledge-dashboard-bar-fill chunk"></span></div>
      <strong>${formatCompactCount(item.chunk_count || 0)}</strong>
    `;
    const chunkFill = chunkBar.querySelector(".knowledge-dashboard-bar-fill");
    if (chunkFill) {
      chunkFill.style.width = `${Math.max(8, Math.round(((Number(item.chunk_count || 0) / maxChunks) || 0) * 100))}%`;
    }
    bars.appendChild(chunkBar);

    card.appendChild(bars);

    const footer = document.createElement("div");
    footer.className = "knowledge-dashboard-item-footer";
    footer.textContent = `更新时间：${formatKnowledgeTime(item.updated_at)}`;
    card.appendChild(footer);

    const docsWrap = document.createElement("div");
    docsWrap.className = "knowledge-dashboard-docs-wrap";
    docsWrap.hidden = !isExpanded;

    const docsHeader = document.createElement("div");
    docsHeader.className = "knowledge-dashboard-docs-header";
    docsHeader.innerHTML = `<strong>文档列表</strong><span>${isExpanded ? "点击文档查看详情" : "展开后可查看"}</span>`;
    docsWrap.appendChild(docsHeader);

    const docsContainer = document.createElement("div");
    docsContainer.className = "knowledge-dashboard-docs";
    docsContainer.dataset.docListFor = kbId;
    docsWrap.appendChild(docsContainer);

    card.appendChild(docsWrap);

    card.addEventListener("click", () => {
      toggleKnowledgeBaseDocuments(kbId);
    });

    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggleKnowledgeBaseDocuments(kbId);
      }
    });

    listEl.appendChild(card);
  });

  knowledgeDashboard.appendChild(listEl);

  expandedKnowledgeBaseIds.forEach((kbId) => {
    const docs = getKnowledgeDocuments(kbId);
    renderKnowledgeBaseDocuments(kbId, docs, !knowledgeDocumentsCache.has(kbId));
    if (!knowledgeDocumentsCache.has(kbId)) {
      renderKnowledgeBaseDocuments(kbId, [], true);
    }
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
    knowledgeToggleButton.textContent = knowledgePanelVisible ? "收起上传" : "添加知识库";
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

function setKnowledgePreviewEmpty(message = "上传 PDF、Word、PPTX、Markdown 或 LaTeX 文档后，会在这里看到摘要和切块预览。") {
  pendingKnowledgeDraft = null;
  if (knowledgeFileInput) {
    knowledgeFileInput.value = "";
  }
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

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "knowledge-cancel-button";
  cancelButton.textContent = "取消上传";
  cancelButton.addEventListener("click", cancelKnowledgeDraft);
  footer.appendChild(cancelButton);

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
    knowledgeDocumentsCache.clear();
    renderKnowledgeBaseOptions(String(data.default_knowledge_base_id || knowledgeBases[0]?.id || ""));
    renderKnowledgeDashboard(knowledgeBases);
  } catch (error) {
    knowledgeBases = [];
    knowledgeDocumentsCache.clear();
    renderKnowledgeBaseOptions();
    renderKnowledgeDashboard([]);
    console.error("Failed to load knowledge bases:", error);
  }
}

async function uploadKnowledgeDocument() {
  if (!knowledgeFileInput || !knowledgeFileInput.files?.length) {
    showToast("先选择一个 PDF、Word、PPTX、Markdown 或 LaTeX 文件。", "warning");
    return;
  }

  const file = knowledgeFileInput.files[0];
  const target = getSelectedKnowledgeBase();
  if (target.kind === "new" && !target.name) {
    showToast("请先输入新知识库名称。", "warning");
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
      knowledgeDocumentsCache.clear();
      const currentTargetId = target.kind === "existing" ? target.id : NEW_KNOWLEDGE_BASE_VALUE;
      renderKnowledgeBaseOptions(currentTargetId);
      renderKnowledgeDashboard(knowledgeBases);
      if (target.kind === "new" && knowledgeBaseNameInput) {
        knowledgeBaseNameInput.value = target.name;
      }
    }
    renderKnowledgePreview(data.draft);
    showToast("文档解析完成，请确认入库。", "success");
  } catch (error) {
    setKnowledgePreviewEmpty(`上传解析失败：${error}`);
    showToast(`上传解析失败：${error}`, "error");
  } finally {
    if (knowledgeUploadButton) knowledgeUploadButton.disabled = false;
  }
}

async function confirmKnowledgeDraft() {
  if (!pendingKnowledgeDraft?.draft_id) {
    showToast("请先上传文档并完成预览。", "warning");
    return;
  }

  const target = getSelectedKnowledgeBase();
  if (target.kind === "new" && !target.name) {
    showToast("请先输入新知识库名称。", "warning");
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
      knowledgeDocumentsCache.clear();
      const selectedId = data.knowledge_base?.id || target.id || "";
      renderKnowledgeBaseOptions(selectedId);
      renderKnowledgeDashboard(knowledgeBases);
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
    showToast("文档已入库，索引已更新。", "success");
  } catch (error) {
    setKnowledgePreviewEmpty(`确认入库失败：${error}`);
    showToast(`确认入库失败：${error}`, "error");
  }
}

async function cancelKnowledgeDraft() {
  const draftId = String(pendingKnowledgeDraft?.draft_id || "");
  if (!draftId) {
    setKnowledgePreviewEmpty();
    return;
  }

  setKnowledgePreviewEmpty("已取消本次上传，你可以重新选择文档。");
  showToast("已取消本次上传。", "success");

  try {
    const response = await fetch("/api/knowledge/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft_id: draftId }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.detail || `HTTP ${response.status}`);
    }
  } catch (error) {
    console.warn("Failed to delete upload draft:", error);
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
      ].slice(0, 10);
      renderRecentChats(recentSessions);
    }
    showToast("会话标题已更新。", "success");
  } catch (error) {
    showToast(`修改标题失败：${error}`, "error");
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

knowledgeManagerLink?.addEventListener("click", () => {
  showWorkspaceView("knowledge");
});

knowledgeBackChatButton?.addEventListener("click", () => {
  showWorkspaceView("chat");
});

knowledgeToggleButton?.addEventListener("click", () => {
  setKnowledgePanelVisible(!knowledgePanelVisible);
});

knowledgeOverlay?.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  event.stopPropagation();
  closeKnowledgeDrawer();
});

knowledgeOverlay?.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  closeKnowledgeDrawer();
});

knowledgeDrawerClose?.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  event.stopPropagation();
  closeKnowledgeDrawer();
});

knowledgeDrawerClose?.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  closeKnowledgeDrawer();
});

document.addEventListener("click", () => {
  hideSessionContextMenu();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    hideSessionContextMenu();
    closeKnowledgeDrawer();
  }
});

window.addEventListener("scroll", hideSessionContextMenu, true);
window.addEventListener("resize", hideSessionContextMenu);

promptButtons.forEach((button) => {
  button.addEventListener("click", () => {
    showWorkspaceView("chat");
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
  showWorkspaceView("chat");
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
      if (payload.error || payload.error_type || payload.error_message) {
        appendErrorMeta(
          assistantMessage,
          String(payload.error || ""),
          String(payload.error_type || ""),
          String(payload.error_message || "")
        );
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
      if (data.error || data.error_type || data.error_message) {
        appendErrorMeta(
          assistantMessage,
          data.error || "",
          data.error_type || "",
          data.error_message || ""
        );
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
