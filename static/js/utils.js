// Generated from script.js - see static/js/ for modular source
const messages = document.getElementById("messages");
const form = document.getElementById("chat-form");
const input = document.getElementById("input");
const newChatButton = document.getElementById("new-chat");
const promptButtons = document.querySelectorAll("[data-prompt]");
const learningTopic = document.getElementById("learning-topic");
const learningPoint = document.getElementById("learning-point");
const learningNextStep = document.getElementById("learning-next-step");
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
const sourcePanel = document.getElementById("source-panel");
const sourcePanelList = document.getElementById("source-panel-list");
const sourcePanelCount = document.getElementById("source-panel-count");
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
let currentHighlightTerms = [];
let connectionState = {
  ready: false,
  text: "正在检查 API 连接...",
  model: "",
};
const NEW_KNOWLEDGE_BASE_VALUE = "__new__";
function escapeHtml(text) {
  const map = {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"};
  return String(text || "").replace(/[&<>"']/g, function(ch) { return map[ch]; });
}

function uniqueStrings(items = []) {
  const result = [];
  const seen = new Set();
  items.forEach((item) => {
    const value = String(item || "").trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    result.push(value);
  });
  return result;
}

function compactDisplayText(text = "", limit = 34) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (!value) return "";
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 1)}…`;
}

function inferLearningTopic(text = "") {
  const value = String(text || "").toLowerCase();
  const topics = [
    ["动态规划", ["动态规划", "dp", "状态转移", "最优子结构"]],
    ["BFS / DFS", ["bfs", "dfs", "广度优先", "深度优先", "图搜索"]],
    ["前缀和", ["前缀和", "区间和", "prefix"]],
    ["二分查找", ["二分", "binary search"]],
    ["贪心算法", ["贪心", "greedy"]],
    ["回溯搜索", ["回溯", "backtracking"]],
    ["最短路", ["最短路", "dijkstra", "bellman", "floyd"]],
    ["并查集", ["并查集", "union find"]],
    ["栈与队列", ["栈", "队列", "stack", "queue"]],
    ["树和递归", ["二叉树", "递归", "tree"]],
    ["排序算法", ["排序", "sort", "快排", "归并"]],
    ["复杂度分析", ["复杂度", "时间复杂度", "空间复杂度"]],
  ];

  const matched = topics.find(([, keywords]) => keywords.some((keyword) => value.includes(keyword)));
  return matched ? matched[0] : "";
}
function nextStepForTopic(topic = "") {
  if (topic.includes("动态规划")) return "确认状态定义、转移方程和边界条件";
  if (topic.includes("BFS") || topic.includes("DFS")) return "用一个小图手动走一遍遍历过程";
  if (topic.includes("前缀和")) return "尝试把区间查询改成一次预处理";
  if (topic.includes("二分")) return "明确单调条件和左右边界更新";
  if (topic.includes("贪心")) return "补一个交换论证或反例检查";
  if (topic.includes("回溯")) return "画出选择树并确认剪枝条件";
  if (topic.includes("最短路")) return "区分边权场景再选算法";
  if (topic.includes("并查集")) return "练习路径压缩和按秩合并";
  if (topic.includes("复杂度")) return "把循环层数和数据规模对应起来";
  return "继续追问一个例子或让它给练习题";
}

function inferLearningProgress(session = {}, messagesData = []) {
  const messagesList = Array.isArray(messagesData) ? messagesData : [];
  const userMessages = messagesList.filter((message) => message?.role === "user");
  const assistantMessages = messagesList.filter((message) => message?.role === "assistant");
  const latestUser = userMessages[userMessages.length - 1]?.content || "";
  const latestAssistant = assistantMessages[assistantMessages.length - 1]?.content || "";
  const summary = String(session?.summary || "");
  const title = String(session?.title || "");
  const topic = inferLearningTopic(`${latestUser} ${summary} ${title} ${latestAssistant}`) || compactDisplayText(title, 18) || "暂未开始";
  const recentPoint =
    compactDisplayText(latestUser, 38) ||
    compactDisplayText(summary, 38) ||
    "发起一次算法提问后自动更新";

  return {
    topic,
    point: recentPoint,
    nextStep: topic === "暂未开始" ? "选择一个知识点继续追问" : nextStepForTopic(topic),
  };
}

function renderLearningProgress(progress = {}) {
  if (learningTopic) {
    learningTopic.textContent = progress.topic || "暂未开始";
  }
  if (learningPoint) {
    learningPoint.textContent = progress.point || "发起一次算法提问后自动更新";
  }
  if (learningNextStep) {
    learningNextStep.textContent = progress.nextStep || "选择一个知识点继续追问";
  }
}

function currentSessionSummary() {
  if (!currentSessionId) return null;
  return recentSessions.find((session) => session.id === currentSessionId) || null;
}

function updateLearningProgress(session = currentSessionSummary(), messagesData = []) {
  renderLearningProgress(inferLearningProgress(session || {}, messagesData));
}

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
  if (sourcePanel) {
    sourcePanel.hidden = showKnowledge;
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
