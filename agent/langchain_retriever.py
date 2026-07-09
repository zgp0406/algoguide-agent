from __future__ import annotations

from agent.retriever import retrieve_with_scores


def retrieve_documents(query: str, k: int = 3) -> list[object]:
    """把现有混合检索结果适配为 LangChain Document，不改变排序。"""
    try:
        from langchain_core.documents import Document
    except ImportError as exc:
        raise RuntimeError(
            "LangChain 依赖未安装，请执行 pip install -r requirements.langchain.txt"
        ) from exc

    return [
        Document(
            page_content=chunk.text,
            metadata={
                "knowledge_base_id": chunk.knowledge_base_id,
                "knowledge_base_name": chunk.knowledge_base_name,
                "source": chunk.source,
                "location": chunk.location,
                "score": chunk.score,
                "retrieval_mode": chunk.retrieval_mode,
            },
        )
        for chunk in retrieve_with_scores(query, k=k)
    ]
