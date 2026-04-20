from __future__ import annotations

import json
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
DOCS_DIR = BASE_DIR / "docs"
INDEX_PATH = BASE_DIR / "index.json"


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


def main() -> None:
    docs = []
    if DOCS_DIR.exists():
        for path in DOCS_DIR.glob("*"):
            if path.suffix.lower() not in {".md", ".txt"}:
                continue
            text = path.read_text(encoding="utf-8")
            for chunk in split_text(text):
                docs.append({"source": path.name, "text": chunk})

    INDEX_PATH.write_text(json.dumps(docs, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {len(docs)} chunks to {INDEX_PATH}")


if __name__ == "__main__":
    main()

