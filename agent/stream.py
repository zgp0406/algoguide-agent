from __future__ import annotations

from collections.abc import Iterator
from time import monotonic

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
from agent.sessions import get_session
from agent.telemetry import log_event


def stream_chat(request: ChatRequest) -> Iterator[bytes]:
    started_at = monotonic()
    (
        context,
        sources,
        evidence,
        used_rag,
        knowledge_base,
        rag_confidence,
        retrieval_mode,
        low_confidence_reason,
    ) = build_context(request.message)
    existing_session = get_session(request.session_id) if request.session_id else None
    session_summary = str(existing_session.get("summary") or "") if existing_session else ""
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
                sources=sources,
                evidence=evidence,
                used_rag=used_rag,
                knowledge_base=knowledge_base,
                rag_confidence=rag_confidence,
                retrieval_mode=retrieval_mode,
                low_confidence_reason=low_confidence_reason,
                ready=False,
                session_id=session_id,
                error=meta_error,
                error_type=meta_error_type,
                error_message=meta_error_message,
            ),
        )
        for chunk in _chunk_text(answer):
            yield _sse_event("delta", {"text": chunk})
        saved_session_id, answer_storage_error = _save_answer_message(
            session_id,
            content=answer,
            sources=sources,
            evidence=evidence,
            used_rag=used_rag,
        )
        session = get_session(saved_session_id)
        if answer_storage_error:
            raw_error = answer_storage_error if not meta_error else f"{meta_error}; {answer_storage_error}"
            meta_error, meta_error_type, meta_error_message = _error_payload(raw_error)
        log_event(
            "chat.fallback",
            mode="stream_local",
            used_rag=used_rag,
            source_count=len(sources),
            elapsed_ms=round((monotonic() - started_at) * 1000, 2),
            session_id=saved_session_id,
            error_type=meta_error_type,
        )
        yield _sse_event(
            "done",
            {
                "answer": answer,
                **_build_meta_payload(
                    sources=sources,
                    evidence=evidence,
                    used_rag=used_rag,
                    knowledge_base=knowledge_base,
                    rag_confidence=rag_confidence,
                    retrieval_mode=retrieval_mode,
                    low_confidence_reason=low_confidence_reason,
                    ready=False,
                    session_id=saved_session_id,
                    error=meta_error,
                    error_type=meta_error_type,
                    error_message=meta_error_message,
                    session=_session_summary(session) if session else None,
                ),
            },
        )
        return

    generation_request = GenerationRequest(
        question=request.message,
        context=context,
        history=_compact_history(request.history),
        session_summary=session_summary,
    )

    try:
        meta_error, meta_error_type, meta_error_message = _error_payload(storage_error)
        yield _sse_event(
            "meta",
            _build_meta_payload(
                sources=sources,
                evidence=evidence,
                used_rag=used_rag,
                knowledge_base=knowledge_base,
                rag_confidence=rag_confidence,
                retrieval_mode=retrieval_mode,
                low_confidence_reason=low_confidence_reason,
                ready=True,
                session_id=session_id,
                error=meta_error,
                error_type=meta_error_type,
                error_message=meta_error_message,
            ),
        )
        model_started_at = monotonic()
        answer_parts: list[str] = []
        backend = create_backend()
        for chunk in backend.stream(generation_request):
            answer_parts.append(chunk)
            yield _sse_event("delta", {"text": chunk})
        model_elapsed_ms = round((monotonic() - model_started_at) * 1000, 2)
        answer = "".join(answer_parts)
        saved_session_id, answer_storage_error = _save_answer_message(
            session_id,
            content=answer,
            sources=sources,
            evidence=evidence,
            used_rag=used_rag,
        )
        session = get_session(saved_session_id)
        if answer_storage_error:
            raw_error = answer_storage_error if not meta_error else f"{meta_error}; {answer_storage_error}"
            meta_error, meta_error_type, meta_error_message = _error_payload(raw_error)
        log_event(
            "chat.completed",
            mode="stream",
            used_rag=used_rag,
            source_count=len(sources),
            model_elapsed_ms=model_elapsed_ms,
            elapsed_ms=round((monotonic() - started_at) * 1000, 2),
            session_id=saved_session_id,
            error_type=meta_error_type,
        )
        yield _sse_event(
            "done",
            {
                "answer": answer,
                **_build_meta_payload(
                    sources=sources,
                    evidence=evidence,
                    used_rag=used_rag,
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
            },
        )
    except Exception as exc:
        # If the provider refuses streaming, fall back to a normal completion and chunk locally.
        try:
            answer = create_backend().generate(generation_request).answer
        except Exception:
            answer = local_answer(request.message, sources, used_rag, evidence)
        saved_session_id, answer_storage_error = _save_answer_message(
            session_id,
            content=answer,
            sources=sources,
            evidence=evidence,
            used_rag=used_rag,
        )
        session = get_session(saved_session_id)
        raw_error = _error_text(exc)
        if storage_error:
            raw_error = f"{raw_error}; StorageError: {storage_error}"
        if answer_storage_error:
            raw_error = f"{raw_error}; StorageError: {answer_storage_error}"
        error_text, error_type, error_message = _error_payload(raw_error)
        log_event(
            "chat.fallback",
            mode="stream",
            used_rag=used_rag,
            source_count=len(sources),
            elapsed_ms=round((monotonic() - started_at) * 1000, 2),
            session_id=saved_session_id,
            error_type=error_type,
            error=error_text,
        )
        yield _sse_event(
            "meta",
            _build_meta_payload(
                sources=sources,
                evidence=evidence,
                used_rag=used_rag,
                knowledge_base=knowledge_base,
                rag_confidence=rag_confidence,
                retrieval_mode=retrieval_mode,
                low_confidence_reason=low_confidence_reason,
                ready=False,
                session_id=saved_session_id,
                error=error_text,
                error_type=error_type,
                error_message=error_message,
                session=_session_summary(session) if session else None,
            ),
        )
        for chunk in _chunk_text(answer):
            yield _sse_event("delta", {"text": chunk})
        yield _sse_event(
            "done",
            {
                "answer": answer,
                **_build_meta_payload(
                    sources=sources,
                    evidence=evidence,
                    used_rag=used_rag,
                    knowledge_base=knowledge_base,
                    rag_confidence=rag_confidence,
                    retrieval_mode=retrieval_mode,
                    low_confidence_reason=low_confidence_reason,
                    ready=False,
                    session_id=saved_session_id,
                    error=error_text,
                    error_type=error_type,
                    error_message=error_message,
                    session=_session_summary(session) if session else None,
                ),
            },
        )
