from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from agent.chain import ChatRequest, chat, get_api_status, get_session_detail, list_recent_sessions, stream_chat
from agent.sessions import delete_session, update_session_title
from knowledge.library import (
    BUILTIN_KB_ID,
    cancel_upload_draft,
    confirm_upload_draft,
    create_upload_draft,
    delete_document,
    delete_knowledge_base,
    get_document_detail,
    list_documents_for_knowledge_base,
    list_knowledge_bases,
    rename_knowledge_base,
    update_document,
)


BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
DEFAULT_UPLOAD_MAX_BYTES = 50 * 1024 * 1024
MULTIPART_OVERHEAD_ALLOWANCE_BYTES = 1024 * 1024


app = FastAPI(title="AlgoGuide Agent", version="0.1.0")


class SessionTitleUpdateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=80)


class KnowledgeConfirmRequest(BaseModel):
    draft_id: str = Field(min_length=1)
    knowledge_base_id: str | None = None
    knowledge_base_name: str | None = Field(default=None, max_length=80)


class KnowledgeDraftCancelRequest(BaseModel):
    draft_id: str = Field(min_length=1)


class KnowledgeBaseUpdateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class KnowledgeDocumentUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=120)
    text: str | None = Field(default=None, min_length=1)


def _upload_max_bytes() -> int:
    raw_value = os.getenv("UPLOAD_MAX_BYTES", "").strip()
    if not raw_value:
        return DEFAULT_UPLOAD_MAX_BYTES
    try:
        value = int(raw_value)
    except ValueError:
        return DEFAULT_UPLOAD_MAX_BYTES
    return value if value > 0 else DEFAULT_UPLOAD_MAX_BYTES


def _format_size(bytes_count: int) -> str:
    if bytes_count >= 1024 * 1024:
        return f"{bytes_count / 1024 / 1024:.0f}MB"
    if bytes_count >= 1024:
        return f"{bytes_count / 1024:.0f}KB"
    return f"{bytes_count}B"


def _reject_oversized_upload(bytes_count: int, *, multipart_body: bool = False) -> None:
    max_bytes = _upload_max_bytes()
    allowance = MULTIPART_OVERHEAD_ALLOWANCE_BYTES if multipart_body else 0
    if bytes_count <= max_bytes + allowance:
        return
    raise HTTPException(
        status_code=413,
        detail=f"文件过大，当前上传限制为 {_format_size(max_bytes)}。请压缩文件或拆分后再上传。",
    )


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/chat")
def chat_api(request: ChatRequest) -> dict[str, object]:
    result = chat(request)
    return result.model_dump()


@app.post("/api/chat/stream")
def chat_stream_api(request: ChatRequest) -> StreamingResponse:
    return StreamingResponse(
        stream_chat(request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/api/status")
def api_status() -> dict[str, object]:
    return get_api_status().model_dump()


@app.get("/api/sessions")
def sessions_api(limit: int = 10) -> dict[str, object]:
    return {"sessions": list_recent_sessions(limit=limit)}


@app.get("/api/sessions/{session_id}")
def session_detail_api(session_id: str) -> dict[str, object]:
    return {"session": get_session_detail(session_id)}


@app.put("/api/sessions/{session_id}/title")
def session_title_api(session_id: str, request: SessionTitleUpdateRequest) -> dict[str, object]:
    session = update_session_title(session_id, request.title)
    return {"session": session}


@app.delete("/api/sessions/{session_id}")
def session_delete_api(session_id: str) -> dict[str, object]:
    deleted = delete_session(session_id)
    return {"deleted": deleted, "session_id": session_id}


@app.get("/api/knowledge-bases")
def knowledge_bases_api() -> dict[str, object]:
    return {
        "knowledge_bases": list_knowledge_bases(),
        "default_knowledge_base_id": BUILTIN_KB_ID,
    }


@app.get("/api/knowledge-bases/{knowledge_base_id}/documents")
def knowledge_base_documents_api(knowledge_base_id: str) -> dict[str, object]:
    return {
        "knowledge_base_id": knowledge_base_id,
        "documents": list_documents_for_knowledge_base(knowledge_base_id),
    }


@app.put("/api/knowledge-bases/{knowledge_base_id}")
def knowledge_base_update_api(knowledge_base_id: str, request: KnowledgeBaseUpdateRequest) -> dict[str, object]:
    try:
        return rename_knowledge_base(knowledge_base_id, request.name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.delete("/api/knowledge-bases/{knowledge_base_id}")
def knowledge_base_delete_api(knowledge_base_id: str) -> dict[str, object]:
    try:
        return delete_knowledge_base(knowledge_base_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/knowledge-documents/{document_id}")
def knowledge_document_detail_api(document_id: str) -> dict[str, object]:
    document = get_document_detail(document_id)
    if not document:
        raise HTTPException(status_code=404, detail="文档不存在")
    return {"document": document}


@app.put("/api/knowledge-documents/{document_id}")
def knowledge_document_update_api(document_id: str, request: KnowledgeDocumentUpdateRequest) -> dict[str, object]:
    try:
        return update_document(document_id, title=request.title, text=request.text)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.delete("/api/knowledge-documents/{document_id}")
def knowledge_document_delete_api(document_id: str) -> dict[str, object]:
    try:
        return delete_document(document_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/knowledge/upload")
async def knowledge_upload_api(
    request: Request,
    file: UploadFile = File(...),
    knowledge_base_id: str | None = Form(default=None),
    knowledge_base_name: str | None = Form(default=None),
) -> dict[str, object]:
    try:
        content_length = request.headers.get("content-length")
        if content_length and content_length.isdigit():
            _reject_oversized_upload(int(content_length), multipart_body=True)

        file_bytes = await file.read()
        if not file_bytes:
            raise HTTPException(status_code=400, detail="文件为空")
        _reject_oversized_upload(len(file_bytes))

        draft = create_upload_draft(
            file_name=file.filename or "upload",
            file_bytes=file_bytes,
            knowledge_base_id=knowledge_base_id,
            knowledge_base_name=knowledge_base_name,
        )
        return {
            "draft": draft,
            "knowledge_bases": list_knowledge_bases(),
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/knowledge/confirm")
def knowledge_confirm_api(request: KnowledgeConfirmRequest) -> dict[str, object]:
    try:
        result = confirm_upload_draft(
            draft_id=request.draft_id,
            knowledge_base_id=request.knowledge_base_id,
            knowledge_base_name=request.knowledge_base_name,
        )
        return result
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/knowledge/cancel")
def knowledge_cancel_api(request: KnowledgeDraftCancelRequest) -> dict[str, object]:
    try:
        return cancel_upload_draft(draft_id=request.draft_id)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# Keep the frontend as the site root so the app opens directly in the browser.
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
