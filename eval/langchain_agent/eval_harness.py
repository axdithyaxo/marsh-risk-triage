import json
import os
import time

from agent import build_graph, eval_harness_decision_provider, IntakeRejected
from compliance import AuthorityLedger, PromptInjectionError

HERE = os.path.dirname(os.path.abspath(__file__))
CASES_PATH = os.path.join(HERE, "..", "cases.json")


def run_eval():
    with open(CASES_PATH) as f:
        cases = json.load(f)["cases"]

    ledger = AuthorityLedger(hmac_secret="eval-harness-demo-secret")
    graph = build_graph(ledger, eval_harness_decision_provider)

    results = []
    start = time.time()

    for case in cases:
        case_result = {
            "case_id": case["id"],
            "expected_decision": case["expected_decision"],
            "expected_min_severity": case.get("expected_min_severity"),
        }
        try:
            final_state = graph.invoke({"raw_submission": case["submission"]})
            case_result["actual_decision"] = final_state["final_decision"]
            case_result["actual_min_severity"] = final_state.get("consolidated_risk_level")
            case_result["branch_detail"] = final_state.get("branch_results")
            case_result["oversight_level"] = final_state.get("oversight_level")
        except IntakeRejected:
            case_result["actual_decision"] = "REJECTED_AT_INTAKE"
            case_result["actual_min_severity"] = None
        except PromptInjectionError as e:
            case_result["actual_decision"] = "BLOCKED"
            case_result["actual_min_severity"] = None
            case_result["block_reason"] = str(e)
        except Exception as e:
            case_result["actual_decision"] = f"ERROR:{type(e).__name__}"
            case_result["actual_min_severity"] = None
            case_result["error_detail"] = str(e)

        case_result["match"] = case_result["actual_decision"] == case_result["expected_decision"]
        case_result["severity_match"] = (
            case_result.get("actual_min_severity") == case_result.get("expected_min_severity")
        )
        results.append(case_result)
        print(f"[{case['id']}] expected={case_result['expected_decision']:<22} "
              f"actual={case_result['actual_decision']:<22} match={case_result['match']}")

    elapsed = time.time() - start
    ledger.save(os.path.join(HERE, "authority_ledger.json"))

    n = len(results)
    n_match = sum(r["match"] for r in results)
    false_negatives = [r for r in results if r["expected_decision"] == "REFER" and r["actual_decision"] == "BIND"]

    summary = {
        "accuracy": n_match / n,
        "accuracy_fraction": f"{n_match}/{n}",
        "false_negative_count": len(false_negatives),
        "false_negative_case_ids": [r["case_id"] for r in false_negatives],
        "wall_clock_seconds": round(elapsed, 2),
        "model": "qwen2.5:14b (local, via Ollama, same instance used by the Lar side)",
    }

    output = {"summary": summary, "cases": results}
    out_path = os.path.join(HERE, "eval_results.json")
    with open(out_path, "w") as f:
        json.dump(output, f, indent=2)

    print("\n" + "=" * 70)
    print(json.dumps(summary, indent=2))
    return output


if __name__ == "__main__":
    run_eval()
