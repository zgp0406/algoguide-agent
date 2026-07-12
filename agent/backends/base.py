from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Protocol


@dataclass(frozen=True)
class GenerationRequest:
    """生成后端的统一输入；检索必须在进入后端前完成。"""

    question: str
    context: str
    history: list[dict[str, str]]
    session_summary: str = ""


@dataclass(frozen=True)
class GenerationResult:
    answer: str
    model: str


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict[str, object]


@dataclass
class AgentResponse:
    """Agent 模式下的 LLM 响应：要么是最终文本，要么是工具调用列表。"""

    type: str  # "text" | "tool_calls"
    content: str = ""
    tool_calls: list[ToolCall] = field(default_factory=list)
    model: str = ""


class GenerationBackend(Protocol):
    def generate(self, request: GenerationRequest) -> GenerationResult:
        """生成完整回答。"""
        ...

    def stream(self, request: GenerationRequest) -> Iterator[str]:
        """以文本块形式生成回答。"""
        ...

    def generate_with_tools(
        self, messages: list[dict[str, object]], tools: list[dict[str, object]]
    ) -> AgentResponse:
        """带工具定义的生成——返回文本或 tool_calls。"""
        ...

    def stream_with_tools(
        self, messages: list[dict[str, object]], tools: list[dict[str, object]]
    ) -> Iterator[dict[str, object]]:
        """带工具定义的流式生成——产出 {"type": "delta"|"tool_call_start"|"tool_call_chunk"|"done", ...} 事件。"""
        ...
