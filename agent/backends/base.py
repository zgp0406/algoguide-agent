from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
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


class GenerationBackend(Protocol):
    def generate(self, request: GenerationRequest) -> GenerationResult:
        """生成完整回答。"""
        ...

    def stream(self, request: GenerationRequest) -> Iterator[str]:
        """以文本块形式生成回答。"""
        ...
