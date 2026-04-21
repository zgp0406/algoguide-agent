from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any
from uuid import uuid4


BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
SESSIONS_PATH = DATA_DIR / "sessions.json"

_LOCK = Lock()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _short_title(text: str, limit: int = 24) -> str:
    cleaned = " ".join(text.strip().split())
    if len(cleaned) <= limit:
        return cleaned or "新对话"
    return f"{cleaned[: limit - 1]}…"


def _default_store() -> dict[str, list[dict[str, Any]]]:
    return {"sessions": []}


def _read_store() -> dict[str, list[dict[str, Any]]]:
    if not SESSIONS_PATH.exists():
        return _default_store()
    try:
        payload = json.loads(SESSIONS_PATH.read_text(encoding="utf-8"))
    except Exception:
        return _default_store()
    if not isinstance(payload, dict):
        return _default_store()
    sessions = payload.get("sessions")
    if not isinstance(sessions, list):
        return _default_store()
    return {"sessions": sessions}


def _write_store(store: dict[str, list[dict[str, Any]]]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp_path = SESSIONS_PATH.with_name(f"{SESSIONS_PATH.name}.tmp")
    tmp_path.write_text(json.dumps(store, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp_path.replace(SESSIONS_PATH)


def _normalize_message(message: dict[str, Any]) -> dict[str, Any]:
    role = str(message.get("role") or "assistant")
    content = str(message.get("content") or "")
    result: dict[str, Any] = {"role": role, "content": content}

    sources = message.get("sources")
    if isinstance(sources, list) and sources:
        result["sources"] = [str(item) for item in sources if str(item)]

    if "used_rag" in message:
        result["used_rag"] = bool(message.get("used_rag"))

    created_at = message.get("created_at")
    if isinstance(created_at, str) and created_at:
        result["created_at"] = created_at

    return result


def _normalize_session(session: dict[str, Any]) -> dict[str, Any]:
    messages = session.get("messages")
    if not isinstance(messages, list):
        messages = []

    normalized_messages = []
    for message in messages:
        if isinstance(message, dict):
            normalized_messages.append(_normalize_message(message))

    title = str(session.get("title") or "").strip() or "新对话"
    session_id = str(session.get("id") or "").strip() or uuid4().hex
    created_at = str(session.get("created_at") or _now())
    updated_at = str(session.get("updated_at") or created_at)

    return {
        "id": session_id,
        "title": title,
        "created_at": created_at,
        "updated_at": updated_at,
        "messages": normalized_messages,
    }


def _load_sessions() -> list[dict[str, Any]]:
    store = _read_store()
    sessions = []
    for session in store["sessions"]:
        if isinstance(session, dict):
            sessions.append(_normalize_session(session))
    return sessions


def _save_sessions(sessions: list[dict[str, Any]]) -> None:
    _write_store({"sessions": sessions})


def list_sessions(limit: int = 10) -> list[dict[str, Any]]:
    with _LOCK:
        sessions = _load_sessions()

    sessions.sort(key=lambda item: item["updated_at"], reverse=True)
    summaries: list[dict[str, Any]] = []
    for session in sessions[:limit]:
        summaries.append(
            {
                "id": session["id"],
                "title": session["title"],
                "updated_at": session["updated_at"],
                "message_count": len(session["messages"]),
            }
        )
    return summaries


def get_session(session_id: str) -> dict[str, Any] | None:
    with _LOCK:
        sessions = _load_sessions()

    for session in sessions:
        if session["id"] == session_id:
            return session
    return None


def upsert_session_message(
    session_id: str | None,
    *,
    role: str,
    content: str,
    sources: list[str] | None = None,
    used_rag: bool | None = None,
    title_hint: str | None = None,
) -> dict[str, Any]:
    with _LOCK:
        sessions = _load_sessions()
        session = None
        if session_id:
            for item in sessions:
                if item["id"] == session_id:
                    session = item
                    break

        if session is None:
            session = {
                "id": session_id or uuid4().hex,
                "title": _short_title(title_hint or content),
                "created_at": _now(),
                "updated_at": _now(),
                "messages": [],
            }
            sessions.append(session)

        message_record: dict[str, Any] = {
            "role": role,
            "content": content,
            "created_at": _now(),
        }
        if sources:
            message_record["sources"] = [str(item) for item in sources if str(item)]
        if used_rag is not None:
            message_record["used_rag"] = bool(used_rag)

        session["messages"].append(message_record)
        session["updated_at"] = _now()

        if session.get("title") == "新对话" and title_hint:
            session["title"] = _short_title(title_hint)
        elif role == "user" and len(session["messages"]) == 1:
            session["title"] = _short_title(content)

        _save_sessions(sessions)
        return _normalize_session(session)


def append_turn(
    session_id: str | None,
    *,
    user_message: str,
    assistant_message: str,
    assistant_sources: list[str] | None = None,
    assistant_used_rag: bool | None = None,
) -> dict[str, Any]:
    session = upsert_session_message(
        session_id,
        role="user",
        content=user_message,
        title_hint=user_message,
    )
    session = upsert_session_message(
        session["id"],
        role="assistant",
        content=assistant_message,
        sources=assistant_sources,
        used_rag=assistant_used_rag,
    )
    return session
