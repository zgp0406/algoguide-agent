from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from agent.chain import ChatRequest, chat


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


# Keep the frontend as the site root so the app opens directly in the browser.
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
