from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles

from agent.chain import ChatRequest, chat, get_api_status, get_session_detail, list_recent_sessions, stream_chat


BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"


app = FastAPI(title="AlgoGuide Agent", version="0.1.0")

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


# Keep the frontend as the site root so the app opens directly in the browser.
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
