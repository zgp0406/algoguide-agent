"""评估 AlgoGuide 的原始检索排序和 RAG 低置信度门控。"""

from __future__ import annotations

import argparse
import json
import math
import os
import platform
import statistics
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


def percentile(values: list[float], ratio: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, math.ceil(len(ordered) * ratio) - 1))
    return ordered[index]


def normalize_source(value: str) -> str:
    return Path(str(value).replace("\\", "/")).name.lower()


def load_cases(path: Path, split: str) -> list[dict[str, Any]]:
    cases = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        case = json.loads(line)
        if split != "all" and case.get("split") != split:
            continue
        case["_line"] = line_number
        cases.append(case)
    if not cases:
        raise ValueError(f"评测集为空：split={split}")
    return cases


def mean(values: list[float]) -> float:
    return statistics.fmean(values) if values else 0.0


def load_index_info(repo: Path) -> dict[str, Any]:
    """读取索引元数据，确保结果可追溯到具体模型和知识块。"""
    meta_path = repo / "knowledge" / "index_meta.json"
    faiss_path = repo / "knowledge" / "index.faiss"
    info: dict[str, Any] = {
        "faiss_index_exists": faiss_path.exists(),
        "embedding_model": None,
        "chunk_count": 0,
    }
    if not meta_path.exists():
        return info
    payload = json.loads(meta_path.read_text(encoding="utf-8"))
    if isinstance(payload, dict):
        info["embedding_model"] = payload.get("model_name")
        chunks = payload.get("chunks")
        info["chunk_count"] = len(chunks) if isinstance(chunks, list) else 0
    return info


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", required=True, help="algoguide-agent 仓库路径")
    parser.add_argument("--dataset", required=True, help="JSONL 评测集")
    parser.add_argument("--output", default="rag_eval_result.json")
    parser.add_argument("--split", choices=["dev", "test", "all"], default="test")
    parser.add_argument("--k", type=int, default=3)
    parser.add_argument("--runs", type=int, default=3, help="每个问题重复次数，用于延迟统计")
    parser.add_argument("--warmup", type=int, default=5)
    parser.add_argument("--semantic-threshold", type=float, default=0.30)
    parser.add_argument("--lexical-threshold", type=float, default=2.0)
    args = parser.parse_args()

    repo = Path(args.repo).resolve()
    dataset = Path(args.dataset).resolve()
    if not (repo / "agent" / "retriever.py").exists():
        raise FileNotFoundError(f"不是有效的 AlgoGuide 仓库：{repo}")

    index_info = load_index_info(repo)
    if not index_info["faiss_index_exists"]:
        print("警告：knowledge/index.faiss 不存在，本次只能测关键词降级。", file=sys.stderr)

    # chain.py 在导入时读取阈值，因此必须先设置环境变量。
    os.environ["RAG_SEMANTIC_THRESHOLD"] = str(args.semantic_threshold)
    os.environ["RAG_LEXICAL_THRESHOLD"] = str(args.lexical_threshold)
    sys.path.insert(0, str(repo))

    from agent.chain import build_context
    from agent.retriever import retrieve_with_scores

    cases = load_cases(dataset, args.split)

    # 首次加载 embedding 模型和 FAISS 索引会明显偏慢，预热不计入结果。
    for case in cases[: min(args.warmup, len(cases))]:
        retrieve_with_scores(case["query"], k=args.k)

    rows: list[dict[str, Any]] = []
    retrieval_latencies: list[float] = []
    gate_latencies: list[float] = []

    for case in cases:
        query = str(case["query"])
        answerable = bool(case["answerable"])
        expected = {normalize_source(item) for item in case.get("relevant_sources", [])}

        ranked = []
        run_times = []
        for _ in range(args.runs):
            started = time.perf_counter()
            current = retrieve_with_scores(query, k=args.k)
            run_times.append((time.perf_counter() - started) * 1000)
            if not ranked:
                ranked = current
        retrieval_latencies.extend(run_times)

        sources = [normalize_source(getattr(item, "source", "")) for item in ranked]
        modes = [str(getattr(item, "retrieval_mode", "")) for item in ranked]
        scores = [round(float(getattr(item, "score", 0.0)), 6) for item in ranked]
        rank = next((index + 1 for index, source in enumerate(sources) if source in expected), None)

        gate_started = time.perf_counter()
        context_result = build_context(query)
        gate_latencies.append((time.perf_counter() - gate_started) * 1000)
        used_rag = bool(context_result[3])
        confidence = float(context_result[5])
        retrieval_mode = str(context_result[6])
        low_confidence_reason = context_result[7]

        rows.append(
            {
                "id": case["id"],
                "split": case["split"],
                "category": case["category"],
                "query": query,
                "answerable": answerable,
                "expected_sources": sorted(expected),
                "retrieved_sources": sources,
                "scores": scores,
                "retrieval_modes": modes,
                "relevant_rank": rank,
                "hit_at_1": bool(rank == 1),
                "hit_at_k": bool(rank is not None and rank <= args.k),
                "reciprocal_rank": 1.0 / rank if rank else 0.0,
                "ndcg_at_k": 1.0 / math.log2(rank + 1) if rank and rank <= args.k else 0.0,
                "used_rag": used_rag,
                "rag_confidence": round(confidence, 6),
                "gate_mode": retrieval_mode,
                "low_confidence_reason": low_confidence_reason,
                "retrieval_latency_ms": round(mean(run_times), 3),
            }
        )

    positives = [row for row in rows if row["answerable"]]
    negatives = [row for row in rows if not row["answerable"]]
    category_rows: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        category_rows[row["category"]].append(row)

    category_metrics = {}
    for category, items in sorted(category_rows.items()):
        positive_items = [item for item in items if item["answerable"]]
        category_metrics[category] = {
            "count": len(items),
            "hit_at_1": round(mean([float(item["hit_at_1"]) for item in positive_items]), 4),
            "hit_at_k": round(mean([float(item["hit_at_k"]) for item in positive_items]), 4),
            "positive_rag_acceptance": round(
                mean([float(item["used_rag"]) for item in positive_items]), 4
            ),
        }

    duplicate_queries = [
        query for query, count in Counter(row["query"] for row in rows).items() if count > 1
    ]
    summary = {
        "split": args.split,
        "case_count": len(rows),
        "positive_count": len(positives),
        "negative_count": len(negatives),
        "k": args.k,
        "runs_per_query": args.runs,
        "warmup_count": min(args.warmup, len(cases)),
        "semantic_threshold": args.semantic_threshold,
        "lexical_threshold": args.lexical_threshold,
        "hardware": {
            "platform": platform.platform(),
            "processor": platform.processor() or os.environ.get("PROCESSOR_IDENTIFIER", "unknown"),
            "python": platform.python_version(),
        },
        **index_info,
        "hit_at_1": round(mean([float(row["hit_at_1"]) for row in positives]), 4),
        "hit_at_k": round(mean([float(row["hit_at_k"]) for row in positives]), 4),
        "mrr": round(mean([row["reciprocal_rank"] for row in positives]), 4),
        "ndcg_at_k": round(mean([row["ndcg_at_k"] for row in positives]), 4),
        "positive_rag_acceptance": round(
            mean([float(row["used_rag"]) for row in positives]), 4
        ),
        "negative_rejection_rate": round(
            mean([float(not row["used_rag"]) for row in negatives]), 4
        ),
        "gate_accuracy": round(
            mean([float(row["used_rag"] == row["answerable"]) for row in rows]), 4
        ),
        "false_accept_count": sum(1 for row in negatives if row["used_rag"]),
        "false_reject_count": sum(1 for row in positives if not row["used_rag"]),
        "retrieval_latency_p50_ms": round(percentile(retrieval_latencies, 0.50), 3),
        "retrieval_latency_p95_ms": round(percentile(retrieval_latencies, 0.95), 3),
        "gate_latency_p50_ms": round(percentile(gate_latencies, 0.50), 3),
        "gate_latency_p95_ms": round(percentile(gate_latencies, 0.95), 3),
        "gate_mode_counts": dict(Counter(row["gate_mode"] for row in rows)),
        "duplicate_queries": duplicate_queries,
        "category_metrics": category_metrics,
    }

    output = Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps({"summary": summary, "cases": rows}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"\n详细结果：{output}")


if __name__ == "__main__":
    main()
