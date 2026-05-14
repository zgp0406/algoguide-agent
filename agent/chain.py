from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from collections.abc import Iterator
from time import monotonic
from uuid import uuid4

from pydantic import BaseModel, Field

from agent.env import load_env_file
from agent.prompt import SYSTEM_PROMPT
from agent.retriever import retrieve_with_scores
from agent.sessions import append_turn, get_session, list_sessions, upsert_session_message


load_env_file()


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
    error: str | None = None
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
_API_TIMEOUT_SECONDS = float(os.getenv("OPENAI_TIMEOUT_SECONDS", "60"))
_MAX_RECENT_HISTORY_MESSAGES = 8
_DEFAULT_KNOWLEDGE_BASE_NAME = "全库检索"


def _api_config() -> tuple[str, str, str]:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    model = os.getenv("OPENAI_MODEL", "gpt-4.1-mini").strip()
    base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").strip()
    if not base_url:
        base_url = "https://api.openai.com/v1"
    return api_key, model, base_url.rstrip("/")


def _proxyless_opener() -> urllib.request.OpenerDirector:
    return urllib.request.build_opener(urllib.request.ProxyHandler({}))


def _chunk_text(text: str, size: int = 20) -> Iterator[str]:
    for index in range(0, len(text), size):
        yield text[index : index + size]


# 把异常统一转成简单可读的字符串，方便前端和日志显示。
def _error_text(exc: Exception) -> str:
    return f"{exc.__class__.__name__}: {exc}"


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


# 只返回会话列表需要的摘要字段，避免把整段消息历史都塞给前端列表。
def _session_summary(session: dict[str, object]) -> dict[str, object]:
    messages = session.get("messages")
    message_count = len(messages) if isinstance(messages, list) else 0
    return {
        "id": session.get("id"),
        "title": session.get("title"),
        "updated_at": session.get("updated_at"),
        "summary": session.get("summary") or "",
        "message_count": message_count,
    }


def _knowledge_base_name() -> str:
    return _DEFAULT_KNOWLEDGE_BASE_NAME


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


def _excerpt_text(text: str, limit: int = 160) -> str:
    normalized = " ".join(str(text or "").strip().split())
    if len(normalized) <= limit:
        return normalized
    return f"{normalized[: limit - 1]}…"


def _format_evidence_items(chunks: list[object]) -> list[dict[str, object]]:
    evidence: list[dict[str, object]] = []
    for chunk in chunks:
        knowledge_base_id = str(getattr(chunk, "knowledge_base_id", "") or "").strip()
        knowledge_base_name = str(getattr(chunk, "knowledge_base_name", "") or "").strip()
        source = str(getattr(chunk, "source", "") or "").strip()
        text = str(getattr(chunk, "text", "") or "").strip()
        location = str(getattr(chunk, "location", "") or "").strip()
        score = getattr(chunk, "score", None)
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
        evidence.append(item)
    return evidence


def _build_model_messages(
    *,
    prompt: str,
    history: list[dict[str, str]],
    session_summary: str = "",
) -> list[dict[str, str]]:
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    summary_text = str(session_summary or "").strip()
    if summary_text:
        messages.append({"role": "system", "content": f"会话摘要：{summary_text}"})
    messages.extend(_compact_history(history))
    messages.append({"role": "user", "content": prompt})
    return messages


def _request_chat_completion(
    messages: list[dict[str, str]],
    *,
    temperature: float = 0.2,
    max_tokens: int | None = None,
) -> tuple[str, dict[str, object]]:
    api_key, model, base_url = _api_config()
    if not api_key:
        raise RuntimeError("Missing OPENAI_API_KEY")

    payload: dict[str, object] = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
    }
    if max_tokens is not None:
        payload["max_tokens"] = max_tokens

    url = f"{base_url}/chat/completions"
    request = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )

    try:
        with _proxyless_opener().open(request, timeout=_API_TIMEOUT_SECONDS) as response:
            response_data = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise RuntimeError(_format_http_error(exc)) from exc

    choices = response_data.get("choices") or []
    if not choices:
        raise RuntimeError("API response missing choices")

    message = choices[0].get("message") or {}
    content = message.get("content") or ""
    return content, response_data



def _request_chat_completion_stream(
    messages: list[dict[str, str]],
    *,
    temperature: float = 0.2,
) -> Iterator[str]:
    api_key, model, base_url = _api_config()
    if not api_key:
        raise RuntimeError("Missing OPENAI_API_KEY")

    payload: dict[str, object] = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "stream": True,
    }

    url = f"{base_url}/chat/completions"
    request = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )

    try:
        with _proxyless_opener().open(request, timeout=_API_TIMEOUT_SECONDS) as response:
            for raw_line in response:
                line = raw_line.decode("utf-8", errors="replace").strip()
                if not line:
                    continue
                if not line.startswith("data:"):
                    continue

                data = line[5:].strip()
                if data == "[DONE]":
                    break

                chunk = json.loads(data)
                choices = chunk.get("choices") or []
                if not choices:
                    continue

                delta = choices[0].get("delta") or {}
                content = delta.get("content") or ""
                if content:
                    yield content
    except urllib.error.HTTPError as exc:
        raise RuntimeError(_format_http_error(exc)) from exc


def _format_http_error(exc: urllib.error.HTTPError) -> str:
    try:
        body = exc.read().decode("utf-8", errors="replace")
    except Exception:
        body = ""
    detail = f"{exc.code} {exc.reason}".strip()
    if body:
        return f"HTTPError: {detail} - {body}"
    return f"HTTPError: {detail}"


def _sse_event(event: str, data: dict[str, object]) -> bytes:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n".encode("utf-8")


def list_recent_sessions(limit: int = 10) -> list[dict[str, object]]:
    return list_sessions(limit=limit)


def get_session_detail(session_id: str) -> dict[str, object] | None:
    return get_session(session_id)


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


def build_context(message: str) -> tuple[str, list[str], list[dict[str, object]], bool, str]:
    chunks = retrieve_with_scores(message)
    if not chunks:
        return message, [], [], False, _knowledge_base_name()

    context_lines = []
    sources = []
    for index, chunk in enumerate(chunks, start=1):
        location_text = f" | 位置：{chunk.location}" if getattr(chunk, "location", "") else ""
        context_lines.append(
            f"{index}. 知识库：{chunk.knowledge_base_name or _knowledge_base_name()} | 来源：{chunk.source}{location_text}\n"
            f"   片段：{chunk.text}"
        )
        sources.append(chunk.source)

    context = "\n\n".join(context_lines)
    prompt = (
        "Relevant knowledge with citations:\n"
        f"{context}\n\n"
        f"User question: {message}\n"
        "请优先基于以上证据回答，并在答案里自然提及关键来源。"
    )
    return prompt, _unique_strings(sources), _format_evidence_items(chunks), True, _knowledge_base_name()


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


def _build_meta_payload(
    *,
    sources: list[str],
    evidence: list[dict[str, object]],
    used_rag: bool,
    knowledge_base: str,
    ready: bool,
    session_id: str,
    error: str | None = None,
    session: dict[str, object] | None = None,
) -> dict[str, object]:
    return {
        "sources": sources,
        "evidence": evidence,
        "used_rag": used_rag,
        "knowledge_base": knowledge_base,
        "ready": ready,
        "session_id": session_id,
        "error": error,
        "session": session,
    }


def chat(request: ChatRequest) -> ChatResponse:
    prompt, sources, evidence, used_rag, knowledge_base = build_context(request.message)
    session_id = request.session_id
    existing_session = get_session(session_id) if session_id else None
    session_summary = str(existing_session.get("summary") or "") if existing_session else ""

    api_key, _, _ = _api_config()
    if api_key:
        try:
            answer, _ = _request_chat_completion(
                _build_model_messages(prompt=prompt, history=request.history, session_summary=session_summary),
                temperature=0.2,
            )
            saved_session_id, storage_error = _save_turn(
                session_id,
                user_message=request.message,
                assistant_message=answer,
                assistant_sources=sources,
                assistant_evidence=evidence,
                assistant_used_rag=used_rag,
            )
            session = get_session(saved_session_id)
            error = None
            if storage_error:
                error = f"StorageError: {storage_error}"
            return ChatResponse(
                answer=answer,
                sources=sources,
                evidence=evidence,
                used_rag=used_rag,
                knowledge_base=knowledge_base,
                error=error,
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
            error = f"{exc.__class__.__name__}: {exc}"
            if storage_error:
                error = f"{error}; StorageError: {storage_error}"
            # Fall back to the local response so the demo still works offline.
            # The API path is preferred, but the app remains usable if config is incomplete.
            return ChatResponse(
                answer=fallback_answer,
                sources=sources,
                evidence=evidence,
                used_rag=used_rag,
                knowledge_base=knowledge_base,
                error=error,
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
    error = "Missing OPENAI_API_KEY"
    if storage_error:
        error = f"{error}; StorageError: {storage_error}"
    return ChatResponse(
        answer=fallback_answer,
        sources=sources,
        evidence=evidence,
        used_rag=used_rag,
        knowledge_base=knowledge_base,
        error=error,
        session_id=saved_session_id,
        session=_session_summary(session) if session else None,
    )


def stream_chat(request: ChatRequest) -> Iterator[bytes]:
    prompt, sources, evidence, used_rag, knowledge_base = build_context(request.message)
    existing_session = get_session(request.session_id) if request.session_id else None
    session_summary = str(existing_session.get("summary") or "") if existing_session else ""
    session_id, storage_error = _save_user_message(
        request.session_id,
        content=request.message,
        title_hint=request.message,
    )

    api_key, _, _ = _api_config()
    if not api_key:
        answer = local_answer(request.message, sources, used_rag, evidence)
        meta_error = storage_error
        yield _sse_event(
            "meta",
            _build_meta_payload(
                sources=sources,
                evidence=evidence,
                used_rag=used_rag,
                knowledge_base=knowledge_base,
                ready=False,
                session_id=session_id,
                error=meta_error,
            ),
        )
        for chunk in _chunk_text(answer):
            yield _sse_event("delta", {"text": chunk})
        saved_session_id, answer_storage_error = _save_answer_message(
            session_id,
            content=answer,
            sources=sources,
            evidence=evidence,
            used_rag=used_rag,
        )
        session = get_session(saved_session_id)
        if answer_storage_error:
            meta_error = answer_storage_error if not meta_error else f"{meta_error}; {answer_storage_error}"
        yield _sse_event(
            "done",
            {
                "answer": answer,
                **_build_meta_payload(
                    sources=sources,
                    evidence=evidence,
                    used_rag=used_rag,
                    knowledge_base=knowledge_base,
                    ready=False,
                    session_id=saved_session_id,
                    error=meta_error,
                    session=_session_summary(session) if session else None,
                ),
            },
        )
        return

    messages = _build_model_messages(prompt=prompt, history=request.history, session_summary=session_summary)

    try:
        meta_error = storage_error
        yield _sse_event(
            "meta",
            _build_meta_payload(
                sources=sources,
                evidence=evidence,
                used_rag=used_rag,
                knowledge_base=knowledge_base,
                ready=True,
                session_id=session_id,
                error=meta_error,
            ),
        )
        answer_parts: list[str] = []
        for chunk in _request_chat_completion_stream(messages, temperature=0.2):
            answer_parts.append(chunk)
            yield _sse_event("delta", {"text": chunk})
        answer = "".join(answer_parts)
        saved_session_id, answer_storage_error = _save_answer_message(
            session_id,
            content=answer,
            sources=sources,
            evidence=evidence,
            used_rag=used_rag,
        )
        session = get_session(saved_session_id)
        if answer_storage_error:
            meta_error = answer_storage_error if not meta_error else f"{meta_error}; {answer_storage_error}"
        yield _sse_event(
            "done",
            {
                "answer": answer,
                **_build_meta_payload(
                    sources=sources,
                    evidence=evidence,
                    used_rag=used_rag,
                    knowledge_base=knowledge_base,
                    ready=True,
                    session_id=saved_session_id,
                    error=meta_error,
                    session=_session_summary(session) if session else None,
                ),
            },
        )
    except Exception as exc:
        # If the provider refuses streaming, fall back to a normal completion and chunk locally.
        try:
            answer, _ = _request_chat_completion(messages, temperature=0.2)
        except Exception:
            answer = local_answer(request.message, sources, used_rag, evidence)
        saved_session_id, answer_storage_error = _save_answer_message(
            session_id,
            content=answer,
            sources=sources,
            evidence=evidence,
            used_rag=used_rag,
        )
        session = get_session(saved_session_id)
        error_text = _error_text(exc)
        if storage_error:
            error_text = f"{error_text}; StorageError: {storage_error}"
        if answer_storage_error:
            error_text = f"{error_text}; StorageError: {answer_storage_error}"
        yield _sse_event(
            "meta",
            _build_meta_payload(
                sources=sources,
                evidence=evidence,
                used_rag=used_rag,
                knowledge_base=knowledge_base,
                ready=False,
                session_id=saved_session_id,
                error=error_text,
                session=_session_summary(session) if session else None,
            ),
        )
        for chunk in _chunk_text(answer):
            yield _sse_event("delta", {"text": chunk})
        yield _sse_event(
            "done",
            {
                "answer": answer,
                **_build_meta_payload(
                    sources=sources,
                    evidence=evidence,
                    used_rag=used_rag,
                    knowledge_base=knowledge_base,
                    ready=False,
                    session_id=saved_session_id,
                    error=error_text,
                    session=_session_summary(session) if session else None,
                ),
            },
        )
