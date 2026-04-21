from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from collections.abc import Iterator
from time import monotonic

from pydantic import BaseModel, Field

from agent.env import load_env_file
from agent.prompt import SYSTEM_PROMPT
from agent.retriever import retrieve


load_env_file()


class ChatRequest(BaseModel):
    message: str = Field(min_length=1)
    history: list[dict[str, str]] = Field(default_factory=list)


class ChatResponse(BaseModel):
    answer: str
    sources: list[str] = Field(default_factory=list)
    used_rag: bool = False
    error: str | None = None


class ApiStatusResponse(BaseModel):
    ready: bool
    message: str
    model: str | None = None
    base_url: str | None = None
    error: str | None = None


_API_STATUS_CACHE: tuple[float, ApiStatusResponse] | None = None
_API_STATUS_TTL_SECONDS = 60.0
_API_TIMEOUT_SECONDS = float(os.getenv("OPENAI_TIMEOUT_SECONDS", "60"))


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

    with _proxyless_opener().open(request, timeout=_API_TIMEOUT_SECONDS) as response:
        response_data = json.loads(response.read().decode("utf-8"))

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


def build_context(message: str) -> tuple[str, list[str], bool]:
    chunks = retrieve(message)
    if not chunks:
        return message, [], False

    context_lines = []
    sources = []
    for chunk in chunks:
        context_lines.append(f"[{chunk.source}] {chunk.text}")
        sources.append(chunk.source)

    context = "\n\n".join(context_lines)
    prompt = (
        f"Relevant knowledge:\n{context}\n\n"
        f"User question: {message}\n"
    )
    return prompt, sources, True


def local_answer(message: str, sources: list[str], used_rag: bool) -> str:
    intro = "我先基于知识库给你一个结构化回答。"
    if not used_rag:
        intro = "当前还没有命中本地知识库，我先给你一个基础回答。"
    source_text = f"参考来源：{', '.join(sorted(set(sources)))}。" if sources else ""
    return (
        f"{intro}\n\n"
        f"你的问题是：{message}\n\n"
        f"建议你把这个项目拆成三层：后端接口、检索模块、前端页面。\n"
        f"后端负责接收问题并组织回答，检索模块负责从笔记里找相关内容，前端负责展示结果。\n"
        f"{source_text}"
    ).strip()


def chat(request: ChatRequest) -> ChatResponse:
    prompt, sources, used_rag = build_context(request.message)

    api_key, _, _ = _api_config()
    if api_key:
        try:
            answer, _ = _request_chat_completion(
                [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    *request.history,
                    {"role": "user", "content": prompt},
                ],
                temperature=0.2,
            )
            return ChatResponse(answer=answer, sources=sources, used_rag=used_rag)
        except Exception as exc:
            # Fall back to the local response so the demo still works offline.
            # The API path is preferred, but the app remains usable if config is incomplete.
            return ChatResponse(
                answer=local_answer(request.message, sources, used_rag),
                sources=sources,
                used_rag=used_rag,
                error=f"{exc.__class__.__name__}: {exc}",
            )

    return ChatResponse(
        answer=local_answer(request.message, sources, used_rag),
        sources=sources,
        used_rag=used_rag,
        error="Missing OPENAI_API_KEY",
    )


def stream_chat(request: ChatRequest) -> Iterator[bytes]:
    prompt, sources, used_rag = build_context(request.message)

    api_key, _, _ = _api_config()
    if not api_key:
        answer = local_answer(request.message, sources, used_rag)
        yield _sse_event("meta", {"sources": sources, "used_rag": used_rag, "ready": False})
        for chunk in _chunk_text(answer):
            yield _sse_event("delta", {"text": chunk})
        yield _sse_event(
            "done",
            {"answer": answer, "sources": sources, "used_rag": used_rag, "ready": False},
        )
        return

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        *request.history,
        {"role": "user", "content": prompt},
    ]

    try:
        yield _sse_event("meta", {"sources": sources, "used_rag": used_rag, "ready": True})
        answer_parts: list[str] = []
        for chunk in _request_chat_completion_stream(messages, temperature=0.2):
            answer_parts.append(chunk)
            yield _sse_event("delta", {"text": chunk})
        answer = "".join(answer_parts)
        yield _sse_event(
            "done",
            {"answer": answer, "sources": sources, "used_rag": used_rag, "ready": True},
        )
    except Exception as exc:
        # If the provider refuses streaming, fall back to a normal completion and chunk locally.
        try:
            answer, _ = _request_chat_completion(messages, temperature=0.2)
        except Exception:
            answer = local_answer(request.message, sources, used_rag)
        yield _sse_event(
            "meta",
            {
                "sources": sources,
                "used_rag": used_rag,
                "ready": False,
                "error": f"{exc.__class__.__name__}: {exc}",
            },
        )
        for chunk in _chunk_text(answer):
            yield _sse_event("delta", {"text": chunk})
        yield _sse_event(
            "done",
            {"answer": answer, "sources": sources, "used_rag": used_rag, "ready": False},
        )
