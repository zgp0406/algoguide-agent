from __future__ import annotations

import os
import sys
from pathlib import Path

from agent.chat import _api_config
from agent.sessions import SESSIONS_DB_PATH, list_sessions


BASE_DIR = Path(__file__).resolve().parent.parent
KNOWLEDGE_DIR = BASE_DIR / "knowledge"
FAISS_INDEX_PATH = KNOWLEDGE_DIR / "index.faiss"
META_PATH = KNOWLEDGE_DIR / "index_meta.json"


def _check_api() -> dict[str, object]:
    api_key, model, base_url = _api_config()
    return {
        "key_configured": bool(api_key),
        "model": model,
        "base_url": base_url,
    }


def _check_retrieval() -> dict[str, object]:
    embedding_model = os.getenv(
        "EMBEDDING_MODEL_NAME",
        "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
    )
    faiss_exists = FAISS_INDEX_PATH.exists()
    meta_exists = META_PATH.exists()

    try:
        import json
        if meta_exists:
            meta = json.loads(META_PATH.read_text(encoding="utf-8"))
            chunks = meta.get("chunks", []) if isinstance(meta, dict) else []
            chunk_count = len(chunks) if isinstance(chunks, list) else 0
        else:
            chunk_count = 0
    except Exception:
        chunk_count = -1

    try:
        import sentence_transformers  # noqa: F401
        embedding_available = True
    except ImportError:
        embedding_available = False

    try:
        import faiss  # noqa: F401
        faiss_available = True
    except ImportError:
        faiss_available = False

    return {
        "embedding_model": embedding_model,
        "embedding_library_available": embedding_available,
        "faiss_library_available": faiss_available,
        "faiss_index_exists": faiss_exists,
        "faiss_chunk_count": chunk_count,
        "meta_index_exists": meta_exists,
    }


def _check_knowledge() -> dict[str, object]:
    try:
        from knowledge.library import list_knowledge_bases

        kbs = list_knowledge_bases()
        kb_count = len(kbs)
        doc_count = sum(int(kb.get("document_count", 0)) for kb in kbs)
        chunk_count = sum(int(kb.get("chunk_count", 0)) for kb in kbs)
        return {
            "knowledge_base_count": kb_count,
            "total_document_count": doc_count,
            "total_chunk_count": chunk_count,
        }
    except Exception as exc:
        return {
            "knowledge_base_count": -1,
            "total_document_count": -1,
            "total_chunk_count": -1,
            "error": str(exc),
        }


def _check_storage() -> dict[str, object]:
    try:
        import sqlite3

        conn = sqlite3.connect(str(SESSIONS_DB_PATH))
        conn.execute("SELECT 1")
        conn.close()
        sqlite_writable = True
    except Exception:
        sqlite_writable = False

    try:
        sessions = list_sessions(limit=1000)
        session_count = len(sessions)
    except Exception:
        session_count = -1

    return {
        "sqlite_writable": sqlite_writable,
        "session_count": session_count,
        "sessions_db_path": str(SESSIONS_DB_PATH),
    }


def _check_ocr() -> dict[str, object]:
    tesseract_cmd = os.getenv("TESSERACT_CMD", "").strip()

    try:
        import pytesseract  # noqa: F401
        from PIL import Image  # noqa: F401
        import fitz  # noqa: F401

        ocr_libs_available = True
    except ImportError:
        ocr_libs_available = False

    tesseract_configured = bool(tesseract_cmd)
    ocr_lang = os.getenv("OCR_LANG", "chi_sim+eng")

    return {
        "available": ocr_libs_available,
        "tesseract_cmd_configured": tesseract_configured,
        "tesseract_cmd": tesseract_cmd or "(system default)",
        "ocr_lang": ocr_lang,
        "tessdata_prefix": os.getenv("TESSDATA_PREFIX", ""),
    }


def _check_system() -> dict[str, object]:
    return {
        "python_version": sys.version.split()[0],
        "platform": sys.platform,
    }


def run_diagnostics() -> dict[str, object]:
    results: dict[str, object] = {}

    for name, check_fn in [
        ("api", _check_api),
        ("retrieval", _check_retrieval),
        ("knowledge", _check_knowledge),
        ("storage", _check_storage),
        ("ocr", _check_ocr),
        ("system", _check_system),
    ]:
        try:
            results[name] = check_fn()
        except Exception as exc:
            results[name] = {"error": f"{exc.__class__.__name__}: {exc}"}

    return results
