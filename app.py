from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from agent.chain import ChatRequest, chat, get_api_status, get_session_detail, list_recent_sessions, stream_chat
from agent.sessions import delete_session, update_session_title
from knowledge.library import BUILTIN_KB_ID, create_upload_draft, confirm_upload_draft, list_knowledge_bases


BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"


app = FastAPI(title="AlgoGuide Agent", version="0.1.0")


class SessionTitleUpdateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=80)


class KnowledgeConfirmRequest(BaseModel):
    draft_id: str = Field(min_length=1)
    knowledge_base_id: str | None = None
    knowledge_base_name: str | None = Field(default=None, max_length=80)


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


@app.post("/api/knowledge/upload")
async def knowledge_upload_api(
    file: UploadFile = File(...),
    knowledge_base_id: str | None = Form(default=None),
    knowledge_base_name: str | None = Form(default=None),
) -> dict[str, object]:
    try:
        file_bytes = await file.read()
        if not file_bytes:
            raise HTTPException(status_code=400, detail="文件为空")
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


# Keep the frontend as the site root so the app opens directly in the browser.
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
