from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

from agent.retriever import retrieve_with_scores


# ── 工具注册表 ──────────────────────────────────────────────────

TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "search_knowledge",
            "description": (
                "搜索本地算法知识库，返回相关文档片段及其来源和相似度分数。"
                "当你需要查找算法概念定义、题解模板、复杂度分析方法、代码示例时使用此工具。"
                "参数 query 应该用中文自然语言描述你要搜索的内容。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "用中文描述要搜索的内容，例如'动态规划的状态转移方程推导'或'BFS 的队列实现步骤'",
                    }
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_python",
            "description": (
                "在受限沙箱中执行 Python 代码并捕获标准输出。"
                "用于验证算法逻辑、运行测试用例、展示运行结果、计算复杂度示例。"
                "代码执行超时 10 秒，只能使用 Python 标准库。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "code": {
                        "type": "string",
                        "description": "要执行的 Python 代码。print() 的输出会被捕获并返回。",
                    }
                },
                "required": ["code"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_document_detail",
            "description": (
                "获取某个知识库文档的完整文本内容（所有切块）。"
                "当 search_knowledge 返回的片段不够详细，需要查看完整文档时使用。"
                "参数 source 是 search_knowledge 结果中返回的 source 文件名。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "source": {
                        "type": "string",
                        "description": "search_knowledge 返回的 source 字段值，例如 'dynamic_programming.md'",
                    }
                },
                "required": ["source"],
            },
        },
    },
]


# ── 工具执行 ────────────────────────────────────────────────────


def execute_tool(name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    """执行指定工具并返回结果字典。"""
    if name == "search_knowledge":
        return _search_knowledge(arguments)
    if name == "run_python":
        return _run_python(arguments)
    if name == "get_document_detail":
        return _get_document_detail(arguments)
    return {"error": f"未知工具: {name}"}


def get_tool_definitions() -> list[dict[str, Any]]:
    """返回 OpenAI 兼容的 tools 参数。"""
    return TOOLS


def _search_knowledge(args: dict[str, Any]) -> dict[str, Any]:
    query = str(args.get("query", "")).strip()
    if not query:
        return {"error": "query 参数不能为空"}

    chunks = retrieve_with_scores(query, k=4)
    if not chunks:
        return {"results": [], "count": 0, "message": "未找到相关内容。请尝试用不同的关键词重新搜索。"}

    results = []
    for chunk in chunks:
        results.append(
            {
                "source": chunk.source,
                "location": chunk.location,
                "text": chunk.text,
                "score": round(chunk.score, 4),
                "knowledge_base_name": chunk.knowledge_base_name,
            }
        )

    return {
        "results": results,
        "count": len(results),
        "query": query,
    }


def _run_python(args: dict[str, Any]) -> dict[str, Any]:
    code = str(args.get("code", "")).strip()
    if not code:
        return {"error": "code 参数不能为空"}
    if len(code) > 10000:
        return {"error": "代码过长（超过 10000 字符），请精简后再试。"}

    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".py", delete=False, encoding="utf-8"
    ) as f:
        f.write(code)
        tmp_path = Path(f.name)

    try:
        result = subprocess.run(
            [sys.executable, str(tmp_path)],
            capture_output=True,
            text=True,
            timeout=10,
        )
        stdout = result.stdout.strip()
        stderr = result.stderr.strip()
        output_parts = []
        if stdout:
            output_parts.append(stdout)
        if stderr:
            output_parts.append(f"[stderr]\n{stderr}")
        if not output_parts:
            output_parts.append("(代码执行完成，无输出)")

        return {
            "output": "\n".join(output_parts),
            "exit_code": result.returncode,
            "truncated": len(output_parts[0]) > 2000,
        }
    except subprocess.TimeoutExpired:
        return {"error": "代码执行超时（10 秒），请检查是否有死循环或优化代码。"}
    finally:
        try:
            tmp_path.unlink()
        except OSError:
            pass


def _get_document_detail(args: dict[str, Any]) -> dict[str, Any]:
    source = str(args.get("source", "")).strip()
    if not source:
        return {"error": "source 参数不能为空"}

    from knowledge.library import get_document_detail as kb_get_doc

    # 通过文件名匹配查找文档
    from knowledge.library import list_knowledge_bases, list_documents_for_knowledge_base

    try:
        kbs = list_knowledge_bases()
        for kb in kbs:
            docs = list_documents_for_knowledge_base(kb["id"])
            for doc in docs:
                filename = str(doc.get("filename") or doc.get("title") or "")
                if filename == source or filename in source or source in filename:
                    detail = kb_get_doc(doc["id"])
                    if detail:
                        return {
                            "found": True,
                            "title": detail.get("title", ""),
                            "summary": detail.get("summary", ""),
                            "text": detail.get("text", ""),
                            "chunk_count": detail.get("chunk_count", 0),
                        }
        return {"found": False, "message": f"未找到匹配 '{source}' 的文档"}
    except Exception as exc:
        return {"error": f"获取文档详情失败: {exc}"}
