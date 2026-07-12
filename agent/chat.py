from __future__ import annotations

import json
import os
from collections.abc import Iterator
from time import monotonic
from uuid import uuid4

from pydantic import BaseModel, Field

from agent.backends.base import GenerationRequest
from agent.backends.factory import create_backend
from agent.context import build_context
from agent.env import load_env_file
from agent.sessions import append_turn, get_session, list_sessions, upsert_session_message
from agent.telemetry import classify_error, log_event


load_env_file()


_MAX_RECENT_HISTORY_MESSAGES = 8


class ChatRequest(BaseModel):
    message: str = Field(min_length=1)
    history: list[dict[str, str]] = Field(default_factory=list)
    session_id: str | None = None


class ChatResponse(BaseModel):
    answer: str
    sources: list[str] = Field(default_factory=list)
    evidence: list[dict[str, object]] = Field(default_factory=list)
    used_rag: bool = False
    knowledge_base: str | None = None
    rag_confidence: float = 0.0
    retrieval_mode: str = "none"
    low_confidence_reason: str | None = None
    error: str | None = None
    error_type: str | None = None
    error_message: str | None = None
    session_id: str | None = None
    session: dict[str, object] | None = None


class ApiStatusResponse(BaseModel):
    ready: bool
    message: str
    model: str | None = None
    base_url: str | None = None
    error: str | None = None


_API_STATUS_CACHE: tuple[float, ApiStatusResponse] | None = None
_API_STATUS_TTL_SECONDS = 60.0


def _api_config() -> tuple[str, str, str]:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    model = os.getenv("OPENAI_MODEL", "gpt-4.1-mini").strip()
    base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").strip()
    if not base_url:
        base_url = "https://api.openai.com/v1"
    return api_key, model, base_url.rstrip("/")


def _chunk_text(text: str, size: int = 20) -> Iterator[str]:
    for index in range(0, len(text), size):
        yield text[index : index + size]


def _error_text(exc: Exception) -> str:
    """把异常统一转成简单可读的字符串，方便前端和日志显示。"""
    return f"{exc.__class__.__name__}: {exc}"


def _error_payload(error: str | Exception | None) -> tuple[str | None, str | None, str | None]:
    if error is None:
        return None, None, None
    error_text = str(error).strip()
    error_type, error_message = classify_error(error_text)
    return error_text, error_type, error_message


def _compact_history(history: list[dict[str, str]]) -> list[dict[str, str]]:
    cleaned: list[dict[str, str]] = []
    for item in history:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role") or "").strip()
        content = str(item.get("content") or "").strip()
        if role not in {"user", "assistant", "system"} or not content:
            continue
        cleaned.append({"role": role, "content": content})
    if len(cleaned) <= _MAX_RECENT_HISTORY_MESSAGES:
        return cleaned
    return cleaned[-_MAX_RECENT_HISTORY_MESSAGES:]


def _session_summary(session: dict[str, object]) -> dict[str, object]:
    """只返回会话列表需要的摘要字段，避免把整段消息历史都塞给前端列表。"""
    messages = session.get("messages")
    message_count = len(messages) if isinstance(messages, list) else 0
    return {
        "id": session.get("id"),
        "title": session.get("title"),
        "updated_at": session.get("updated_at"),
        "summary": session.get("summary") or "",
        "message_count": message_count,
    }


def _save_user_message(
    session_id: str | None,
    *,
    content: str,
    title_hint: str | None = None,
) -> tuple[str, str | None]:
    resolved_session_id = session_id or uuid4().hex
    try:
        session = upsert_session_message(
            session_id,
            role="user",
            content=content,
            title_hint=title_hint,
        )
        return session["id"], None
    except Exception as exc:
        return resolved_session_id, _error_text(exc)


def _save_answer_message(
    session_id: str | None,
    *,
    content: str,
    sources: list[str],
    evidence: list[dict[str, object]],
    used_rag: bool,
) -> tuple[str, str | None]:
    resolved_session_id = session_id or uuid4().hex
    try:
        session = upsert_session_message(
            session_id,
            role="assistant",
            content=content,
            sources=sources,
            evidence=evidence,
            used_rag=used_rag,
        )
        return session["id"], None
    except Exception as exc:
        return resolved_session_id, _error_text(exc)


def _save_turn(
    session_id: str | None,
    *,
    user_message: str,
    assistant_message: str,
    assistant_sources: list[str] | None = None,
    assistant_evidence: list[dict[str, object]] | None = None,
    assistant_used_rag: bool | None = None,
) -> tuple[str, str | None]:
    resolved_session_id = session_id or uuid4().hex
    try:
        session = append_turn(
            session_id,
            user_message=user_message,
            assistant_message=assistant_message,
            assistant_sources=assistant_sources,
            assistant_evidence=assistant_evidence,
            assistant_used_rag=assistant_used_rag,
        )
        return session["id"], None
    except Exception as exc:
        return resolved_session_id, _error_text(exc)


def _sse_event(event: str, data: dict[str, object]) -> bytes:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n".encode("utf-8")


def _build_meta_payload(
    *,
    sources: list[str],
    evidence: list[dict[str, object]],
    used_rag: bool,
    knowledge_base: str,
    rag_confidence: float,
    retrieval_mode: str,
    low_confidence_reason: str | None,
    ready: bool,
    session_id: str,
    error: str | None = None,
    error_type: str | None = None,
    error_message: str | None = None,
    session: dict[str, object] | None = None,
) -> dict[str, object]:
    return {
        "sources": sources,
        "evidence": evidence,
        "used_rag": used_rag,
        "knowledge_base": knowledge_base,
        "rag_confidence": rag_confidence,
        "retrieval_mode": retrieval_mode,
        "low_confidence_reason": low_confidence_reason,
        "ready": ready,
        "session_id": session_id,
        "error": error,
        "error_type": error_type,
        "error_message": error_message,
        "session": session,
    }


def get_api_status(force_refresh: bool = False) -> ApiStatusResponse:
    global _API_STATUS_CACHE

    now = monotonic()
    if (
        not force_refresh
        and _API_STATUS_CACHE is not None
        and now - _API_STATUS_CACHE[0] < _API_STATUS_TTL_SECONDS
    ):
        return _API_STATUS_CACHE[1]

    api_key, model, base_url = _api_config()

    if not api_key:
        result = ApiStatusResponse(
            ready=False,
            message="未配置 API Key，当前将使用本地兜底回答。",
            model=model,
            base_url=base_url,
        )
        _API_STATUS_CACHE = (now, result)
        return result

    if not base_url:
        result = ApiStatusResponse(
            ready=False,
            message="已配置 API Key，但接口地址缺失。",
            model=model,
            base_url=base_url,
        )
        _API_STATUS_CACHE = (now, result)
        return result

    result = ApiStatusResponse(
        ready=True,
        message="已准备好，可以开始聊天。",
        model=model,
        base_url=base_url,
    )

    _API_STATUS_CACHE = (now, result)
    return result


def list_recent_sessions(limit: int = 10) -> list[dict[str, object]]:
    return list_sessions(limit=limit)


def get_session_detail(session_id: str) -> dict[str, object] | None:
    return get_session(session_id)


def local_answer(
    message: str,
    sources: list[str],
    used_rag: bool,
    evidence: list[dict[str, object]] | None = None,
) -> str:
    intro = "我先基于知识库给你一个结构化回答。"
    if not used_rag:
        intro = "当前还没有命中本地知识库，我先给你一个基础回答。"
    source_text = f"参考来源：{', '.join(sorted(set(sources)))}。" if sources else ""
    evidence_lines = []
    for item in evidence or []:
        kb_name = str(item.get("knowledge_base_name") or "").strip()
        source = str(item.get("source") or "").strip()
        excerpt = str(item.get("excerpt") or "").strip()
        location = str(item.get("location") or "").strip()
        if not source and not excerpt:
            continue
        prefix = f"{kb_name} · " if kb_name else ""
        if source and excerpt:
            line = f"- {prefix}{source}：{excerpt}"
        elif source:
            line = f"- {prefix}{source}"
        else:
            line = f"- {prefix}{excerpt}"
        if location:
            line = f"{line}（{location}）"
        evidence_lines.append(line)
    evidence_text = ""
    if evidence_lines:
        evidence_text = "\n\n参考片段：\n" + "\n".join(evidence_lines)
    return (
        f"{intro}\n\n"
        f"你的问题是：{message}\n\n"
        f"建议你把这个项目拆成三层：后端接口、检索模块、前端页面。\n"
        f"后端负责接收问题并组织回答，检索模块负责从笔记里找相关内容，前端负责展示结果。\n"
        f"{source_text}"
        f"{evidence_text}"
    ).strip()


def chat(request: ChatRequest) -> ChatResponse:
    started_at = monotonic()
    (
        context,
        sources,
        evidence,
        used_rag,
        knowledge_base,
        rag_confidence,
        retrieval_mode,
        low_confidence_reason,
    ) = build_context(request.message)
    session_id = request.session_id
    existing_session = get_session(session_id) if session_id else None
    session_summary = str(existing_session.get("summary") or "") if existing_session else ""

    api_key, _, _ = _api_config()
    if api_key:
        try:
            model_started_at = monotonic()
            backend = create_backend()
            result = backend.generate(
                GenerationRequest(
                    question=request.message,
                    context=context,
                    history=_compact_history(request.history),
                    session_summary=session_summary,
                )
            )
            answer = result.answer
            model_elapsed_ms = round((monotonic() - model_started_at) * 1000, 2)
            saved_session_id, storage_error = _save_turn(
                session_id,
                user_message=request.message,
                assistant_message=answer,
                assistant_sources=sources,
                assistant_evidence=evidence,
                assistant_used_rag=used_rag,
            )
            session = get_session(saved_session_id)
            raw_error = f"StorageError: {storage_error}" if storage_error else None
            error, error_type, error_message = _error_payload(raw_error)
            log_event(
                "chat.completed",
                mode="completion",
                used_rag=used_rag,
                source_count=len(sources),
                model_elapsed_ms=model_elapsed_ms,
                elapsed_ms=round((monotonic() - started_at) * 1000, 2),
                session_id=saved_session_id,
                error_type=error_type,
            )
            return ChatResponse(
                answer=answer,
                sources=sources,
                evidence=evidence,
                used_rag=used_rag,
                knowledge_base=knowledge_base,
                rag_confidence=rag_confidence,
                retrieval_mode=retrieval_mode,
                low_confidence_reason=low_confidence_reason,
                error=error,
                error_type=error_type,
                error_message=error_message,
                session_id=saved_session_id,
                session=_session_summary(session) if session else None,
            )
        except Exception as exc:
            fallback_answer = local_answer(request.message, sources, used_rag, evidence)
            saved_session_id, storage_error = _save_turn(
                session_id,
                user_message=request.message,
                assistant_message=fallback_answer,
                assistant_sources=sources,
                assistant_evidence=evidence,
                assistant_used_rag=used_rag,
            )
            session = get_session(saved_session_id)
            raw_error = f"{exc.__class__.__name__}: {exc}"
            if storage_error:
                raw_error = f"{raw_error}; StorageError: {storage_error}"
            error, error_type, error_message = _error_payload(raw_error)
            log_event(
                "chat.fallback",
                mode="completion",
                used_rag=used_rag,
                source_count=len(sources),
                elapsed_ms=round((monotonic() - started_at) * 1000, 2),
                session_id=saved_session_id,
                error_type=error_type,
                error=error,
            )
            # Fall back to the local response so the demo still works offline.
            # The API path is preferred, but the app remains usable if config is incomplete.
            return ChatResponse(
                answer=fallback_answer,
                sources=sources,
                evidence=evidence,
                used_rag=used_rag,
                knowledge_base=knowledge_base,
                rag_confidence=rag_confidence,
                retrieval_mode=retrieval_mode,
                low_confidence_reason=low_confidence_reason,
                error=error,
                error_type=error_type,
                error_message=error_message,
                session_id=saved_session_id,
                session=_session_summary(session) if session else None,
            )

    fallback_answer = local_answer(request.message, sources, used_rag, evidence)
    saved_session_id, storage_error = _save_turn(
        session_id,
        user_message=request.message,
        assistant_message=fallback_answer,
        assistant_sources=sources,
        assistant_evidence=evidence,
        assistant_used_rag=used_rag,
    )
    session = get_session(saved_session_id)
    raw_error = "Missing OPENAI_API_KEY"
    if storage_error:
        raw_error = f"{raw_error}; StorageError: {storage_error}"
    error, error_type, error_message = _error_payload(raw_error)
    log_event(
        "chat.fallback",
        mode="local",
        used_rag=used_rag,
        source_count=len(sources),
        elapsed_ms=round((monotonic() - started_at) * 1000, 2),
        session_id=saved_session_id,
        error_type=error_type,
    )
    return ChatResponse(
        answer=fallback_answer,
        sources=sources,
        evidence=evidence,
        used_rag=used_rag,
        knowledge_base=knowledge_base,
        rag_confidence=rag_confidence,
        retrieval_mode=retrieval_mode,
        low_confidence_reason=low_confidence_reason,
        error=error,
        error_type=error_type,
        error_message=error_message,
        session_id=saved_session_id,
        session=_session_summary(session) if session else None,
    )
