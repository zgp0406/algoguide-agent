from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock
from typing import Any
from uuid import uuid4


BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
SESSIONS_JSON_PATH = DATA_DIR / "sessions.json"
SESSIONS_DB_PATH = DATA_DIR / "sessions_store.sqlite3"

_LOCK = RLock()
_INITIALIZED = False


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _short_title(text: str, limit: int = 24) -> str:
    cleaned = " ".join(text.strip().split())
    if len(cleaned) <= limit:
        return cleaned or "新对话"
    return f"{cleaned[: limit - 1]}…"


def _connect() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(SESSIONS_DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = MEMORY")
    conn.execute("PRAGMA synchronous = NORMAL")
    return conn


def _ensure_schema(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            sources_json TEXT,
            used_rag INTEGER,
            created_at TEXT NOT NULL,
            FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_messages_session_created
        ON messages(session_id, created_at, id)
        """
    )


def _normalize_message(message: sqlite3.Row) -> dict[str, Any]:
    result: dict[str, Any] = {
        "role": str(message["role"] or "assistant"),
        "content": str(message["content"] or ""),
        "created_at": str(message["created_at"] or _now()),
    }
    sources_json = message["sources_json"]
    if sources_json:
        try:
            sources = json.loads(str(sources_json))
        except Exception:
            sources = []
        if isinstance(sources, list) and sources:
            result["sources"] = [str(item) for item in sources if str(item)]
    used_rag = message["used_rag"]
    if used_rag is not None:
        result["used_rag"] = bool(used_rag)
    return result


def _normalize_session(session: sqlite3.Row, messages: list[dict[str, Any]]) -> dict[str, Any]:
    title = str(session["title"] or "").strip() or "新对话"
    session_id = str(session["id"] or "").strip() or uuid4().hex
    created_at = str(session["created_at"] or _now())
    updated_at = str(session["updated_at"] or created_at)
    return {
        "id": session_id,
        "title": title,
        "created_at": created_at,
        "updated_at": updated_at,
        "messages": messages,
    }


def _import_legacy_json(conn: sqlite3.Connection) -> None:
    if not SESSIONS_JSON_PATH.exists():
        return

    try:
        payload = json.loads(SESSIONS_JSON_PATH.read_text(encoding="utf-8"))
    except Exception:
        return

    sessions = payload.get("sessions") if isinstance(payload, dict) else None
    if not isinstance(sessions, list):
        return

    inserted = 0
    for raw_session in sessions:
        if not isinstance(raw_session, dict):
            continue

        session_id = str(raw_session.get("id") or "").strip() or uuid4().hex
        title = str(raw_session.get("title") or "").strip() or "新对话"
        created_at = str(raw_session.get("created_at") or _now())
        updated_at = str(raw_session.get("updated_at") or created_at)

        existing = conn.execute("SELECT 1 FROM sessions WHERE id = ?", (session_id,)).fetchone()
        if existing:
            continue

        conn.execute(
            "INSERT INTO sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
            (session_id, title, created_at, updated_at),
        )

        messages = raw_session.get("messages")
        if not isinstance(messages, list):
            continue

        for raw_message in messages:
            if not isinstance(raw_message, dict):
                continue

            role = str(raw_message.get("role") or "assistant")
            content = str(raw_message.get("content") or "")
            created_message_at = str(raw_message.get("created_at") or _now())

            sources = raw_message.get("sources")
            sources_json = None
            if isinstance(sources, list) and sources:
                sources_json = json.dumps([str(item) for item in sources if str(item)], ensure_ascii=False)

            used_rag = raw_message.get("used_rag")
            conn.execute(
                """
                INSERT INTO messages (session_id, role, content, sources_json, used_rag, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    session_id,
                    role,
                    content,
                    sources_json,
                    int(bool(used_rag)) if used_rag is not None else None,
                    created_message_at,
                ),
            )
        inserted += 1

    if inserted:
        conn.commit()


def _ensure_initialized() -> None:
    global _INITIALIZED
    if _INITIALIZED:
        return

    with _LOCK:
        if _INITIALIZED:
            return
        conn = _connect()
        try:
            _ensure_schema(conn)
            _import_legacy_json(conn)
            conn.commit()
        finally:
            conn.close()
        _INITIALIZED = True


def _save_session_turn(
    conn: sqlite3.Connection,
    session_id: str | None,
    *,
    role: str,
    content: str,
    sources: list[str] | None = None,
    used_rag: bool | None = None,
    title_hint: str | None = None,
) -> str:
    now = _now()
    resolved_session_id = session_id or uuid4().hex

    row = conn.execute("SELECT id, title, created_at FROM sessions WHERE id = ?", (resolved_session_id,)).fetchone()
    if row is None:
        title = _short_title(title_hint or content)
        conn.execute(
            "INSERT INTO sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
            (resolved_session_id, title, now, now),
        )
    else:
        title = str(row["title"] or "").strip() or "新对话"

    sources_json = None
    if sources:
        sources_json = json.dumps([str(item) for item in sources if str(item)], ensure_ascii=False)

    conn.execute(
        """
        INSERT INTO messages (session_id, role, content, sources_json, used_rag, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            resolved_session_id,
            role,
            content,
            sources_json,
            int(bool(used_rag)) if used_rag is not None else None,
            now,
        ),
    )

    if title == "新对话" and title_hint:
        title = _short_title(title_hint)
    elif role == "user":
        count_row = conn.execute(
            "SELECT COUNT(*) AS count FROM messages WHERE session_id = ?",
            (resolved_session_id,),
        ).fetchone()
        if count_row and int(count_row["count"]) == 1:
            title = _short_title(content)

    conn.execute(
        "UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?",
        (title, now, resolved_session_id),
    )
    return resolved_session_id


def list_sessions(limit: int = 10) -> list[dict[str, Any]]:
    _ensure_initialized()
    with _LOCK:
        conn = _connect()
        try:
            _ensure_schema(conn)
            rows = conn.execute(
                """
                SELECT
                    s.id,
                    s.title,
                    s.updated_at,
                    COUNT(m.id) AS message_count
                FROM sessions s
                LEFT JOIN messages m ON m.session_id = s.id
                GROUP BY s.id, s.title, s.updated_at
                ORDER BY s.updated_at DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
            return [
                {
                    "id": str(row["id"]),
                    "title": str(row["title"] or "新对话"),
                    "updated_at": str(row["updated_at"]),
                    "message_count": int(row["message_count"] or 0),
                }
                for row in rows
            ]
        finally:
            conn.close()


def get_session(session_id: str) -> dict[str, Any] | None:
    _ensure_initialized()
    with _LOCK:
        conn = _connect()
        try:
            _ensure_schema(conn)
            session = conn.execute(
                "SELECT id, title, created_at, updated_at FROM sessions WHERE id = ?",
                (session_id,),
            ).fetchone()
            if session is None:
                return None

            message_rows = conn.execute(
                """
                SELECT role, content, sources_json, used_rag, created_at
                FROM messages
                WHERE session_id = ?
                ORDER BY created_at ASC, id ASC
                """,
                (session_id,),
            ).fetchall()
            messages = [_normalize_message(row) for row in message_rows]
            return _normalize_session(session, messages)
        finally:
            conn.close()


def _get_session_unlocked(conn: sqlite3.Connection, session_id: str) -> dict[str, Any] | None:
    session = conn.execute(
        "SELECT id, title, created_at, updated_at FROM sessions WHERE id = ?",
        (session_id,),
    ).fetchone()
    if session is None:
        return None

    message_rows = conn.execute(
        """
        SELECT role, content, sources_json, used_rag, created_at
        FROM messages
        WHERE session_id = ?
        ORDER BY created_at ASC, id ASC
        """,
        (session_id,),
    ).fetchall()
    messages = [_normalize_message(row) for row in message_rows]
    return _normalize_session(session, messages)


def upsert_session_message(
    session_id: str | None,
    *,
    role: str,
    content: str,
    sources: list[str] | None = None,
    used_rag: bool | None = None,
    title_hint: str | None = None,
) -> dict[str, Any]:
    _ensure_initialized()
    with _LOCK:
        conn = _connect()
        try:
            _ensure_schema(conn)
            resolved_session_id = _save_session_turn(
                conn,
                session_id,
                role=role,
                content=content,
                sources=sources,
                used_rag=used_rag,
                title_hint=title_hint,
            )
            conn.commit()
            session = _get_session_unlocked(conn, resolved_session_id)
            if session is None:
                raise RuntimeError("Failed to load session after saving")
            return session
        finally:
            conn.close()


def append_turn(
    session_id: str | None,
    *,
    user_message: str,
    assistant_message: str,
    assistant_sources: list[str] | None = None,
    assistant_used_rag: bool | None = None,
) -> dict[str, Any]:
    _ensure_initialized()
    with _LOCK:
        conn = _connect()
        try:
            _ensure_schema(conn)
            resolved_session_id = _save_session_turn(
                conn,
                session_id,
                role="user",
                content=user_message,
                title_hint=user_message,
            )
            _save_session_turn(
                conn,
                resolved_session_id,
                role="assistant",
                content=assistant_message,
                sources=assistant_sources,
                used_rag=assistant_used_rag,
            )
            conn.commit()
        finally:
            conn.close()

    session = get_session(resolved_session_id)
    if session is None:
        raise RuntimeError("Failed to load session after append")
    return session


_ensure_initialized()
