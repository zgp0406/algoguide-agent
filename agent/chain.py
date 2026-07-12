"""兼容性 re-export 层。

原有导入 `from agent.chain import ...` 保持不变，实际实现已拆分到:
- agent.context: 上下文构建与检索置信度
- agent.chat: 非流式聊天、模型定义、辅助函数
- agent.stream: SSE 流式聊天
"""

from agent.chat import (
    ApiStatusResponse,
    ChatRequest,
    ChatResponse,
    chat,
    get_api_status,
    get_session_detail,
    list_recent_sessions,
)
from agent.context import build_context
from agent.stream import stream_chat

__all__ = [
    "ApiStatusResponse",
    "ChatRequest",
    "ChatResponse",
    "build_context",
    "chat",
    "get_api_status",
    "get_session_detail",
    "list_recent_sessions",
    "stream_chat",
]
