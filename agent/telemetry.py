from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any


LOGGER_NAME = "algoguide"


def configure_logging() -> logging.Logger:
    logger = logging.getLogger(LOGGER_NAME)
    if logger.handlers:
        return logger

    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(message)s"))
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    logger.propagate = False
    return logger


logger = configure_logging()


def log_event(event: str, **fields: Any) -> None:
    payload = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "event": event,
        **fields,
    }
    logger.info(json.dumps(payload, ensure_ascii=False, default=str))


def classify_error(error: str | Exception | None) -> tuple[str | None, str | None]:
    if error is None:
        return None, None

    text = str(error).strip()
    if not text:
        return None, None

    lowered = text.lower()
    if "missing openai_api_key" in lowered or "api key" in lowered:
        return "model_config", "模型 API Key 未配置，已切换到本地兜底回答。"
    if "httperror" in lowered or "urlerror" in lowered or "timed out" in lowered or "timeout" in lowered:
        return "model_request", "模型接口请求失败，已切换到可用的兜底回答。"
    if "storageerror" in lowered or "sqlite" in lowered or "database" in lowered:
        return "storage", "会话存储暂时不可用，回答已尽量返回。"
    if "knowledge" in lowered or "faiss" in lowered or "sentence-transformers" in lowered:
        return "retrieval", "知识库检索暂时不可用，已使用基础检索或兜底回答。"

    return "unknown", "请求处理时遇到异常，系统已尽量返回可用结果。"
