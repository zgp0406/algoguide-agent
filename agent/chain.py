from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, Field

from agent.prompt import SYSTEM_PROMPT
from agent.retriever import retrieve


class ChatRequest(BaseModel):
    message: str = Field(min_length=1)
    history: list[dict[str, str]] = Field(default_factory=list)


class ChatResponse(BaseModel):
    answer: str
    sources: list[str] = Field(default_factory=list)
    used_rag: bool = False


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
        f"{SYSTEM_PROMPT}\n\n"
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

    api_key = os.getenv("OPENAI_API_KEY")
    if api_key:
        try:
            from openai import OpenAI

            client = OpenAI(api_key=api_key)
            # If an API key exists, use the model-backed path first.
            completion = client.chat.completions.create(
                model=os.getenv("OPENAI_MODEL", "gpt-4.1-mini"),
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    *request.history,
                    {"role": "user", "content": prompt},
                ],
                temperature=0.2,
            )
            answer = completion.choices[0].message.content or ""
            return ChatResponse(answer=answer, sources=sources, used_rag=used_rag)
        except Exception:
            # Fall back to the local response so the demo still works offline.
            pass

    return ChatResponse(
        answer=local_answer(request.message, sources, used_rag),
        sources=sources,
        used_rag=used_rag,
    )
