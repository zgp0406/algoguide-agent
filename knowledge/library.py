from __future__ import annotations

import json
import os
import re
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from threading import RLock
from typing import Any
from uuid import uuid4

from knowledge.embeddings import DEFAULT_EMBEDDING_MODEL_NAME, embedding_dimension, embed_texts, resolve_model_name


BASE_DIR = Path(__file__).resolve().parent.parent
KNOWLEDGE_DIR = BASE_DIR / "knowledge"
DOCS_DIR = KNOWLEDGE_DIR / "docs"
DATA_DIR = BASE_DIR / "data"
STORE_PATH = DATA_DIR / "knowledge_store.json"
DRAFTS_DIR = DATA_DIR / "knowledge_drafts"
INDEX_META_PATH = KNOWLEDGE_DIR / "index_meta.json"
INDEX_JSON_PATH = KNOWLEDGE_DIR / "index.json"
INDEX_FAISS_PATH = KNOWLEDGE_DIR / "index.faiss"

BUILTIN_KB_ID = "builtin-algoguide"
BUILTIN_KB_NAME = "本地算法知识库"
DEFAULT_PREVIEW_CHUNKS = 6
DEFAULT_CHUNK_SIZE = 700
TEXT_QUALITY_THRESHOLD = 0.62

TOKEN_SPLIT_RE = re.compile(r"\n{2,}")
SENTENCE_SPLIT_RE = re.compile(r"(?<=[。！？!?\.])\s+")
MATH_SYMBOL_RE = re.compile(r"[=+\-*/^_<>×÷√∑∏∫≈≠≤≥∂∞∇∈∉∩∪⊂⊆⊃⊇∮∝%]")
FORMULA_ONLY_RE = re.compile(r"^[\sA-Za-z0-9\u4e00-\u9fff=+\-*/^_<>×÷√∑∏∫≈≠≤≥∂∞∇∈∉∩∪⊂⊆⊃⊇∮∝%().,\[\]{}|:;·•\\]+$")
SAFE_TEXT_RE = re.compile(r"[A-Za-z0-9\u4e00-\u9fff\s，。！？；：、,.!?;:()（）\[\]{}<>+=\-*/^_×÷√∑∏∫≈≠≤≥∂∞∇∈∉∩∪⊂⊆⊃⊇∮∝%·•/\\|]")
WORDISH_RE = re.compile(r"[A-Za-z0-9\u4e00-\u9fff]{2,}")
GARBAGE_CHAR_RE = re.compile(r"[^\w\s\u4e00-\u9fff，。！？；：、,.!?;:()（）\[\]{}<>+=\-*/^_×÷√∑∏∫≈≠≤≥∂∞∇∈∉∩∪⊂⊆⊃⊇∮∝%·•/\\|]")

_LOCK = RLock()
_INITIALIZED = False


@dataclass
class TextBlock:
    text: str
    location: str


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_text(text: str) -> str:
    return " ".join(str(text or "").strip().split())


def _safe_text_quality(text: str) -> float:
    compact = str(text or "").strip()
    if not compact:
        return 0.0

    safe_hits = len(SAFE_TEXT_RE.findall(compact))
    wordish_hits = len(WORDISH_RE.findall(compact))
    control_hits = len(re.findall(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", compact))
    replacement_hits = compact.count("\ufffd")
    garbage_hits = len(GARBAGE_CHAR_RE.findall(compact))
    suspicious_hits = 0
    total_hits = 0
    for char in compact:
        if char.isspace():
            continue
        total_hits += 1
        category = unicodedata.category(char)
        if category.startswith(("L", "N", "P", "S")):
            name = ""
            try:
                name = unicodedata.name(char)
            except ValueError:
                suspicious_hits += 1
                continue
            if any(
                token in name
                for token in (
                    "LATIN",
                    "CJK",
                    "HIRAGANA",
                    "KATAKANA",
                    "HANGUL",
                    "IDEOGRAPH",
                    "FULLWIDTH",
                    "GREEK",
                    "CYRILLIC",
                    "ARABIC",
                    "DEVANAGARI",
                    "BENGALI",
                    "GURMUKHI",
                    "GUJARATI",
                    "ORIYA",
                    "TAMIL",
                    "TELUGU",
                    "KANNADA",
                    "MALAYALAM",
                    "SINHALA",
                    "THAI",
                    "LAO",
                    "TIBETAN",
                    "MYANMAR",
                    "ETHIOPIC",
                    "COMMON",
                    "INHERITED",
                )
            ):
                continue
            suspicious_hits += 1
            continue
        suspicious_hits += 1

    ratio = (safe_hits + wordish_hits * 2) / max(len(compact), 1)
    suspicious_ratio = suspicious_hits / max(total_hits, 1)
    penalty = (control_hits + replacement_hits + garbage_hits * 1.5 + suspicious_ratio * len(compact)) / max(len(compact), 1)
    score = ratio - penalty
    return max(0.0, min(1.0, score))


def _text_quality_profile(blocks: list[TextBlock]) -> tuple[float, float]:
    if not blocks:
        return 0.0, 1.0

    scores = [_safe_text_quality(block.text) for block in blocks]
    average = sum(scores) / len(scores)
    low_fraction = sum(1 for score in scores if score < TEXT_QUALITY_THRESHOLD) / len(scores)
    return average, low_fraction


def _is_formula_like_text(text: str) -> bool:
    normalized = str(text or "").strip()
    if not normalized:
        return False

    compact = _normalize_text(normalized)
    if not compact:
        return False

    if len(compact) <= 12 and MATH_SYMBOL_RE.search(compact):
        return True

    if not FORMULA_ONLY_RE.fullmatch(compact):
        return False

    math_hits = len(MATH_SYMBOL_RE.findall(compact))
    if math_hits == 0:
        return False

    alnum_hits = len(re.findall(r"[A-Za-z0-9\u4e00-\u9fff]", compact))
    if alnum_hits <= 24:
        return True

    symbol_ratio = (math_hits + len(re.findall(r"[()[\]{}|,.:;·•]", compact))) / max(len(compact), 1)
    return symbol_ratio >= 0.28 and alnum_hits <= 40


def _filter_formula_blocks(blocks: list[TextBlock]) -> tuple[list[TextBlock], int]:
    kept: list[TextBlock] = []
    skipped = 0
    for block in blocks:
        if _is_formula_like_text(block.text):
            skipped += 1
            continue
        kept.append(block)
    return kept, skipped


def _normalize_ocr_text(text: str) -> list[TextBlock]:
    blocks: list[TextBlock] = []
    for line_index, raw_line in enumerate(str(text or "").splitlines(), start=1):
        line = _normalize_text(raw_line)
        if not line:
            continue
        if _is_formula_like_text(line):
            continue
        blocks.append(TextBlock(text=line, location=f"OCR 行 {line_index}"))
    return blocks


def _ocr_available() -> bool:
    try:
        import fitz  # noqa: F401
        import pytesseract  # noqa: F401
        from PIL import Image  # noqa: F401
    except Exception:
        return False
    return True


def _extract_pdf_blocks_via_ocr(file_bytes: bytes) -> list[TextBlock]:
    try:
        import fitz
        import pytesseract
        from PIL import Image
    except ImportError as exc:
        raise RuntimeError(
            "当前 PDF 文档提取质量较差，需要 OCR 兜底，但缺少 OCR 依赖。请安装 pytesseract、pymupdf 和 pillow。"
        ) from exc

    try:
        document = fitz.open(stream=file_bytes, filetype="pdf")
    except Exception as exc:
        raise RuntimeError("PDF 打开失败，无法进行 OCR 兜底。") from exc

    blocks: list[TextBlock] = []
    for page_index in range(len(document)):
        page = document[page_index]
        pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
        image = Image.open(BytesIO(pixmap.tobytes("png")))
        ocr_text = pytesseract.image_to_string(image, lang=os.getenv("OCR_LANG", "chi_sim+eng"))
        for block in _normalize_ocr_text(ocr_text):
            blocks.append(TextBlock(text=block.text, location=f"第 {page_index + 1} 页 OCR"))
    return blocks


def _extract_pdf_text_blocks(file_bytes: bytes) -> list[TextBlock]:
    try:
        from pypdf import PdfReader
    except ImportError as exc:
        raise RuntimeError("缺少 pypdf 依赖，请先安装 requirements.txt。") from exc

    reader = PdfReader(BytesIO(file_bytes))
    blocks: list[TextBlock] = []
    for page_index, page in enumerate(reader.pages, start=1):
        raw_text = str(page.extract_text() or "").strip()
        if not raw_text:
            continue
        for line in raw_text.splitlines():
            text = _normalize_text(line)
            if not text:
                continue
            if _is_formula_like_text(text):
                continue
            blocks.append(TextBlock(text=text, location=f"第 {page_index} 页"))
    return blocks


def _summarize_text(text: str, limit: int = 220) -> str:
    normalized = _normalize_text(text)
    if not normalized:
        return ""
    if len(normalized) <= limit:
        return normalized
    return f"{normalized[: limit - 1]}…"


def _read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _default_store_payload() -> dict[str, Any]:
    now = _now()
    return {
        "knowledge_bases": [
            {
                "id": BUILTIN_KB_ID,
                "name": BUILTIN_KB_NAME,
                "kind": "builtin",
                "created_at": now,
                "updated_at": now,
            }
        ],
        "documents": [],
    }


def _load_store_payload() -> dict[str, Any]:
    payload = _read_json(STORE_PATH, {})
    if not isinstance(payload, dict):
        payload = {}

    store = _default_store_payload()
    knowledge_bases = payload.get("knowledge_bases")
    if isinstance(knowledge_bases, list):
        store["knowledge_bases"] = [item for item in knowledge_bases if isinstance(item, dict)]

    documents = payload.get("documents")
    if isinstance(documents, list):
        store["documents"] = [item for item in documents if isinstance(item, dict)]

    return store


def _save_store_payload(payload: dict[str, Any]) -> None:
    _write_json(STORE_PATH, payload)


def _seed_builtin_documents(store: dict[str, Any]) -> bool:
    if not DOCS_DIR.exists():
        return False

    documents = store.setdefault("documents", [])
    existing_keys = {
        str(doc.get("source_key") or "")
        for doc in documents
        if isinstance(doc, dict)
    }

    added = False
    for path in DOCS_DIR.glob("*"):
        if path.suffix.lower() not in {".md", ".txt"}:
            continue

        source_key = f"builtin:{path.name}"
        if source_key in existing_keys:
            continue

        text = path.read_text(encoding="utf-8")
        blocks = [TextBlock(text=line, location=f"段落 {index}") for index, line in enumerate(_split_text_blocks(text), start=1)]
        chunks = _build_chunks(blocks, source_label=path.name, knowledge_base_id=BUILTIN_KB_ID, knowledge_base_name=BUILTIN_KB_NAME)
        doc_id = f"doc_{uuid4().hex}"
        now = _now()
        documents.append(
            {
                "id": doc_id,
                "source_key": source_key,
                "knowledge_base_id": BUILTIN_KB_ID,
                "knowledge_base_name": BUILTIN_KB_NAME,
                "source_type": "seed",
                "filename": path.name,
                "mime_type": "text/markdown" if path.suffix.lower() == ".md" else "text/plain",
                "title": path.name,
                "summary": _summarize_text(text, 220),
                "text": text,
                "blocks": [block.__dict__ for block in blocks],
                "chunks": chunks,
                "created_at": now,
                "updated_at": now,
            }
        )
        added = True

    if added:
        _save_store_payload(store)
    return added


def _split_text_blocks(text: str, *, max_chars: int = DEFAULT_CHUNK_SIZE) -> list[str]:
    normalized = str(text or "").strip()
    if not normalized:
        return []

    paragraphs = [part.strip() for part in TOKEN_SPLIT_RE.split(normalized) if part.strip()]
    if not paragraphs:
        paragraphs = [normalized]

    segments: list[str] = []
    for paragraph in paragraphs:
        if len(paragraph) <= max_chars:
            segments.append(paragraph)
            continue

        sentences = [part.strip() for part in SENTENCE_SPLIT_RE.split(paragraph) if part.strip()]
        if not sentences:
            sentences = []
            for start in range(0, len(paragraph), max_chars):
                segments.append(paragraph[start : start + max_chars].strip())
            continue

        buffer = ""
        for sentence in sentences:
            if len(buffer) + len(sentence) + 1 <= max_chars:
                buffer = f"{buffer} {sentence}".strip()
            else:
                if buffer:
                    segments.append(buffer)
                if len(sentence) > max_chars:
                    for start in range(0, len(sentence), max_chars):
                        segments.append(sentence[start : start + max_chars].strip())
                    buffer = ""
                else:
                    buffer = sentence
        if buffer:
            segments.append(buffer)

    return [segment for segment in segments if segment]


def _compact_location(locations: list[str]) -> str:
    values: list[str] = []
    for location in locations:
        clean = str(location or "").strip()
        if clean and clean not in values:
            values.append(clean)
    if not values:
        return ""
    if len(values) == 1:
        return values[0]
    if len(values) <= 3:
        return " / ".join(values)
    return f"{values[0]} … {values[-1]}"


def _build_chunks(blocks: list[TextBlock], *, source_label: str, knowledge_base_id: str, knowledge_base_name: str) -> list[dict[str, Any]]:
    chunks: list[dict[str, Any]] = []
    current_texts: list[str] = []
    current_locations: list[str] = []
    current_length = 0

    def flush() -> None:
        nonlocal current_texts, current_locations, current_length
        if not current_texts:
            return
        chunk_text = "\n\n".join(current_texts).strip()
        if not chunk_text:
            current_texts = []
            current_locations = []
            current_length = 0
            return
        chunks.append(
            {
                "source": source_label,
                "knowledge_base_id": knowledge_base_id,
                "knowledge_base_name": knowledge_base_name,
                "text": chunk_text,
                "location": _compact_location(current_locations),
            }
        )
        current_texts = []
        current_locations = []
        current_length = 0

    for block in blocks:
        text = _normalize_text(block.text)
        if not text:
            continue
        if len(text) > DEFAULT_CHUNK_SIZE:
            flush()
            for segment in _split_text_blocks(text):
                chunks.append(
                    {
                        "source": source_label,
                        "knowledge_base_id": knowledge_base_id,
                        "knowledge_base_name": knowledge_base_name,
                        "text": segment,
                        "location": block.location,
                    }
                )
            continue

        if current_texts and current_length + len(text) + 2 > DEFAULT_CHUNK_SIZE:
            flush()

        current_texts.append(text)
        current_locations.append(block.location)
        current_length += len(text) + 2

    flush()
    for index, chunk in enumerate(chunks):
        chunk["chunk_index"] = index
    return chunks


def _extract_docx_blocks(file_bytes: bytes) -> list[TextBlock]:
    try:
        from docx import Document
    except ImportError as exc:
        raise RuntimeError("缺少 python-docx 依赖，请先安装 requirements.txt。") from exc

    document = Document(BytesIO(file_bytes))
    blocks: list[TextBlock] = []
    for paragraph_index, paragraph in enumerate(document.paragraphs, start=1):
        text = _normalize_text(paragraph.text)
        if text and not _is_formula_like_text(text):
            blocks.append(TextBlock(text=text, location=f"段落 {paragraph_index}"))
    return blocks


def _extract_docx_blocks_with_quality(file_bytes: bytes) -> tuple[list[TextBlock], float]:
    blocks = _extract_docx_blocks(file_bytes)
    joined_text = "\n\n".join(block.text for block in blocks)
    return blocks, _safe_text_quality(joined_text)


def parse_uploaded_document(filename: str, file_bytes: bytes) -> dict[str, Any]:
    suffix = Path(filename).suffix.lower()
    if suffix == ".pdf":
        text_blocks = _extract_pdf_text_blocks(file_bytes)
        mime_type = "application/pdf"
        text_quality, low_fraction = _text_quality_profile(text_blocks)
        ocr_blocks: list[TextBlock] = []
        extraction_mode = "text"
        ocr_used = False
        ocr_available = _ocr_available()
        if ocr_available and (not text_blocks or text_quality < TEXT_QUALITY_THRESHOLD or low_fraction > 0.4):
            ocr_blocks = _extract_pdf_blocks_via_ocr(file_bytes)
            ocr_quality, ocr_low_fraction = _text_quality_profile(ocr_blocks)
            if ocr_blocks and (not text_blocks or ocr_quality >= text_quality or ocr_low_fraction < low_fraction):
                text_blocks = ocr_blocks
                text_quality = ocr_quality
                low_fraction = ocr_low_fraction
                extraction_mode = "ocr"
                ocr_used = True
        blocks = text_blocks
    elif suffix == ".docx":
        blocks, text_quality = _extract_docx_blocks_with_quality(file_bytes)
        mime_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        extraction_mode = "text"
        ocr_used = False
        ocr_available = False
        _, low_fraction = _text_quality_profile(blocks)
    else:
        raise ValueError("仅支持 PDF 或 .docx 文件")

    if not blocks:
        raise ValueError("没有从文档中提取到可用正文文本，可能以公式或图片为主")

    filtered_blocks, skipped_block_count = _filter_formula_blocks(blocks)
    if not filtered_blocks:
        raise ValueError("没有从文档中提取到可用正文文本，可能以公式或图片为主")

    filtered_quality, filtered_low_fraction = _text_quality_profile(filtered_blocks)
    if filtered_quality < TEXT_QUALITY_THRESHOLD or filtered_low_fraction > 0.35:
        if suffix == ".pdf" and not ocr_used and _ocr_available():
            ocr_blocks = _extract_pdf_blocks_via_ocr(file_bytes)
            filtered_blocks, skipped_block_count = _filter_formula_blocks(ocr_blocks)
            if filtered_blocks:
                filtered_quality, filtered_low_fraction = _text_quality_profile(filtered_blocks)
                if filtered_quality >= TEXT_QUALITY_THRESHOLD and filtered_low_fraction <= 0.35:
                    blocks = ocr_blocks
                    text_quality = filtered_quality
                    extraction_mode = "ocr"
                    ocr_used = True
                else:
                    raise ValueError("提取质量较差，OCR 兜底后仍不稳定，建议使用更清晰的 PDF")
            else:
                raise ValueError("提取质量较差，OCR 兜底后仍不稳定，建议使用更清晰的 PDF")
        else:
            raise ValueError("提取质量较差，建议使用可复制文本版文档，或改用 OCR 处理扫描件")

    extracted_text = "\n\n".join(block.text for block in filtered_blocks).strip()
    if text_quality < TEXT_QUALITY_THRESHOLD:
        if suffix == ".pdf":
            if ocr_available and not ocr_used:
                raise ValueError("提取质量较差，OCR 兜底后仍不稳定，建议使用更清晰的 PDF 或图片版文档")
            if not ocr_available:
                raise ValueError("提取质量较差，当前环境未启用 OCR 兜底，建议安装 OCR 依赖或更换文档")
        else:
            raise ValueError("提取质量较差，建议先导出为可复制文本版 PDF，或重新整理 Word 文档")

    summary = _summarize_text(extracted_text, 240)
    chunks = _build_chunks(filtered_blocks, source_label=Path(filename).name, knowledge_base_id="", knowledge_base_name="")
    extraction_warning = ""
    if skipped_block_count:
        extraction_warning = f"已跳过 {skipped_block_count} 个公式块，仅保留正文。"
    preview_chunks = [
        {
            "source": chunk["source"],
            "location": chunk.get("location") or "",
            "text": chunk["text"],
            "chunk_index": chunk["chunk_index"],
        }
        for chunk in chunks[:DEFAULT_PREVIEW_CHUNKS]
    ]
    return {
        "file_name": Path(filename).name,
        "mime_type": mime_type,
        "char_count": len(extracted_text),
        "block_count": len(filtered_blocks),
        "skipped_block_count": skipped_block_count,
        "chunk_count": len(chunks),
        "text_quality": round(text_quality, 3),
        "ocr_available": ocr_available if suffix == ".pdf" else False,
        "ocr_used": ocr_used,
        "extraction_mode": extraction_mode,
        "extraction_warning": extraction_warning,
        "summary": summary,
        "extracted_text": extracted_text,
        "blocks": [block.__dict__ for block in filtered_blocks],
        "chunks": chunks,
        "preview_chunks": preview_chunks,
    }


def _normalize_knowledge_base_name(name: str) -> str:
    return " ".join(str(name or "").strip().split())


def _find_knowledge_base(store: dict[str, Any], knowledge_base_id: str | None = None, knowledge_base_name: str | None = None) -> dict[str, Any] | None:
    knowledge_bases = store.get("knowledge_bases", [])
    if knowledge_base_id:
        for knowledge_base in knowledge_bases:
            if str(knowledge_base.get("id")) == knowledge_base_id:
                return knowledge_base
    if knowledge_base_name:
        normalized_name = _normalize_knowledge_base_name(knowledge_base_name)
        for knowledge_base in knowledge_bases:
            if _normalize_knowledge_base_name(str(knowledge_base.get("name") or "")) == normalized_name:
                return knowledge_base
    return None


def _create_knowledge_base(store: dict[str, Any], name: str) -> dict[str, Any]:
    normalized_name = _normalize_knowledge_base_name(name)
    if not normalized_name:
        raise ValueError("知识库名称不能为空")

    existing = _find_knowledge_base(store, knowledge_base_name=normalized_name)
    if existing:
        return existing

    now = _now()
    knowledge_base = {
        "id": f"kb_{uuid4().hex}",
        "name": normalized_name,
        "kind": "custom",
        "created_at": now,
        "updated_at": now,
    }
    store.setdefault("knowledge_bases", []).append(knowledge_base)
    return knowledge_base


def _summarize_document_chunks(chunks: list[dict[str, Any]], limit: int = 3) -> list[dict[str, Any]]:
    return [
        {
            "source": str(chunk.get("source") or ""),
            "knowledge_base_name": str(chunk.get("knowledge_base_name") or ""),
            "location": str(chunk.get("location") or ""),
            "text": str(chunk.get("text") or ""),
            "chunk_index": int(chunk.get("chunk_index") or 0),
        }
        for chunk in chunks[:limit]
    ]


def _load_draft_path(draft_id: str) -> Path:
    return DRAFTS_DIR / f"{draft_id}.json"


def _save_draft(draft: dict[str, Any]) -> None:
    DRAFTS_DIR.mkdir(parents=True, exist_ok=True)
    _write_json(_load_draft_path(draft["draft_id"]), draft)


def _load_draft(draft_id: str) -> dict[str, Any]:
    draft = _read_json(_load_draft_path(draft_id), {})
    if not isinstance(draft, dict) or not draft:
        raise FileNotFoundError("draft not found")
    return draft


def _delete_draft(draft_id: str) -> None:
    path = _load_draft_path(draft_id)
    if path.exists():
        path.unlink()


def _document_to_index_chunk(document: dict[str, Any], chunk: dict[str, Any]) -> dict[str, Any]:
    return {
        "source": str(chunk.get("source") or document.get("filename") or ""),
        "text": str(chunk.get("text") or ""),
        "knowledge_base_id": str(document.get("knowledge_base_id") or ""),
        "knowledge_base_name": str(document.get("knowledge_base_name") or ""),
        "document_id": str(document.get("id") or ""),
        "document_title": str(document.get("title") or document.get("filename") or ""),
        "location": str(chunk.get("location") or ""),
        "chunk_index": int(chunk.get("chunk_index") or 0),
        "source_type": str(document.get("source_type") or ""),
    }


def _list_documents(store: dict[str, Any]) -> list[dict[str, Any]]:
    documents = store.get("documents", [])
    result: list[dict[str, Any]] = []
    for document in documents:
        if not isinstance(document, dict):
            continue
        result.append(document)
    return result


def _materialize_chunks(store: dict[str, Any]) -> list[dict[str, Any]]:
    chunks: list[dict[str, Any]] = []
    for document in _list_documents(store):
        document_chunks = document.get("chunks")
        if not isinstance(document_chunks, list):
            continue
        for chunk in document_chunks:
            if not isinstance(chunk, dict):
                continue
            chunks.append(_document_to_index_chunk(document, chunk))
    return chunks


def _knowledge_base_stats(store: dict[str, Any]) -> list[dict[str, Any]]:
    docs = _list_documents(store)
    document_count_by_id: dict[str, int] = {}
    chunk_count_by_id: dict[str, int] = {}
    updated_at_by_id: dict[str, str] = {}
    for document in docs:
        kb_id = str(document.get("knowledge_base_id") or "")
        if not kb_id:
          continue
        document_count_by_id[kb_id] = document_count_by_id.get(kb_id, 0) + 1
        chunks = document.get("chunks")
        if isinstance(chunks, list):
            chunk_count_by_id[kb_id] = chunk_count_by_id.get(kb_id, 0) + len([chunk for chunk in chunks if isinstance(chunk, dict)])
        updated_at = str(document.get("updated_at") or document.get("created_at") or "")
        if updated_at:
            current = updated_at_by_id.get(kb_id, "")
            if updated_at > current:
                updated_at_by_id[kb_id] = updated_at

    stats: list[dict[str, Any]] = []
    for knowledge_base in store.get("knowledge_bases", []):
        if not isinstance(knowledge_base, dict):
            continue
        kb_id = str(knowledge_base.get("id") or "")
        if not kb_id:
            continue
        stats.append(
            {
                "id": kb_id,
                "name": str(knowledge_base.get("name") or ""),
                "kind": str(knowledge_base.get("kind") or "custom"),
                "created_at": str(knowledge_base.get("created_at") or ""),
                "updated_at": updated_at_by_id.get(kb_id, str(knowledge_base.get("updated_at") or "")),
                "document_count": document_count_by_id.get(kb_id, 0),
                "chunk_count": chunk_count_by_id.get(kb_id, 0),
            }
        )
    stats.sort(key=lambda item: (item["kind"] != "builtin", item["name"]))
    return stats


def ensure_initialized() -> None:
    global _INITIALIZED
    if _INITIALIZED:
        return

    with _LOCK:
        if _INITIALIZED:
            return
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        store = _load_store_payload()
        builtins_added = _seed_builtin_documents(store)
        if builtins_added or not STORE_PATH.exists():
            _save_store_payload(store)
        _INITIALIZED = True
        if builtins_added or not INDEX_JSON_PATH.exists() or not INDEX_META_PATH.exists():
            rebuild_artifacts()


def list_knowledge_bases() -> list[dict[str, Any]]:
    ensure_initialized()
    with _LOCK:
        store = _load_store_payload()
        if _seed_builtin_documents(store):
            _save_store_payload(store)
        return _knowledge_base_stats(store)


def get_knowledge_base(knowledge_base_id: str) -> dict[str, Any] | None:
    ensure_initialized()
    with _LOCK:
        store = _load_store_payload()
        if _seed_builtin_documents(store):
            _save_store_payload(store)
        for knowledge_base in _knowledge_base_stats(store):
            if knowledge_base["id"] == knowledge_base_id:
                return knowledge_base
        return None


def create_upload_draft(
    *,
    file_name: str,
    file_bytes: bytes,
    knowledge_base_id: str | None = None,
    knowledge_base_name: str | None = None,
) -> dict[str, Any]:
    ensure_initialized()
    parsed = parse_uploaded_document(file_name, file_bytes)
    draft_id = f"draft_{uuid4().hex}"
    target = {
        "knowledge_base_id": knowledge_base_id or "",
        "knowledge_base_name": _normalize_knowledge_base_name(knowledge_base_name or ""),
    }
    draft = {
        "draft_id": draft_id,
        "file_name": parsed["file_name"],
        "mime_type": parsed["mime_type"],
        "char_count": parsed["char_count"],
        "block_count": parsed["block_count"],
        "skipped_block_count": parsed["skipped_block_count"],
        "chunk_count": parsed["chunk_count"],
        "text_quality": parsed["text_quality"],
        "ocr_available": parsed["ocr_available"],
        "ocr_used": parsed["ocr_used"],
        "extraction_mode": parsed["extraction_mode"],
        "extraction_warning": parsed["extraction_warning"],
        "summary": parsed["summary"],
        "extracted_text": parsed["extracted_text"],
        "blocks": parsed["blocks"],
        "chunks": parsed["chunks"],
        "preview_chunks": parsed["preview_chunks"],
        "target": target,
        "created_at": _now(),
        "confirmed_at": None,
    }
    _save_draft(draft)
    return draft


def confirm_upload_draft(
    *,
    draft_id: str,
    knowledge_base_id: str | None = None,
    knowledge_base_name: str | None = None,
) -> dict[str, Any]:
    ensure_initialized()
    with _LOCK:
        draft = _load_draft(draft_id)
        if draft.get("confirmed_at"):
            raise ValueError("draft already confirmed")

        store = _load_store_payload()
        if _seed_builtin_documents(store):
            pass

        target_id = str(knowledge_base_id or draft.get("target", {}).get("knowledge_base_id") or "").strip()
        target_name = _normalize_knowledge_base_name(
            knowledge_base_name or draft.get("target", {}).get("knowledge_base_name") or ""
        )

        knowledge_base = None
        if target_id:
            knowledge_base = _find_knowledge_base(store, knowledge_base_id=target_id)
            if not knowledge_base:
                raise ValueError("目标知识库不存在")
        elif target_name:
            knowledge_base = _create_knowledge_base(store, target_name)
        else:
            knowledge_base = _find_knowledge_base(store, knowledge_base_id=BUILTIN_KB_ID)
            if not knowledge_base:
                knowledge_base = _create_knowledge_base(store, BUILTIN_KB_NAME)

        now = _now()
        document_id = f"doc_{uuid4().hex}"
        document = {
            "id": document_id,
            "source_key": f"upload:{draft_id}",
            "knowledge_base_id": knowledge_base["id"],
            "knowledge_base_name": knowledge_base["name"],
            "source_type": "upload",
            "filename": str(draft.get("file_name") or "upload"),
            "mime_type": str(draft.get("mime_type") or ""),
            "title": str(draft.get("file_name") or "upload"),
            "summary": str(draft.get("summary") or ""),
            "text": str(draft.get("extracted_text") or ""),
            "blocks": draft.get("blocks") if isinstance(draft.get("blocks"), list) else [],
            "chunks": [],
            "created_at": now,
            "updated_at": now,
        }

        chunks = draft.get("chunks")
        if isinstance(chunks, list):
            document["chunks"] = [
                {
                    "source": str(chunk.get("source") or document["filename"]),
                    "knowledge_base_id": knowledge_base["id"],
                    "knowledge_base_name": knowledge_base["name"],
                    "text": str(chunk.get("text") or ""),
                    "location": str(chunk.get("location") or ""),
                    "chunk_index": int(chunk.get("chunk_index") or index),
                }
                for index, chunk in enumerate(chunks)
                if isinstance(chunk, dict) and str(chunk.get("text") or "").strip()
            ]

        store.setdefault("documents", []).append(document)
        knowledge_base["updated_at"] = now
        _save_store_payload(store)
        rebuild_artifacts()

        draft["confirmed_at"] = now
        _delete_draft(draft_id)

        return {
            "draft_id": draft_id,
            "document": {
                "id": document_id,
                "filename": document["filename"],
                "summary": document["summary"],
                "chunk_count": len(document["chunks"]),
                "skipped_block_count": int(draft.get("skipped_block_count") or 0),
                "text_quality": float(draft.get("text_quality") or 0.0),
                "ocr_available": bool(draft.get("ocr_available")),
                "ocr_used": bool(draft.get("ocr_used")),
                "extraction_mode": str(draft.get("extraction_mode") or "text"),
                "extraction_warning": str(draft.get("extraction_warning") or ""),
                "knowledge_base_id": knowledge_base["id"],
                "knowledge_base_name": knowledge_base["name"],
            },
            "knowledge_base": {
                "id": knowledge_base["id"],
                "name": knowledge_base["name"],
                "kind": knowledge_base.get("kind", "custom"),
            },
            "knowledge_bases": list_knowledge_bases(),
        }


def rebuild_artifacts() -> dict[str, Any]:
    ensure_initialized()
    with _LOCK:
        store = _load_store_payload()
        chunks = _materialize_chunks(store)
        legacy_payload = chunks
        _write_json(INDEX_JSON_PATH, legacy_payload)

        model_name = resolve_model_name(DEFAULT_EMBEDDING_MODEL_NAME)
        meta_payload = {
            "model_name": model_name,
            "knowledge_bases": _knowledge_base_stats(store),
            "chunks": chunks,
        }
        _write_json(INDEX_META_PATH, meta_payload)

        try:
            import faiss

            vectors = embed_texts([chunk["text"] for chunk in chunks], model_name=model_name)
            dim = int(vectors.shape[1]) if vectors.ndim == 2 and vectors.size else embedding_dimension(model_name)
            index = faiss.IndexFlatIP(dim)
            if len(vectors):
                index.add(vectors)
            faiss.write_index(index, str(INDEX_FAISS_PATH))
            faiss_status = "written"
        except Exception:
            if INDEX_FAISS_PATH.exists():
                INDEX_FAISS_PATH.unlink()
            faiss_status = "skipped"

        return {
            "model_name": model_name,
            "chunk_count": len(chunks),
            "knowledge_bases": _knowledge_base_stats(store),
            "faiss_status": faiss_status,
        }


ensure_initialized()
