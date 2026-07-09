from __future__ import annotations

import os

from agent.backends.base import GenerationBackend
from agent.backends.native import NativeBackend


def create_backend() -> GenerationBackend:
    """按配置创建后端；延迟导入保证 Native 模式不依赖 LangChain。"""
    backend = os.getenv("CHAIN_BACKEND", "native").strip().lower()
    if backend == "native":
        return NativeBackend()
    if backend == "langchain":
        from agent.backends.langchain import LangChainBackend

        return LangChainBackend()
    raise ValueError(f"不支持的 CHAIN_BACKEND：{backend}")
