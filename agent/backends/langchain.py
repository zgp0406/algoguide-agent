from __future__ import annotations

import os
from collections.abc import Iterator

from agent.backends.base import GenerationRequest, GenerationResult
from agent.prompt import SYSTEM_PROMPT


class LangChainBackend:
    """使用 ChatPromptTemplate + LCEL 的 LangChain 回答后端。"""

    def __init__(self) -> None:
        try:
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
        model = ChatOpenAI(
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
        self._chain = prompt | model | StrOutputParser()

    @staticmethod
    def _payload(request: GenerationRequest) -> dict[str, object]:
        # LangChain 可直接把 OpenAI 风格的 role/content 字典转换成消息。
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
