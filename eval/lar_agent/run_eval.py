"""
Eval harness for the Lar P&C risk triage agent -- runs every case in
eval_cases.json through the real pipeline (real LLM calls, real guard
nodes, real signed audit ledger) and reports exact-match accuracy,
false-negative rate, and whether the consolidated summary surfaced the
worst branch. See SPEC.md for the full reporting contract.
"""
import os
import json
import time

from lar.executor import GraphExecutor
from agent import build_graph

HERE = os.path.dirname(os.path.abspath(__file__))
CASES_PATH = os.path.join(HERE, "..", "cases.json")
RESULTS_PATH = os.path.join(HERE, "eval_results.json")
LEDGER_PATH = os.path.join(HERE, "lar_logs", "authority_ledger.json")


def classify_outcome(last_step: dict) -> tuple:
    """Returns (decision, min_severity) from the final yielded log entry."""
    if last_step.get("outcome") == "error":
        err = last_step.get("error", "") or ""
        if "Adversarial prompt injection" in err:
            return "BLOCKED", None
        if "[INTAKE_REJECTED]" in err:
            return "REJECTED_AT_INTAKE", None
        return f"ERROR:{err[:150]}", None

    sa = last_step.get("state_after", {})
    decision = sa.get("final_decision") or "NO_DECISION"

    levels = []
    for key in ("property_analysis", "financial_analysis", "regulatory_analysis"):
        raw = sa.get(key) or ""
        try:
            start, end = raw.find("{"), raw.rfind("}") + 1
            parsed = json.loads(raw[start:end]) if start >= 0 and end > start else {}
            lvl = parsed.get("risk_level")
            if lvl:
                levels.append(lvl.upper())
        except (json.JSONDecodeError, ValueError):
            continue
    order = {"LOW": 0, "MEDIUM": 1, "HIGH": 2, "CRITICAL": 3}
    worst = max(levels, key=lambda l: order.get(l, -1)) if levels else None
    return decision, worst


def main():
    with open(CASES_PATH) as f:
        cases = json.load(f)["cases"]

    start_node, ledger = build_graph()
    results = []
    t_total0 = time.time()

    for case in cases:
        t0 = time.time()
        executor = GraphExecutor(hmac_secret="marsh-eval-not-a-real-secret")
        last = None
        try:
            for step in executor.run_step_by_step(start_node, {"raw_submission": case["submission"]}):
                last = step
        except Exception as e:
            last = {"outcome": "error", "error": f"UNCAUGHT:{type(e).__name__}:{e}", "state_after": {}}
        elapsed = time.time() - t0

        actual_decision, actual_min_severity = classify_outcome(last)
        expected_decision = case["expected_decision"]
        expected_min_severity = case.get("expected_min_severity")

        match = actual_decision == expected_decision
        severity_match = (
            expected_min_severity is None
            or actual_min_severity == expected_min_severity
        )

        results.append({
            "case_id": case["id"],
            "expected_decision": expected_decision,
            "actual_decision": actual_decision,
            "match": match,
            "expected_min_severity": expected_min_severity,
            "actual_min_severity": actual_min_severity,
            "severity_match": severity_match,
            "elapsed_seconds": round(elapsed, 1),
        })
        print(f"[{case['id']}] expected={expected_decision} actual={actual_decision} "
              f"match={match} severity_expected={expected_min_severity} "
              f"severity_actual={actual_min_severity} ({elapsed:.1f}s)")

    total_elapsed = time.time() - t_total0

    false_negatives = [
        r for r in results
        if r["expected_decision"] == "REFER" and r["actual_decision"] == "BIND"
    ]
    accuracy = sum(1 for r in results if r["match"]) / len(results)

    ledger.save(LEDGER_PATH)

    summary = {
        "total_cases": len(results),
        "correct": sum(1 for r in results if r["match"]),
        "accuracy": round(accuracy, 3),
        "false_negatives": len(false_negatives),
        "false_negative_case_ids": [r["case_id"] for r in false_negatives],
        "severity_surfacing_correct": sum(1 for r in results if r["severity_match"]),
        "wall_clock_seconds": round(total_elapsed, 1),
    }

    output = {"results": results, "summary": summary}
    with open(RESULTS_PATH, "w") as f:
        json.dump(output, f, indent=2)

    print("\n" + "=" * 60)
    print("SUMMARY:", json.dumps(summary, indent=2))
    print("=" * 60)


if __name__ == "__main__":
    main()
