from __future__ import annotations

import json
from collections.abc import Iterator
from time import monotonic
from uuid import uuid4

from agent.backends.base import GenerationRequest
from agent.backends.factory import create_backend
from agent.chat import (
    _api_config,
    _build_meta_payload,
    _chunk_text,
    _compact_history,
    _error_payload,
    _error_text,
    _save_answer_message,
    _save_user_message,
    _session_summary,
    _sse_event,
    ChatRequest,
    local_answer,
)
from agent.context import build_context
from agent.prompt import AGENT_SYSTEM_PROMPT
from agent.sessions import get_session
from agent.telemetry import log_event
from agent.tools import execute_tool, get_tool_definitions

_MAX_AGENT_STEPS = 5


def _build_agent_messages(
    question: str,
    history: list[dict[str, str]],
    session_summary: str,
    context: str,
) -> list[dict[str, object]]:
    """构建 Agent 模式的初始消息列表。"""
    messages: list[dict[str, object]] = [
        {"role": "system", "content": AGENT_SYSTEM_PROMPT},
    ]
    if session_summary.strip():
        messages.append(
            {"role": "system", "content": f"会话摘要：{session_summary.strip()}"}
        )
    # 将检索到的上下文作为第一条 system 知识注入
    if context.strip():
        messages.append(
            {
                "role": "system",
                "content": f"预检索到的知识库资料（你仍可调用 search_knowledge 进一步搜索）：\n{context}",
            }
        )
    messages.extend(history)
    messages.append({"role": "user", "content": question})
    return messages


def agent_chat(request: ChatRequest) -> Iterator[bytes]:
    """ReAct Agent 主循环：以 SSE 流形式产出 think / tool_call / tool_result / delta / done 事件。

    与 stream_chat() 的区别：
    - 检索不再是固定的预处理步骤，而是 LLM 可调用的工具
    - LLM 在循环中多次调用，每次可决定"调工具"或"生成最终答案"
    - 每个步骤都作为 SSE 事件流式发送给前端
    """
    started_at = monotonic()
    session_id = request.session_id

    # 预检索——作为初始上下文注入，减少不必要的工具调用
    context, sources, evidence, used_rag, knowledge_base, rag_confidence, retrieval_mode, low_confidence_reason = (
        build_context(request.message)
    )
    existing_session = get_session(session_id) if session_id else None
    session_summary = str(existing_session.get("summary") or "") if existing_session else ""

    # 保存用户消息
    session_id, storage_error = _save_user_message(
        request.session_id,
        content=request.message,
        title_hint=request.message,
    )

    api_key, _, _ = _api_config()
    if not api_key:
        answer = local_answer(request.message, sources, used_rag, evidence)
        raw_error = "Missing OPENAI_API_KEY"
        if storage_error:
            raw_error = f"{raw_error}; StorageError: {storage_error}"
        meta_error, meta_error_type, meta_error_message = _error_payload(raw_error)
        yield _sse_event(
            "meta",
            _build_meta_payload(
                sources=sources, evidence=evidence, used_rag=used_rag,
                knowledge_base=knowledge_base, rag_confidence=rag_confidence,
                retrieval_mode=retrieval_mode, low_confidence_reason=low_confidence_reason,
                ready=False, session_id=session_id,
                error=meta_error, error_type=meta_error_type, error_message=meta_error_message,
            ),
        )
        for chunk in _chunk_text(answer):
            yield _sse_event("delta", {"text": chunk})
        saved_session_id, _ = _save_answer_message(session_id, content=answer, sources=sources, evidence=evidence, used_rag=used_rag)
        session = get_session(saved_session_id)
        yield _sse_event("done", {
            "answer": answer,
            **_build_meta_payload(
                sources=sources, evidence=evidence, used_rag=used_rag,
                knowledge_base=knowledge_base, rag_confidence=rag_confidence,
                retrieval_mode=retrieval_mode, low_confidence_reason=low_confidence_reason,
                ready=False, session_id=saved_session_id, error=meta_error,
                error_type=meta_error_type, error_message=meta_error_message,
                session=_session_summary(session) if session else None,
            ),
        })
        return

    # 发送 meta（预检索结果）
    meta_error, meta_error_type, meta_error_message = _error_payload(storage_error)
    yield _sse_event(
        "meta",
        _build_meta_payload(
            sources=sources, evidence=evidence, used_rag=used_rag,
            knowledge_base=knowledge_base, rag_confidence=rag_confidence,
            retrieval_mode=retrieval_mode, low_confidence_reason=low_confidence_reason,
            ready=True, session_id=session_id,
            error=meta_error, error_type=meta_error_type, error_message=meta_error_message,
        ),
    )

    # 构建 Agent 消息
    messages = _build_agent_messages(
        request.message,
        _compact_history(request.history),
        session_summary,
        context,
    )
    tools = get_tool_definitions()
    backend = create_backend()

    # ── Agent 循环 ─────────────────────────────────────────────
    final_answer = ""
    tools_called: list[str] = []
    all_sources = list(sources)
    all_evidence = list(evidence)

    try:
        for step in range(_MAX_AGENT_STEPS):
            yield _sse_event("think", {"text": f"正在思考第 {step + 1} 步..."})

            try:
                response = backend.generate_with_tools(messages, tools)
            except Exception as exc:
                # LLM 调用失败——回退到预检索结果
                log_event("agent.error", step=step, error=_error_text(exc))
                break

            if response.type == "text":
                final_answer = response.content
                for chunk in _chunk_text(final_answer):
                    yield _sse_event("delta", {"text": chunk})
                break

            if response.type == "tool_calls":
                # 将 assistant 的 tool_calls 消息加入历史
                assistant_tc_msg: dict[str, object] = {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": tc.id,
                            "type": "function",
                            "function": {"name": tc.name, "arguments": json.dumps(tc.arguments, ensure_ascii=False)},
                        }
                        for tc in response.tool_calls
                    ],
                }
                messages.append(assistant_tc_msg)

                for tc in response.tool_calls:
                    # 通知前端
                    yield _sse_event("tool_call", {
                        "name": tc.name,
                        "arguments": tc.arguments,
                        "step": step + 1,
                    })

                    # 执行工具
                    tool_started = monotonic()
                    try:
                        result = execute_tool(tc.name, tc.arguments)
                    except Exception as exc:
                        result = {"error": f"工具执行异常: {exc}"}
                    tool_elapsed_ms = round((monotonic() - tool_started) * 1000, 2)

                    yield _sse_event("tool_result", {
                        "name": tc.name,
                        "result": result,
                        "elapsed_ms": tool_elapsed_ms,
                    })

                    tools_called.append(tc.name)

                    # 收集 search_knowledge 的额外来源
                    if tc.name == "search_knowledge" and "results" in result:
                        for r in result.get("results", []):
                            src = str(r.get("source", ""))
                            if src and src not in all_sources:
                                all_sources.append(src)
                            all_evidence.append({
                                "source": src,
                                "excerpt": str(r.get("text", ""))[:160],
                                "knowledge_base_name": str(r.get("knowledge_base_name", "")),
                                "location": str(r.get("location", "")),
                                "score": r.get("score"),
                            })

                    # 将 tool 结果加入消息历史
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": json.dumps(result, ensure_ascii=False),
                    })

                    log_event(
                        "agent.tool_executed",
                        tool_name=tc.name,
                        step=step + 1,
                        elapsed_ms=tool_elapsed_ms,
                        session_id=session_id,
                    )
        else:
            # 达到最大步数——强制 LLM 生成最终回答
            yield _sse_event("think", {"text": "已达到最大步数，正在汇总..."})
            messages.append({
                "role": "user",
                "content": "请基于以上所有工具调用结果，给出最终的结构化回答。不要继续调用工具。",
            })
            try:
                final_response = backend.generate_with_tools(messages, [])
                final_answer = final_response.content
            except Exception:
                final_answer = "抱歉，Agent 处理超时。请尝试简化你的问题。"
            for chunk in _chunk_text(final_answer):
                yield _sse_event("delta", {"text": chunk})

    except Exception as exc:
        if not final_answer:
            final_answer = local_answer(request.message, all_sources, bool(all_sources), all_evidence)

    # 保存回答到会话
    saved_session_id, answer_storage_error = _save_answer_message(
        session_id,
        content=final_answer,
        sources=all_sources,
        evidence=all_evidence,
        used_rag=bool(all_sources),
    )
    session = get_session(saved_session_id)

    if answer_storage_error:
        meta_error = answer_storage_error if not meta_error else f"{meta_error}; {answer_storage_error}"
        meta_error, meta_error_type, meta_error_message = _error_payload(meta_error)

    log_event(
        "agent.completed",
        tools_called=len(tools_called),
        tool_names=", ".join(tools_called),
        elapsed_ms=round((monotonic() - started_at) * 1000, 2),
        session_id=saved_session_id,
    )

    yield _sse_event("done", {
        "answer": final_answer,
        "tools_called": tools_called,
        **_build_meta_payload(
            sources=all_sources,
            evidence=all_evidence[-10:] if len(all_evidence) > 10 else all_evidence,
            used_rag=bool(all_sources),
            knowledge_base=knowledge_base,
            rag_confidence=rag_confidence,
            retrieval_mode=retrieval_mode,
            low_confidence_reason=low_confidence_reason,
            ready=True,
            session_id=saved_session_id,
            error=meta_error,
            error_type=meta_error_type,
            error_message=meta_error_message,
            session=_session_summary(session) if session else None,
        ),
    })
