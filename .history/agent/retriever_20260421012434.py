from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


BASE_DIR = Path(__file__).resolve().parent.parent
KNOWLEDGE_DIR = BASE_DIR / "knowledge"
DOCS_DIR = KNOWLEDGE_DIR / "docs"
INDEX_PATH = KNOWLEDGE_DIR / "index.json"


TOKEN_RE = re.compile(r"[A-Za-z0-9\u4e00-\u9fff]+")


@dataclass
class KnowledgeChunk:
    source: str
    text: str


def tokenize(text: str) -> set[str]:
    return set(TOKEN_RE.findall(text.lower()))


def load_chunks() -> list[KnowledgeChunk]:
    """
    加载知识块列表，如果存在索引文件则直接加载，否则从文档目录创建
    返回:
        list[KnowledgeChunk]: 包含知识块的列表，如果没有内容则返回空列表
    """
    if INDEX_PATH.exists():
        # 如果索引文件存在，直接读取并解析为KnowledgeChunk对象列表
        payload = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
        return [KnowledgeChunk(**item) for item in payload]

    chunks: list[KnowledgeChunk] = []
    if not DOCS_DIR.exists():
        # 如果文档目录不存在，直接返回空列表
        return chunks

    # 遍历文档目录中的所有文件
    for path in DOCS_DIR.glob("*"):
        # 只处理.md和.txt文件
        if path.suffix.lower() not in {".md", ".txt"}:
            continue
        text = path.read_text(encoding="utf-8")
        # The first version uses lightweight text chunks instead of a vector store.
        for part in split_text(text):
            chunks.append(KnowledgeChunk(source=path.name, text=part))
    return chunks


def split_text(text: str, chunk_size: int = 500) -> list[str]:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if not lines:
        return []

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


def retrieve(query: str, k: int = 3) -> list[KnowledgeChunk]:
    chunks = load_chunks()
    if not chunks:
        return []

    query_tokens = tokenize(query)
    scored: list[tuple[int, KnowledgeChunk]] = []
    for chunk in chunks:
        # Simple token overlap keeps the MVP easy to run and explain.
        score = len(query_tokens & tokenize(chunk.text))
        if score:
            scored.append((score, chunk))

    scored.sort(key=lambda item: item[0], reverse=True)
    return [chunk for _, chunk in scored[:k]]
