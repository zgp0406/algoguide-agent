from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from collections.abc import Iterator

from agent.backends.base import AgentResponse, GenerationRequest, GenerationResult, ToolCall
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

    # ── Agent / Function Calling 支持 ──────────────────────────

    def generate_with_tools(
        self, messages: list[dict[str, object]], tools: list[dict[str, object]]
    ) -> AgentResponse:
        """非流式：发送带 tools 定义的请求，解析 tool_calls 或文本响应。"""
        api_key, model, base_url = _api_config()
        if not api_key:
            raise RuntimeError("Missing OPENAI_API_KEY")
        payload: dict[str, object] = {
            "model": model,
            "messages": messages,
            "temperature": 0.2,
            "tools": tools,
            "tool_choice": "auto",
        }
        response_data = self._request(base_url, api_key, payload)
        choices = response_data.get("choices") or []
        if not choices:
            raise RuntimeError("API response missing choices")
        msg = choices[0].get("message") or {}

        tool_calls_raw = msg.get("tool_calls")
        if tool_calls_raw:
            tool_calls = []
            for tc in tool_calls_raw:
                func = tc.get("function") or {}
                try:
                    args = json.loads(str(func.get("arguments") or "{}"))
                except json.JSONDecodeError:
                    args = {}
                tool_calls.append(
                    ToolCall(
                        id=str(tc.get("id") or ""),
                        name=str(func.get("name") or ""),
                        arguments=args,
                    )
                )
            return AgentResponse(type="tool_calls", tool_calls=tool_calls, model=model)

        content = str(msg.get("content") or "")
        return AgentResponse(type="text", content=content, model=model)

    def stream_with_tools(
        self, messages: list[dict[str, object]], tools: list[dict[str, object]]
    ) -> Iterator[dict[str, object]]:
        """流式：发送带 tools 定义的 stream 请求，产出增量事件。"""
        api_key, model, base_url = _api_config()
        if not api_key:
            raise RuntimeError("Missing OPENAI_API_KEY")
        payload: dict[str, object] = {
            "model": model,
            "messages": messages,
            "temperature": 0.2,
            "stream": True,
            "tools": tools,
            "tool_choice": "auto",
        }
        http_request = self._build_request(base_url, api_key, payload)
        tool_call_buffers: dict[int, dict[str, object]] = {}
        try:
            with _proxyless_opener().open(http_request, timeout=_timeout_seconds()) as response:
                for raw_line in response:
                    line = raw_line.decode("utf-8", errors="replace").strip()
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    try:
                        parsed = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    choices = parsed.get("choices") or []
                    if not choices:
                        continue
                    delta = choices[0].get("delta") or {}
                    finish_reason = choices[0].get("finish_reason") or ""

                    # 文本增量
                    content = str(delta.get("content") or "")
                    if content:
                        yield {"type": "delta", "text": content}

                    # 工具调用增量
                    tc_deltas = delta.get("tool_calls")
                    if tc_deltas:
                        for tc_delta in tc_deltas:
                            idx = int(tc_delta.get("index", 0))
                            if idx not in tool_call_buffers:
                                tool_call_buffers[idx] = {
                                    "id": str(tc_delta.get("id") or ""),
                                    "name": "",
                                    "arguments": "",
                                }
                            buf = tool_call_buffers[idx]
                            if "id" in tc_delta and tc_delta["id"]:
                                buf["id"] = str(tc_delta["id"])
                            func = tc_delta.get("function") or {}
                            if "name" in func and func["name"]:
                                buf["name"] = str(func["name"])
                                yield {"type": "tool_call_start", "name": buf["name"]}
                            if "arguments" in func:
                                buf["arguments"] += str(func["arguments"])

                    if finish_reason == "tool_calls":
                        # 所有 tool_call 收集完毕，产出完整结果
                        for idx in sorted(tool_call_buffers):
                            buf = tool_call_buffers[idx]
                            try:
                                args = json.loads(buf["arguments"])
                            except json.JSONDecodeError:
                                args = {}
                            yield {
                                "type": "tool_call",
                                "id": buf["id"],
                                "name": buf["name"],
                                "arguments": args,
                            }
                        tool_call_buffers.clear()

                    if finish_reason == "stop":
                        yield {"type": "done"}
        except urllib.error.HTTPError as exc:
            raise RuntimeError(_format_http_error(exc)) from exc
