from __future__ import annotations

import json
import sys
from pathlib import Path

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from knowledge.embeddings import DEFAULT_EMBEDDING_MODEL_NAME, embedding_dimension, embed_texts, resolve_model_name


BASE_DIR = Path(__file__).resolve().parent
DOCS_DIR = BASE_DIR / "docs"
META_PATH = BASE_DIR / "index_meta.json"
FAISS_INDEX_PATH = BASE_DIR / "index.faiss"
LEGACY_INDEX_PATH = BASE_DIR / "index.json"


def split_text(text: str, chunk_size: int = 500) -> list[str]:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    chunks: list[str] = []
    current = ""
    for line in lines:
        if len(current) + len(line) + 1 <= chunk_size:
            current = f"{current}\n{line}".strip()
        else:
            if current:
                chunks.append(current)
            current = line
    if current:
        chunks.append(current)
    return chunks


def collect_chunks() -> list[dict[str, str]]:
    docs: list[dict[str, str]] = []
    if not DOCS_DIR.exists():
        return docs

    for path in DOCS_DIR.glob("*"):
        if path.suffix.lower() not in {".md", ".txt"}:
            continue
        text = path.read_text(encoding="utf-8")
        for chunk in split_text(text):
            docs.append({"source": path.name, "text": chunk})
    return docs


def build_faiss_index(chunks: list[dict[str, str]], model_name: str, dimension: int) -> bool:
    try:
        import faiss
    except ImportError:
        return False

    vectors = embed_texts([chunk["text"] for chunk in chunks], model_name=model_name)
    dim = int(vectors.shape[1]) if vectors.ndim == 2 and vectors.size else dimension

    index = faiss.IndexFlatIP(dim)
    if len(vectors):
        index.add(vectors)
    faiss.write_index(index, str(FAISS_INDEX_PATH))
    return True


def main() -> None:
    model_name = resolve_model_name(DEFAULT_EMBEDDING_MODEL_NAME)
    chunks = collect_chunks()
    LEGACY_INDEX_PATH.write_text(json.dumps(chunks, ensure_ascii=False, indent=2), encoding="utf-8")

    try:
        dimension = embedding_dimension(model_name)
    except RuntimeError as exc:
        print(
            f"{exc}\n"
            f"Wrote legacy chunk metadata to {LEGACY_INDEX_PATH}. "
            "Install sentence-transformers to build the semantic index."
        )
        return

    meta_payload = {
        "model_name": model_name,
        "dimension": dimension,
        "chunks": chunks,
    }
    META_PATH.write_text(json.dumps(meta_payload, ensure_ascii=False, indent=2), encoding="utf-8")

    if build_faiss_index(chunks, model_name, dimension):
        print(
            f"wrote {len(chunks)} chunks to {FAISS_INDEX_PATH} and {META_PATH} "
            f"with model {model_name}"
        )
    else:
        print(
            "faiss is not installed, wrote metadata only "
            f"to {META_PATH}. Install faiss-cpu to build the vector index."
        )


if __name__ == "__main__":
    main()
