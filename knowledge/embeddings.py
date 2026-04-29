from __future__ import annotations

import os
from functools import lru_cache

import numpy as np


DEFAULT_EMBEDDING_MODEL_NAME = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"


def resolve_model_name(model_name: str | None = None) -> str:
    resolved_name = (model_name or os.getenv("EMBEDDING_MODEL_NAME", DEFAULT_EMBEDDING_MODEL_NAME)).strip()
    return resolved_name or DEFAULT_EMBEDDING_MODEL_NAME


@lru_cache(maxsize=4)
def _load_model(resolved_name: str):
    try:
        from sentence_transformers import SentenceTransformer
    except ImportError as exc:
        raise RuntimeError(
            "sentence-transformers is not installed. Install it with `pip install -r requirements.txt`."
        ) from exc

    return SentenceTransformer(resolved_name)


def load_model(model_name: str | None = None):
    return _load_model(resolve_model_name(model_name))


def embedding_dimension(model_name: str | None = None) -> int:
    return int(load_model(model_name).get_sentence_embedding_dimension())


def embed_texts(texts: list[str], model_name: str | None = None) -> np.ndarray:
    if not texts:
        dim = embedding_dimension(model_name)
        return np.empty((0, dim), dtype="float32")

    model = load_model(model_name)
    vectors = model.encode(
        texts,
        normalize_embeddings=True,
        convert_to_numpy=True,
        show_progress_bar=False,
    )
    return np.asarray(vectors, dtype="float32")


def embed_text(text: str, model_name: str | None = None) -> np.ndarray:
    return embed_texts([text], model_name=model_name)[0]
