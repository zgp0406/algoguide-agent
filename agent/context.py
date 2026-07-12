from __future__ import annotations

import os
from time import monotonic

from agent.retriever import retrieve_with_scores
from agent.telemetry import log_event


_DEFAULT_KNOWLEDGE_BASE_NAME = "全库检索"
_SEMANTIC_RAG_THRESHOLD = float(os.getenv("RAG_SEMANTIC_THRESHOLD", "0.30"))
_LEXICAL_RAG_THRESHOLD = float(os.getenv("RAG_LEXICAL_THRESHOLD", "2"))


def _excerpt_text(text: str, limit: int = 160) -> str:
    normalized = " ".join(str(text or "").strip().split())
    if len(normalized) <= limit:
        return normalized
    return f"{normalized[: limit - 1]}…"


def _unique_strings(items: list[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for item in items:
        value = str(item).strip()
        if not value or value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def _knowledge_base_name() -> str:
    return _DEFAULT_KNOWLEDGE_BASE_NAME


def _retrieval_mode(chunks: list[object]) -> str:
    for chunk in chunks:
        mode = str(getattr(chunk, "retrieval_mode", "") or "").strip()
        if mode:
            return mode
    return "none"


def _rag_confidence(chunks: list[object]) -> tuple[float, str, str | None]:
    if not chunks:
        return 0.0, "none", "知识库没有返回候选片段"

    mode = _retrieval_mode(chunks)
    scores: list[float] = []
    for chunk in chunks:
        try:
            scores.append(float(getattr(chunk, "score", 0.0)))
        except Exception:
            pass
    top_score = max(scores) if scores else 0.0

    if mode in {"semantic", "hybrid"}:
        confidence = max(0.0, min(1.0, top_score))
        if top_score < _SEMANTIC_RAG_THRESHOLD:
            return confidence, mode, f"检索相关度 {confidence:.2f} 低于阈值 {_SEMANTIC_RAG_THRESHOLD:.2f}"
        return confidence, mode, None

    if mode == "lexical":
        confidence = max(0.0, min(1.0, top_score / max(_LEXICAL_RAG_THRESHOLD * 2, 1.0)))
        if top_score < _LEXICAL_RAG_THRESHOLD:
            return confidence, mode, f"关键词命中分数 {top_score:.0f} 低于阈值 {_LEXICAL_RAG_THRESHOLD:.0f}"
        return confidence, mode, None

    return 0.0, mode or "none", "无法判断检索模式，未使用知识库片段"


def _format_evidence_items(chunks: list[object]) -> list[dict[str, object]]:
    evidence: list[dict[str, object]] = []
    for chunk in chunks:
        knowledge_base_id = str(getattr(chunk, "knowledge_base_id", "") or "").strip()
        knowledge_base_name = str(getattr(chunk, "knowledge_base_name", "") or "").strip()
        source = str(getattr(chunk, "source", "") or "").strip()
        text = str(getattr(chunk, "text", "") or "").strip()
        location = str(getattr(chunk, "location", "") or "").strip()
        score = getattr(chunk, "score", None)
        retrieval_mode = str(getattr(chunk, "retrieval_mode", "") or "").strip()
        if not source or not text:
            continue
        item: dict[str, object] = {
            "knowledge_base_id": knowledge_base_id,
            "knowledge_base_name": knowledge_base_name or _knowledge_base_name(),
            "source": source,
            "excerpt": _excerpt_text(text),
        }
        if location:
            item["location"] = location
        if score is not None:
            try:
                item["score"] = float(score)
            except Exception:
                pass
        if retrieval_mode:
            item["retrieval_mode"] = retrieval_mode
        evidence.append(item)
    return evidence


def build_context(message: str) -> tuple[str, list[str], list[dict[str, object]], bool, str, float, str, str | None]:
    """检索知识库并构建上下文。

    返回:
        context: 拼接好的上下文字符串
        sources: 去重后的来源文件列表
        evidence: 格式化的证据片段
        used_rag: 是否使用 RAG
        knowledge_base: 知识库名称
        rag_confidence: 检索置信度
        retrieval_mode: 检索模式
        low_confidence_reason: 低置信度原因（None 表示置信度足够）
    """
    started_at = monotonic()
    chunks = retrieve_with_scores(message)
    rag_confidence, retrieval_mode, low_confidence_reason = _rag_confidence(chunks)
    usable_chunks = chunks if low_confidence_reason is None else []
    elapsed_ms = round((monotonic() - started_at) * 1000, 2)
    log_event(
        "retrieval.completed",
        query_length=len(message),
        chunk_count=len(chunks),
        used_rag=bool(usable_chunks),
        rag_confidence=round(rag_confidence, 4),
        retrieval_mode=retrieval_mode,
        low_confidence=bool(low_confidence_reason),
        elapsed_ms=elapsed_ms,
    )
    if not usable_chunks:
        return "", [], [], False, _knowledge_base_name(), rag_confidence, retrieval_mode, low_confidence_reason

    context_lines = []
    sources = []
    for index, chunk in enumerate(usable_chunks, start=1):
        location_text = f" | 位置：{chunk.location}" if getattr(chunk, "location", "") else ""
        context_lines.append(
            f"{index}. 知识库：{chunk.knowledge_base_name or _knowledge_base_name()} | 来源：{chunk.source}{location_text}\n"
            f"   片段：{chunk.text}"
        )
        sources.append(chunk.source)

    context = "\n\n".join(context_lines)
    return (
        context,
        _unique_strings(sources),
        _format_evidence_items(usable_chunks),
        True,
        _knowledge_base_name(),
        rag_confidence,
        retrieval_mode,
        None,
    )
