from __future__ import annotations

import json
import os
from collections.abc import Iterator

from agent.backends.base import AgentResponse, GenerationRequest, GenerationResult, ToolCall
from agent.prompt import SYSTEM_PROMPT


class LangChainBackend:
    """使用 ChatPromptTemplate + LCEL 的 LangChain 回答后端。"""

    def __init__(self) -> None:
        try:
            from langchain_core.messages import AIMessage
            from langchain_core.output_parsers import StrOutputParser
            from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
            from langchain_openai import ChatOpenAI
        except ImportError as exc:
            raise RuntimeError(
                "LangChain 后端依赖未安装，请执行 pip install -r requirements.langchain.txt"
            ) from exc

        api_key = os.getenv("OPENAI_API_KEY", "").strip()
        if not api_key:
            raise RuntimeError("Missing OPENAI_API_KEY")

        self.model_name = os.getenv("OPENAI_MODEL", "gpt-4.1-mini").strip()
        base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").strip()
        timeout = float(os.getenv("OPENAI_TIMEOUT_SECONDS", "60"))
        self._base_model = ChatOpenAI(
            model=self.model_name,
            api_key=api_key,
            base_url=(base_url or "https://api.openai.com/v1").rstrip("/"),
            temperature=0.2,
            timeout=timeout,
        )
        prompt = ChatPromptTemplate.from_messages(
            [
                (
                    "system",
                    SYSTEM_PROMPT
                    + "\n会话摘要：{session_summary}\n\n"
                    + "只能把下面提供的资料视为知识库证据；资料为空或不足时要明确说明，"
                    + "不要把自身知识冒充知识库内容。\n\n知识库资料：\n{context}",
                ),
                MessagesPlaceholder("history"),
                ("human", "{question}"),
            ]
        )
        # 纯文本 chain（普通模式）
        self._chain = prompt | self._base_model | StrOutputParser()

    @staticmethod
    def _payload(request: GenerationRequest) -> dict[str, object]:
        return {
            "question": request.question,
            "context": request.context or "（未提供知识库资料）",
            "history": request.history,
            "session_summary": request.session_summary or "（无）",
        }

    def generate(self, request: GenerationRequest) -> GenerationResult:
        answer = self._chain.invoke(self._payload(request))
        return GenerationResult(answer=str(answer), model=self.model_name)

    def stream(self, request: GenerationRequest) -> Iterator[str]:
        for chunk in self._chain.stream(self._payload(request)):
            text = str(chunk)
            if text:
                yield text

    # ── Agent / Function Calling ──────────────────────────────

    def generate_with_tools(
        self, messages: list[dict[str, object]], tools: list[dict[str, object]]
    ) -> AgentResponse:
        """非流式 function calling——用 bind_tools 注入工具定义。"""
        from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage

        # 将 dict 消息转为 LangChain 消息格式
        lc_messages = _dicts_to_lc_messages(messages)
        model_with_tools = self._base_model.bind_tools(
            [_normalize_tool(t) for t in tools], tool_choice="auto"
        )
        response = model_with_tools.invoke(lc_messages)

        if isinstance(response, AIMessage) and response.tool_calls:
            tool_calls = []
            for tc in response.tool_calls:
                args = tc.get("args") or tc.get("arguments") or {}
                if isinstance(args, str):
                    try:
                        args = json.loads(args)
                    except json.JSONDecodeError:
                        args = {}
                tool_calls.append(
                    ToolCall(
                        id=str(tc.get("id") or ""),
                        name=str(tc.get("name") or ""),
                        arguments=args,
                    )
                )
            return AgentResponse(
                type="tool_calls",
                content=str(response.content or ""),
                tool_calls=tool_calls,
                model=self.model_name,
            )

        return AgentResponse(
            type="text",
            content=str(response.content or ""),
            model=self.model_name,
        )

    def stream_with_tools(
        self, messages: list[dict[str, object]], tools: list[dict[str, object]]
    ) -> Iterator[dict[str, object]]:
        """流式 function calling——产出 delta / tool_call_start / tool_call / done 事件。"""
        from langchain_core.messages import AIMessageChunk

        lc_messages = _dicts_to_lc_messages(messages)
        model_with_tools = self._base_model.bind_tools(
            [_normalize_tool(t) for t in tools], tool_choice="auto"
        )

        tc_bufs: dict[int, dict[str, object]] = {}
        for chunk in model_with_tools.stream(lc_messages):
            if isinstance(chunk, AIMessageChunk):
                if chunk.content:
                    yield {"type": "delta", "text": str(chunk.content)}
                if chunk.tool_call_chunks:
                    for tc_chunk in chunk.tool_call_chunks:
                        idx = int(tc_chunk.get("index", 0))
                        if idx not in tc_bufs:
                            tc_bufs[idx] = {"id": "", "name": "", "arguments": ""}
                            name = str(tc_chunk.get("name") or "")
                            if name:
                                tc_bufs[idx]["name"] = name
                                yield {"type": "tool_call_start", "name": name}
                        if tc_chunk.get("id"):
                            tc_bufs[idx]["id"] = str(tc_chunk["id"])
                        if tc_chunk.get("args"):
                            tc_bufs[idx]["arguments"] += str(tc_chunk["args"])

        # 产出完整的 tool_call 事件
        for idx in sorted(tc_bufs):
            buf = tc_bufs[idx]
            if buf["name"]:
                try:
                    args = json.loads(buf["arguments"]) if buf["arguments"] else {}
                except json.JSONDecodeError:
                    args = {}
                yield {
                    "type": "tool_call",
                    "id": buf["id"],
                    "name": buf["name"],
                    "arguments": args,
                }

        yield {"type": "done"}


def _normalize_tool(tool: dict[str, object]) -> dict[str, object]:
    """确保工具定义与 LangChain 的 bind_tools 兼容。"""
    if "function" in tool:
        return tool
    return {"type": "function", "function": tool}


def _dicts_to_lc_messages(
    messages: list[dict[str, object]],
) -> list[object]:
    """将 OpenAI 风格的 role/content 字典转为 LangChain 消息对象。"""
    from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage

    lc_msgs = []
    for msg in messages:
        role = str(msg.get("role") or "user")
        content = str(msg.get("content") or "")

        if role == "system":
            lc_msgs.append(SystemMessage(content=content))
        elif role == "user":
            lc_msgs.append(HumanMessage(content=content))
        elif role == "assistant":
            extra = {}
            tc_list = msg.get("tool_calls")
            if tc_list and isinstance(tc_list, list):
                extra["tool_calls"] = tc_list
            lc_msgs.append(AIMessage(content=content or None, **extra))
        elif role == "tool":
            tc_id = str(msg.get("tool_call_id") or "")
            lc_msgs.append(ToolMessage(content=content, tool_call_id=tc_id))
        else:
            lc_msgs.append(HumanMessage(content=content))
    return lc_msgs
