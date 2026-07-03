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
LATIN_TOKEN_RE = re.compile(r"[a-z0-9]+")
CHINESE_RUN_RE = re.compile(r"[\u4e00-\u9fff]+")
SEMANTIC_WEIGHT = 0.65
LEXICAL_WEIGHT = 0.35
SEMANTIC_CANDIDATE_MULTIPLIER = 10


@dataclass
class KnowledgeChunk:
    knowledge_base_id: str
    knowledge_base_name: str
    source: str
    text: str
    location: str = ""


@dataclass
class RetrievedChunk:
    knowledge_base_id: str
    knowledge_base_name: str
    source: str
    text: str
    location: str
    score: float
    retrieval_mode: str = ""


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
            chunks.append(
                KnowledgeChunk(
                    knowledge_base_id=str(item.get("knowledge_base_id") or ""),
                    knowledge_base_name=str(item.get("knowledge_base_name") or "全库检索"),
                    source=source,
                    text=text,
                    location=str(item.get("location") or ""),
                )
            )
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
    score = float(len(query_tokens & chunk_tokens))

    # Chinese text often has no spaces, so the regex may turn a whole sentence
    # into one long token. Count direct substring hits as a lightweight fallback.
    lowered_chunk = chunk_text.lower()
    for token in query_tokens:
        if token in chunk_tokens:
            continue
        if len(token) >= 2 and token in lowered_chunk:
            score += 2.0 if re.search(r"[\u4e00-\u9fff]", token) else 1.0

    return score


def _lexical_terms(text: str) -> set[str]:
    """提取英文词和中文二/三元组，用于补足纯向量检索的精确词匹配。"""
    lowered = text.lower()
    terms = set(LATIN_TOKEN_RE.findall(lowered))
    for run in CHINESE_RUN_RE.findall(lowered):
        for size in (2, 3):
            terms.update(run[index : index + size] for index in range(len(run) - size + 1))
    return terms


def _lexical_similarity(query: str, chunk: KnowledgeChunk) -> float:
    query_terms = _lexical_terms(query)
    if not query_terms:
        return 0.0
    document_terms = _lexical_terms(f"{chunk.source} {chunk.text}")
    return len(query_terms & document_terms) / len(query_terms)


def _source_key(source: str) -> str:
    return Path(str(source).replace("\\", "/")).name.casefold()


def _unique_chunks(chunks: list[RetrievedChunk], k: int) -> list[RetrievedChunk]:
    """每个来源只保留排序最高的片段，避免单个文件占满 Top-K。"""
    result: list[RetrievedChunk] = []
    seen_sources: set[str] = set()
    for chunk in chunks:
        source_key = _source_key(chunk.source)
        if source_key in seen_sources:
            continue
        seen_sources.add(source_key)
        result.append(chunk)
        if len(result) >= k:
            break
    return result


def retrieve_with_scores(query: str, k: int = 3) -> list[RetrievedChunk]:
    store = _get_store()
    if not store.chunks:
        return []

    if store.faiss_index is not None:
        try:
            import numpy as np

            query_vector = embed_text(query, model_name=store.model_name)
            query_array = np.asarray([query_vector], dtype="float32")
            candidate_count = min(
                len(store.chunks),
                max(k, k * SEMANTIC_CANDIDATE_MULTIPLIER),
            )
            scores, indices = store.faiss_index.search(query_array, candidate_count)
            semantic_scores = {
                int(index): float(score)
                for index, score in zip(indices[0], scores[0], strict=False)
                if 0 <= index < len(store.chunks)
            }
            lexical_scores = [
                (_lexical_similarity(query, chunk), index)
                for index, chunk in enumerate(store.chunks)
            ]
            lexical_scores.sort(key=lambda item: item[0], reverse=True)

            # 合并语义候选和词面候选，避免精确术语对应片段在语义初筛时被漏掉。
            candidate_indices = set(semantic_scores)
            candidate_indices.update(
                index for score, index in lexical_scores[:candidate_count] if score > 0
            )
            lexical_score_by_index = {
                index: score for score, index in lexical_scores
            }
            result: list[RetrievedChunk] = []
            for index in candidate_indices:
                chunk = store.chunks[index]
                semantic_score = semantic_scores.get(index)
                if semantic_score is None:
                    try:
                        candidate_vector = np.asarray(
                            store.faiss_index.reconstruct(index),
                            dtype="float32",
                        )
                        semantic_score = float(np.dot(query_vector, candidate_vector))
                    except Exception:
                        semantic_score = 0.0
                lexical_score = lexical_score_by_index.get(index, 0.0)
                hybrid_score = (
                    SEMANTIC_WEIGHT * semantic_score
                    + LEXICAL_WEIGHT * lexical_score
                )
                result.append(
                    RetrievedChunk(
                        knowledge_base_id=chunk.knowledge_base_id,
                        knowledge_base_name=chunk.knowledge_base_name,
                        source=chunk.source,
                        text=chunk.text,
                        location=chunk.location,
                        score=hybrid_score,
                        retrieval_mode="hybrid",
                    )
                )
            result.sort(key=lambda item: item.score, reverse=True)
            return _unique_chunks(result, k)
        except Exception:
            # If the embedding model cannot be loaded, fall back to a simple lexical score.
            pass

    scored: list[RetrievedChunk] = []
    for chunk in store.chunks:
        score = _score_linear(query, chunk.text)
        if score > 0:
            scored.append(
                RetrievedChunk(
                    knowledge_base_id=chunk.knowledge_base_id,
                    knowledge_base_name=chunk.knowledge_base_name,
                    source=chunk.source,
                    text=chunk.text,
                    location=chunk.location,
                    score=float(score),
                    retrieval_mode="lexical",
                )
            )

    scored.sort(key=lambda item: item.score, reverse=True)
    return _unique_chunks(scored, k)


def retrieve(query: str, k: int = 3) -> list[KnowledgeChunk]:
    return [
        KnowledgeChunk(
            knowledge_base_id=chunk.knowledge_base_id,
            knowledge_base_name=chunk.knowledge_base_name,
            source=chunk.source,
            text=chunk.text,
            location=chunk.location,
        )
        for chunk in retrieve_with_scores(query, k=k)
    ]
