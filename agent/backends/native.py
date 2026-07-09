from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from collections.abc import Iterator

from agent.backends.base import GenerationRequest, GenerationResult
from agent.prompt import SYSTEM_PROMPT


def _api_config() -> tuple[str, str, str]:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    model = os.getenv("OPENAI_MODEL", "gpt-4.1-mini").strip()
    base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").strip()
    return api_key, model, (base_url or "https://api.openai.com/v1").rstrip("/")


def _timeout_seconds() -> float:
    return float(os.getenv("OPENAI_TIMEOUT_SECONDS", "60"))


def _proxyless_opener() -> urllib.request.OpenerDirector:
    return urllib.request.build_opener(urllib.request.ProxyHandler({}))


def _format_http_error(exc: urllib.error.HTTPError) -> str:
    try:
        body = exc.read().decode("utf-8", errors="replace")
    except Exception:
        body = ""
    detail = body.strip() or str(exc.reason)
    return f"HTTP {exc.code}: {detail}"


def _question_prompt(request: GenerationRequest) -> str:
    if not request.context.strip():
        return request.question
    return (
        "Relevant knowledge with citations:\n"
        f"{request.context}\n\n"
        f"User question: {request.question}\n"
        "请优先基于以上证据回答，并在答案里自然提及关键来源。"
    )


def _messages(request: GenerationRequest) -> list[dict[str, str]]:
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    if request.session_summary.strip():
        messages.append({"role": "system", "content": f"会话摘要：{request.session_summary.strip()}"})
    messages.extend(request.history)
    messages.append({"role": "user", "content": _question_prompt(request)})
    return messages


class NativeBackend:
    """使用 urllib 调用 OpenAI 兼容接口的原生后端。"""

    def generate(self, request: GenerationRequest) -> GenerationResult:
        api_key, model, base_url = _api_config()
        if not api_key:
            raise RuntimeError("Missing OPENAI_API_KEY")
        payload = {
            "model": model,
            "messages": _messages(request),
            "temperature": 0.2,
        }
        response_data = self._request(base_url, api_key, payload)
        choices = response_data.get("choices") or []
        if not choices:
            raise RuntimeError("API response missing choices")
        answer = str((choices[0].get("message") or {}).get("content") or "")
        return GenerationResult(answer=answer, model=model)

    def stream(self, request: GenerationRequest) -> Iterator[str]:
        api_key, model, base_url = _api_config()
        if not api_key:
            raise RuntimeError("Missing OPENAI_API_KEY")
        payload = {
            "model": model,
            "messages": _messages(request),
            "temperature": 0.2,
            "stream": True,
        }
        http_request = self._build_request(base_url, api_key, payload)
        try:
            with _proxyless_opener().open(http_request, timeout=_timeout_seconds()) as response:
                for raw_line in response:
                    line = raw_line.decode("utf-8", errors="replace").strip()
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    choices = (json.loads(data).get("choices") or [])
                    content = str((choices[0].get("delta") or {}).get("content") or "") if choices else ""
                    if content:
                        yield content
        except urllib.error.HTTPError as exc:
            raise RuntimeError(_format_http_error(exc)) from exc

    @staticmethod
    def _build_request(
        base_url: str,
        api_key: str,
        payload: dict[str, object],
    ) -> urllib.request.Request:
        return urllib.request.Request(
            f"{base_url}/chat/completions",
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            method="POST",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
        )

    def _request(
        self,
        base_url: str,
        api_key: str,
        payload: dict[str, object],
    ) -> dict[str, object]:
        http_request = self._build_request(base_url, api_key, payload)
        try:
            with _proxyless_opener().open(http_request, timeout=_timeout_seconds()) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            raise RuntimeError(_format_http_error(exc)) from exc
