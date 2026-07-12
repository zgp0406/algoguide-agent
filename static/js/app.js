// Generated from script.js - see static/js/ for modular source
readinessMessage = appendMessage("assistant", "正在检查 API 连接...");
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
  updateLearningProgress(null, []);
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
  const agentToggle = document.getElementById("agent-mode-toggle");
  const useAgent = agentToggle && agentToggle.checked;
  const endpoint = useAgent ? "/api/chat/agent" : "/api/chat/stream";
  const response = await fetch(endpoint, {
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
  let meta = {
    sources: [],
    usedRag: false,
    knowledgeBase: "",
    ragConfidence: 0,
    retrievalMode: "none",
    lowConfidenceReason: "",
  };
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
        ragConfidence: Number(payload.rag_confidence || 0),
        retrievalMode: String(payload.retrieval_mode || "none"),
        lowConfidenceReason: String(payload.low_confidence_reason || ""),
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

    if (eventName === "think") {
      // Agent 思考过程：在聊天区追加一个半透明思考气泡
      const thinkText = typeof payload.text === "string" ? payload.text : "";
      if (!thinkText) return;
      const thinkEl = document.createElement("div");
      thinkEl.className = "message thinking";
      const thinkContent = document.createElement("div");
      thinkContent.className = "message-content";
      thinkContent.textContent = thinkText;
      thinkEl.appendChild(thinkContent);
      messages.appendChild(thinkEl);
      scrollToBottom();
      return;
    }

    if (eventName === "tool_call") {
      // Agent 调用工具：追加工具调用卡片
      const toolName = String(payload.name || "unknown");
      const toolArgs = payload.arguments || {};
      const card = document.createElement("div");
      card.className = "tool-call-card";
      card.innerHTML = `<div class="tool-call-header">
        <span class="tool-call-icon">&#9881;</span>
        <strong>${escapeHtml(toolName)}</strong>
        <span class="tool-call-badge">执行中...</span>
      </div>
      <div class="tool-call-args"><code>${escapeHtml(JSON.stringify(toolArgs, null, 2))}</code></div>`;
      card.dataset.toolName = toolName;
      messages.appendChild(card);
      scrollToBottom();
      // 保存引用以便 tool_result 更新
      if (!window._pendingToolCards) window._pendingToolCards = {};
      window._pendingToolCards[toolName] = card;
      return;
    }

    if (eventName === "tool_result") {
      // 工具执行结果：更新之前的工具调用卡片
      const toolName = String(payload.name || "unknown");
      const result = payload.result || {};
      const card = (window._pendingToolCards && window._pendingToolCards[toolName]) || null;
      const badge = card ? card.querySelector(".tool-call-badge") : null;
      if (badge) {
        if (result.error) {
          badge.textContent = "失败";
          badge.classList.add("tool-call-badge-error");
        } else {
          badge.textContent = "完成";
          badge.classList.add("tool-call-badge-done");
        }
      }
      // 追加结果摘要
      if (card) {
        const summary = document.createElement("div");
        summary.className = "tool-call-result";
        if (result.error) {
          summary.textContent = `错误: ${result.error}`;
          summary.classList.add("tool-call-result-error");
        } else if (result.count !== undefined) {
          summary.textContent = `找到 ${result.count} 个相关片段`;
        } else if (result.output !== undefined) {
          summary.textContent = result.output.slice(0, 200) + (result.output.length > 200 ? "..." : "");
        } else if (result.found !== undefined) {
          summary.textContent = result.found ? `已找到文档：${result.title || ""}` : "未找到匹配文档";
        }
        card.appendChild(summary);
        delete window._pendingToolCards[toolName];
      }
      scrollToBottom();
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
        String(payload.knowledge_base || meta.knowledgeBase || ""),
        Number(payload.rag_confidence ?? meta.ragConfidence ?? 0),
        String(payload.retrieval_mode || meta.retrievalMode || "none"),
        String(payload.low_confidence_reason || meta.lowConfidenceReason || "")
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
  setHighlightTerms(text);

  appendMessage("user", text);
  history.push({ role: "user", content: text });
  updateLearningProgress(currentSessionSummary(), history);
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
    updateLearningProgress(currentSessionSummary(), history);
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
        ragConfidence: Number(data.rag_confidence || 0),
        retrievalMode: String(data.retrieval_mode || "none"),
        lowConfidenceReason: String(data.low_confidence_reason || ""),
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
      updateLearningProgress(currentSessionSummary(), history);
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
