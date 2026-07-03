"""使用项目真实模型接口评估答案、引用和知识库外门控。"""

from __future__ import annotations

import argparse
import json
import math
import statistics
import sys
import time
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


def load_cases(path: Path) -> list[dict[str, Any]]:
    cases = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        case = json.loads(line)
        case["_line"] = line_number
        cases.append(case)
    if not cases:
        raise ValueError("端到端评测集为空")
    return cases


def concept_score(answer: str, groups: list[list[str]]) -> tuple[float, list[bool]]:
    """每组同义表达命中任意一个即得分，避免绑定单一措辞。"""
    if not groups:
        return 1.0, []
    lowered = answer.lower().replace(" ", "")
    matches = [
        any(str(term).lower().replace(" ", "") in lowered for term in group)
        for group in groups
    ]
    return sum(matches) / len(matches), matches


def forbidden_hits(answer: str, conclusions: list[str]) -> list[str]:
    lowered = answer.lower().replace(" ", "")
    return [
        item
        for item in conclusions
        if str(item).lower().replace(" ", "") in lowered
    ]


def write_result(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", required=True)
    parser.add_argument("--dataset", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--progress", default="")
    parser.add_argument("--semantic-threshold", type=float, default=0.30)
    args = parser.parse_args()

    repo = Path(args.repo).resolve()
    dataset = Path(args.dataset).resolve()
    output = Path(args.output).resolve()
    progress = Path(args.progress).resolve() if args.progress else None

    # chain.py 在导入时读取阈值。
    import os

    os.environ["RAG_SEMANTIC_THRESHOLD"] = str(args.semantic_threshold)
    sys.path.insert(0, str(repo))

    from agent.chain import ChatRequest, chat

    cases = load_cases(dataset)
    rows: list[dict[str, Any]] = []

    for index, case in enumerate(cases, 1):
        started = time.perf_counter()
        response = chat(ChatRequest(message=str(case["query"])))
        elapsed_ms = (time.perf_counter() - started) * 1000

        answer = response.answer or ""
        expected_sources = {
            normalize_source(item) for item in case.get("relevant_sources", [])
        }
        actual_sources = [normalize_source(item) for item in response.sources]
        groups = case.get("required_concepts", [])
        coverage, concept_matches = concept_score(answer, groups)
        bad_conclusions = forbidden_hits(answer, case.get("forbidden_conclusions", []))
        answerable = bool(case["answerable"])
        source_hit = bool(expected_sources & set(actual_sources)) if answerable else not actual_sources
        answer_pass = coverage == 1.0 and not bad_conclusions if answerable else True

        rows.append(
            {
                "id": case["id"],
                "category": case["category"],
                "query": case["query"],
                "answerable": answerable,
                "answer": answer,
                "answer_length": len(answer),
                "required_concepts": groups,
                "concept_matches": concept_matches,
                "concept_coverage": round(coverage, 4),
                "forbidden_hits": bad_conclusions,
                "answer_pass": answer_pass,
                "expected_sources": sorted(expected_sources),
                "actual_sources": actual_sources,
                "source_hit": source_hit,
                "used_rag": response.used_rag,
                "rag_confidence": response.rag_confidence,
                "retrieval_mode": response.retrieval_mode,
                "low_confidence_reason": response.low_confidence_reason,
                "error_type": response.error_type,
                "error_message": response.error_message,
                "latency_ms": round(elapsed_ms, 3),
            }
        )

        # 每题落盘，长时间评测中断后仍可复查已完成结果。
        write_result(output, {"status": "running", "completed": index, "total": len(cases), "cases": rows})
        if progress:
            progress.write_text(
                json.dumps(
                    {
                        "completed": index,
                        "total": len(cases),
                        "last_id": case["id"],
                        "last_error_type": response.error_type,
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

    positives = [row for row in rows if row["answerable"]]
    negatives = [row for row in rows if not row["answerable"]]
    latencies = [float(row["latency_ms"]) for row in rows]
    successful = [row for row in rows if not row["error_type"]]
    grounded = [row for row in positives if row["answer_pass"] and row["source_hit"]]
    model_only = [row for row in positives if row["answer_pass"] and not row["source_hit"]]
    factual_negatives = [row for row in negatives if row["category"] != "ambiguous"]
    returned_source_count = sum(len(row["actual_sources"]) for row in positives)
    correct_source_count = sum(
        sum(source in row["expected_sources"] for source in row["actual_sources"])
        for row in positives
    )
    all_sources_relevant_count = sum(
        bool(row["actual_sources"])
        and all(source in row["expected_sources"] for source in row["actual_sources"])
        for row in positives
    )

    summary = {
        "case_count": len(rows),
        "positive_count": len(positives),
        "negative_count": len(negatives),
        "semantic_threshold": args.semantic_threshold,
        "api_success_rate": round(len(successful) / len(rows), 4),
        "answer_pass_rate": round(sum(row["answer_pass"] for row in positives) / len(positives), 4),
        "mean_concept_coverage": round(
            statistics.fmean(row["concept_coverage"] for row in positives), 4
        ),
        "source_hit_rate": round(sum(row["source_hit"] for row in positives) / len(positives), 4),
        "source_precision": round(
            correct_source_count / returned_source_count if returned_source_count else 0.0,
            4,
        ),
        "all_sources_relevant_rate": round(all_sources_relevant_count / len(positives), 4),
        "grounded_answer_rate": round(len(grounded) / len(positives), 4),
        "model_only_correct_count": len(model_only),
        "negative_no_rag_rate": round(
            sum(not row["used_rag"] for row in negatives) / len(negatives), 4
        ),
        "negative_no_source_rate": round(
            sum(not row["actual_sources"] for row in negatives) / len(negatives), 4
        ),
        "factual_negative_generated_answer_rate": round(
            sum(bool(row["answer"].strip()) for row in factual_negatives) / len(factual_negatives),
            4,
        ),
        "false_accept_count": sum(row["used_rag"] for row in negatives),
        "false_reject_count": sum(not row["used_rag"] for row in positives),
        "latency_p50_ms": round(percentile(latencies, 0.50), 3),
        "latency_p95_ms": round(percentile(latencies, 0.95), 3),
        "error_type_counts": {
            error_type: sum(row["error_type"] == error_type for row in rows)
            for error_type in sorted({row["error_type"] for row in rows if row["error_type"]})
        },
    }
    write_result(output, {"status": "completed", "summary": summary, "cases": rows})
    if progress:
        progress.write_text(
            json.dumps({"completed": len(cases), "total": len(cases), "status": "completed"}, ensure_ascii=False),
            encoding="utf-8",
        )
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
