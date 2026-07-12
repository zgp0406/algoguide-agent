// Generated from script.js - see static/js/ for modular source
function setHighlightTerms(text = "") {
  const normalized = String(text || "").trim();
  const terms = [];
  const latinTerms = normalized.match(/[A-Za-z0-9_]{2,}/g) || [];
  terms.push(...latinTerms);

  const cjkRuns = normalized.match(/[\u4e00-\u9fff]{2,}/g) || [];
  cjkRuns.forEach((run) => {
    if (run.length <= 8) {
      terms.push(run);
    }
    for (let index = 0; index < run.length - 1; index += 1) {
      terms.push(run.slice(index, index + 2));
    }
  });

  currentHighlightTerms = uniqueStrings(terms)
    .filter((term) => term.length >= 2)
    .sort((a, b) => b.length - a.length)
    .slice(0, 24);
}

function highlightTextInto(element, text, terms = currentHighlightTerms) {
  if (!element) return;
  const value = String(text || "");
  element.textContent = "";
  const matches = [];

  terms.forEach((term) => {
    let start = value.indexOf(term);
    while (start !== -1) {
      matches.push({ start, end: start + term.length });
      start = value.indexOf(term, start + term.length);
    }
  });

  matches.sort((a, b) => a.start - b.start || b.end - a.end);
  const ranges = [];
  matches.forEach((match) => {
    const last = ranges[ranges.length - 1];
    if (last && match.start < last.end) return;
    ranges.push(match);
  });

  if (!ranges.length) {
    element.textContent = value;
    return;
  }

  let cursor = 0;
  ranges.forEach((range) => {
    if (range.start > cursor) {
      element.appendChild(document.createTextNode(value.slice(cursor, range.start)));
    }
    const mark = document.createElement("mark");
    mark.className = "hit-highlight";
    mark.textContent = value.slice(range.start, range.end);
    element.appendChild(mark);
    cursor = range.end;
  });
  if (cursor < value.length) {
    element.appendChild(document.createTextNode(value.slice(cursor)));
  }
}
function scrollToBottom() {
  messages.scrollTop = messages.scrollHeight;
}
function retrievalModeLabel(mode = "") {
  const labels = {
    semantic: "语义检索",
    lexical: "关键词检索",
    none: "未检索",
  };
  return labels[mode] || mode || "检索";
}

function createMeta(
  sourceList = [],
  usedRag = false,
  knowledgeBase = "",
  ragConfidence = 0,
  retrievalMode = "none",
  lowConfidenceReason = ""
) {
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
      const confidence = Number(ragConfidence);
      const confidenceText = Number.isFinite(confidence) && confidence > 0 ? ` · ${Math.round(confidence * 100)}%` : "";
      rag.textContent = `已使用知识库 · ${retrievalModeLabel(retrievalMode)}${confidenceText}`;
      meta.appendChild(rag);
    } else {
      kb.textContent = `知识库依据不足 · ${retrievalModeLabel(retrievalMode)}`;
      kb.title = lowConfidenceReason || "知识库已启用，未找到高置信相关内容。本次回答主要基于模型推理。";
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

function appendInlineMarkdown(parent, text = "") {
  const value = String(text || "");
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\$[^$\n]+\$)/g;
  let cursor = 0;
  let match = pattern.exec(value);
  while (match) {
    if (match.index > cursor) {
      parent.appendChild(document.createTextNode(value.slice(cursor, match.index)));
    }
    const token = match[0];
    if (token.startsWith("`")) {
      const code = document.createElement("code");
      code.textContent = token.slice(1, -1);
      parent.appendChild(code);
    } else if (token.startsWith("**")) {
      const strong = document.createElement("strong");
      strong.textContent = token.slice(2, -2);
      parent.appendChild(strong);
    } else {
      const math = document.createElement("span");
      math.className = "math-inline";
      math.textContent = token.slice(1, -1);
      parent.appendChild(math);
    }
    cursor = match.index + token.length;
    match = pattern.exec(value);
  }
  if (cursor < value.length) {
    parent.appendChild(document.createTextNode(value.slice(cursor)));
function isTableSeparator(line = "") {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function splitTableCells(line = "") {
  return String(line)
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function renderMarkdownInto(element, text = "") {
  if (!element) return;
  const value = String(text || "");
  element.dataset.rawText = value;
  element.classList.add("markdown-content");
  element.innerHTML = "";

  const lines = value.replace(/\r\n/g, "\n").split("\n");
  let index = 0;

  const appendParagraph = (paragraphLines) => {
    const paragraphText = paragraphLines.join(" ").trim();
    if (!paragraphText) return;
    const p = document.createElement("p");
    appendInlineMarkdown(p, paragraphText);
    element.appendChild(p);
  };

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const codeLines = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      index += index < lines.length ? 1 : 0;
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.textContent = codeLines.join("\n");
      pre.appendChild(code);
      element.appendChild(pre);
      continue;
    }

    if (trimmed.startsWith("$$")) {
      const mathLines = [trimmed.replace(/^\$\$/, "")];
      index += 1;
      while (index < lines.length && !lines[index].trim().endsWith("$$")) {
        mathLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        mathLines.push(lines[index].trim().replace(/\$\$$/, ""));
        index += 1;
      }
      const math = document.createElement("div");
      math.className = "math-block";
      math.textContent = mathLines.join("\n").trim();
      element.appendChild(math);
      continue;
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (heading) {
      const level = Math.min(heading[1].length + 1, 5);
      const h = document.createElement(`h${level}`);
      appendInlineMarkdown(h, heading[2]);
      element.appendChild(h);
      index += 1;
      continue;
    }

    if (line.includes("|") && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      const table = document.createElement("table");
      const thead = document.createElement("thead");
      const tbody = document.createElement("tbody");
      const headerRow = document.createElement("tr");
      splitTableCells(line).forEach((cell) => {
        const th = document.createElement("th");
        appendInlineMarkdown(th, cell);
        headerRow.appendChild(th);
      });
      thead.appendChild(headerRow);
      table.appendChild(thead);
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        const row = document.createElement("tr");
        splitTableCells(lines[index]).forEach((cell) => {
          const td = document.createElement("td");
          appendInlineMarkdown(td, cell);
          row.appendChild(td);
        });
        tbody.appendChild(row);
        index += 1;
      }
      table.appendChild(tbody);
      element.appendChild(table);
      continue;
    }

    if (/^[-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      const ordered = /^\d+\.\s+/.test(trimmed);
      const list = document.createElement(ordered ? "ol" : "ul");
      while (index < lines.length) {
        const current = lines[index].trim();
        const marker = ordered ? /^\d+\.\s+(.+)$/.exec(current) : /^[-*]\s+(.+)$/.exec(current);
        if (!marker) break;
        const item = document.createElement("li");
        appendInlineMarkdown(item, marker[1]);
        list.appendChild(item);
        index += 1;
      }
      element.appendChild(list);
      continue;
    }

    if (trimmed.startsWith(">")) {
      const quote = document.createElement("blockquote");
      appendInlineMarkdown(quote, trimmed.replace(/^>\s?/, ""));
      element.appendChild(quote);
      index += 1;
      continue;
    }

    const paragraphLines = [trimmed];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !lines[index].trim().startsWith("```") &&
      !/^#{1,4}\s+/.test(lines[index].trim()) &&
      !/^[-*]\s+/.test(lines[index].trim()) &&
      !/^\d+\.\s+/.test(lines[index].trim()) &&
      !(lines[index].includes("|") && index + 1 < lines.length && isTableSeparator(lines[index + 1]))
    ) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }
    appendParagraph(paragraphLines);
  }
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

    const hitLabel = document.createElement("div");
    hitLabel.className = "hit-label";
    hitLabel.textContent = "命中片段";
    card.appendChild(hitLabel);

    const excerpt = document.createElement("p");
    excerpt.className = "evidence-excerpt";
    highlightTextInto(excerpt, item?.excerpt ? String(item.excerpt) : "没有可展示的片段。");
    card.appendChild(excerpt);

    list.appendChild(card);
  });

  details.appendChild(list);
  return details;
}

function clearSourcePanel() {
  if (!sourcePanelList || !sourcePanelCount) return;
  sourcePanelCount.textContent = "0";
  sourcePanelList.innerHTML = "";
  const empty = document.createElement("div");
  empty.className = "source-panel-empty";
  empty.textContent = "提问后会在这里展示知识库命中的文档片段和相关度。";
  sourcePanelList.appendChild(empty);
}

function renderSourcePanel(evidence = []) {
  if (!sourcePanelList || !sourcePanelCount) return;

  const items = Array.isArray(evidence) ? evidence.filter((item) => item && (item.source || item.excerpt)) : [];
  sourcePanelCount.textContent = String(items.length);
  sourcePanelList.innerHTML = "";

  if (!items.length) {
    clearSourcePanel();
    return;
  }

  items.forEach((item, index) => {
    const card = document.createElement("article");
    card.className = "source-card";

    const top = document.createElement("div");
    top.className = "source-card-top";

    const icon = document.createElement("span");
    icon.className = "source-card-icon";
    icon.textContent = String(item.source || "").toLowerCase().endsWith(".pdf") ? "PDF" : "DOC";
    top.appendChild(icon);

    const titleWrap = document.createElement("div");
    titleWrap.className = "source-card-title";

    const title = document.createElement("strong");
    title.textContent = item.source ? String(item.source) : `来源 ${index + 1}`;
    titleWrap.appendChild(title);

    const kb = document.createElement("span");
    kb.textContent = item.knowledge_base_name ? String(item.knowledge_base_name) : "全库检索";
    titleWrap.appendChild(kb);
    top.appendChild(titleWrap);

    card.appendChild(top);

    const score = formatEvidenceScore(Number(item.score));
    if (score) {
      const scoreEl = document.createElement("div");
      scoreEl.className = "source-score";
      scoreEl.textContent = score;
      card.appendChild(scoreEl);
    }

    const excerpt = document.createElement("p");
    excerpt.className = "source-excerpt";
    highlightTextInto(excerpt, item.excerpt ? String(item.excerpt) : "暂无可展示片段。");
    card.appendChild(excerpt);

    if (item.location) {
      const location = document.createElement("div");
      location.className = "source-location";
      location.textContent = String(item.location);
      card.appendChild(location);
    }

    sourcePanelList.appendChild(card);
  });
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
  if (role === "assistant") {
    renderMarkdownInto(content, text);
  } else {
    content.textContent = text;
    content.dataset.rawText = String(text || "");
  }
  el.appendChild(content);

  if (role === "assistant" && (options.sources?.length || options.usedRag || options.knowledgeBase)) {
    el.appendChild(
      createMeta(
        options.sources,
        options.usedRag,
        options.knowledgeBase,
        options.ragConfidence,
        options.retrievalMode,
        options.lowConfidenceReason
      )
    );
  }

  if (role === "assistant" && Array.isArray(options.evidence) && options.evidence.length) {
    el.appendChild(createEvidenceBlock(options.evidence));
    renderSourcePanel(options.evidence);
  }

  messages.appendChild(el);
  scrollToBottom();
  return el;
}

function setMessageText(messageEl, text) {
  const content = messageEl.querySelector(".message-content");
  if (content) {
    if (messageEl.classList.contains("assistant")) {
      renderMarkdownInto(content, text);
    } else {
      content.textContent = text;
      content.dataset.rawText = String(text || "");
    }
  }
}

function appendMessageMeta(
  messageEl,
  sourceList = [],
  usedRag = false,
  knowledgeBase = "",
  ragConfidence = 0,
  retrievalMode = "none",
  lowConfidenceReason = ""
) {
  if (messageEl.querySelector(".message-meta")) {
    return;
  }

  if (sourceList.length || usedRag || knowledgeBase) {
    messageEl.appendChild(
      createMeta(sourceList, usedRag, knowledgeBase, ragConfidence, retrievalMode, lowConfidenceReason)
    );
  }
}

function appendMessageEvidence(messageEl, evidence = []) {
  if (!Array.isArray(evidence) || !evidence.length || messageEl.querySelector(".message-evidence")) {
    return;
  }
  messageEl.appendChild(createEvidenceBlock(evidence));
  renderSourcePanel(evidence);
}
function renderConversation(messagesData = [], includeIntro = false) {
  messages.innerHTML = "";
  clearSourcePanel();
  const latestUserMessage = [...messagesData].reverse().find((message) => message?.role === "user");
  setHighlightTerms(latestUserMessage?.content || "");
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
      ragConfidence: Number(message.rag_confidence || 0),
      retrievalMode: String(message.retrieval_mode || "none"),
      lowConfidenceReason: String(message.low_confidence_reason || ""),
    });
  });
  updateLearningProgress(currentSessionSummary(), messagesData);
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
  ].slice(0, 50);

  renderRecentChats(recentSessions);
  if (currentSessionId === normalized.id) {
    updateLearningProgress(normalized, history);
  }
}
