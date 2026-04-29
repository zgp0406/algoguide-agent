from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from knowledge.embeddings import DEFAULT_EMBEDDING_MODEL_NAME, embed_text, resolve_model_name


BASE_DIR = Path(__file__).resolve().parent.parent
KNOWLEDGE_DIR = BASE_DIR / "knowledge"
FAISS_INDEX_PATH = KNOWLEDGE_DIR / "index.faiss"
META_PATH = KNOWLEDGE_DIR / "index_meta.json"
LEGACY_INDEX_PATH = KNOWLEDGE_DIR / "index.json"
TOKEN_RE = re.compile(r"[A-Za-z0-9\u4e00-\u9fff]+")


@dataclass
class KnowledgeChunk:
    source: str
    text: str


@dataclass
class KnowledgeStore:
    chunks: list[KnowledgeChunk]
    model_name: str
    faiss_index: Any | None = None
    signature: tuple[float, float] | None = None


def _load_meta() -> tuple[list[KnowledgeChunk], str]:
    source_path = META_PATH if META_PATH.exists() else LEGACY_INDEX_PATH
    if not source_path.exists():
        return [], resolve_model_name(DEFAULT_EMBEDDING_MODEL_NAME)

    payload = json.loads(source_path.read_text(encoding="utf-8"))
    if isinstance(payload, dict):
        model_name = resolve_model_name(str(payload.get("model_name") or ""))
        items = payload.get("chunks")
    else:
        model_name = resolve_model_name(DEFAULT_EMBEDDING_MODEL_NAME)
        items = payload

    if not isinstance(items, list):
        return [], model_name

    chunks: list[KnowledgeChunk] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        source = str(item.get("source") or "").strip()
        text = str(item.get("text") or "").strip()
        if source and text:
            chunks.append(KnowledgeChunk(source=source, text=text))
    return chunks, model_name


def _load_faiss_index() -> Any | None:
    if not FAISS_INDEX_PATH.exists():
        return None

    try:
        import faiss
    except ImportError:
        return None

    return faiss.read_index(str(FAISS_INDEX_PATH))


_STORE_CACHE: KnowledgeStore | None = None


def _store_signature() -> tuple[float, float] | None:
    if not META_PATH.exists() and not FAISS_INDEX_PATH.exists():
        return None
    meta_mtime = META_PATH.stat().st_mtime if META_PATH.exists() else 0.0
    index_mtime = FAISS_INDEX_PATH.stat().st_mtime if FAISS_INDEX_PATH.exists() else 0.0
    return meta_mtime, index_mtime


def _load_store() -> KnowledgeStore:
    chunks, model_name = _load_meta()
    return KnowledgeStore(
        chunks=chunks,
        model_name=model_name,
        faiss_index=_load_faiss_index(),
        signature=_store_signature(),
    )


def _get_store() -> KnowledgeStore:
    global _STORE_CACHE

    signature = _store_signature()
    if _STORE_CACHE is None or _STORE_CACHE.signature != signature:
        _STORE_CACHE = _load_store()
    return _STORE_CACHE


def _score_linear(query_text: str, chunk_text: str) -> float:
    query_tokens = set(TOKEN_RE.findall(query_text.lower()))
    chunk_tokens = set(TOKEN_RE.findall(chunk_text.lower()))
    return float(len(query_tokens & chunk_tokens))


def retrieve(query: str, k: int = 3) -> list[KnowledgeChunk]:
    store = _get_store()
    if not store.chunks:
        return []

    if store.faiss_index is not None:
        try:
            import numpy as np

            query_vector = embed_text(query, model_name=store.model_name)
            query_array = np.asarray([query_vector], dtype="float32")
            _, indices = store.faiss_index.search(query_array, k)
            result: list[KnowledgeChunk] = []
            for index in indices[0]:
                if index < 0 or index >= len(store.chunks):
                    continue
                result.append(store.chunks[int(index)])
            return result
        except Exception:
            # If the embedding model cannot be loaded, fall back to a simple lexical score.
            pass

    scored: list[tuple[float, KnowledgeChunk]] = []
    for chunk in store.chunks:
        score = _score_linear(query, chunk.text)
        if score > 0:
            scored.append((score, chunk))

    scored.sort(key=lambda item: item[0], reverse=True)
    return [chunk for _, chunk in scored[:k]]
