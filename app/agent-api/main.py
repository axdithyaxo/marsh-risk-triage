"""
FastAPI wrapper around the Lar P&C risk triage agent
(../../eval/lar_agent/agent.py). Two-phase API, because a real
human-oversight decision can't happen inside one synchronous HTTP call:

  POST /assess         -> runs intake -> redact -> injection guard ->
                           3-way parallel LLM fan-out -> consolidation.
                           Returns the branch findings plus an assessment_id,
                           WITHOUT deciding bind/refer -- that decision
                           belongs to whoever is using the app.

  POST /assess/decide   -> takes the assessment_id and the ACTUAL decision the
                           app's user made (bind/refer + rationale), looks the
                           evidence up SERVER-SIDE, and runs it through
                           HumanJuryNode + a persistent AuthorityLedger,
                           producing a genuine HMAC-signed audit record of
                           what a real person decided.

The client never sends back the model's findings or confidence: those are
stored here at /assess time and looked up by id, so a caller can't sign
fabricated evidence into the ledger. Each assessment can be decided once.

Config (environment variables, all optional for local dev):
  TRIAGE_MODEL            LLM for the branches (default ollama/qwen2.5:14b)
  TRIAGE_HMAC_SECRET      signing key for run logs and the ledger
  TRIAGE_LEDGER_PATH      where the signed ledger is saved
  TRIAGE_ALLOWED_ORIGIN   CORS origin for the frontend
  TRIAGE_RAG              1 (default) grounds each branch in retrieved
                          underwriting guidelines; 0 disables retrieval
"""
import os
import sys
import time
import uuid
import warnings
from pathlib import Path

HERE = Path(__file__).resolve().parent
# The pipeline's prompts, helpers and policy registration live in eval/ so the
# app and the evaluation harness exercise the exact same code.
sys.path.insert(0, str(HERE.parent.parent / "eval" / "lar_agent"))

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from lar.executor import GraphExecutor
from lar.node import LLMNode, ToolNode, BatchNode, HumanJuryNode
from lar.compliance import PromptInjectionGuard, BranchTriageNode, RiskScorerNode, AuthorityLedger

import agent as lar_agent  # reuses prompts, constants, helper functions, and
                            # the PolicyRegistry registration that already
                            # runs at import time inside agent.py

DEV_SECRET = "dev-only-not-a-real-secret"
HMAC_SECRET = os.environ.get("TRIAGE_HMAC_SECRET", DEV_SECRET)
if HMAC_SECRET == DEV_SECRET:
    warnings.warn("TRIAGE_HMAC_SECRET not set: signing with a public dev key. "
                  "Fine for a local demo, not for anything real.")

LEDGER_PATH = os.environ.get("TRIAGE_LEDGER_PATH", str(HERE / "data" / "app_authority_ledger.json"))
ALLOWED_ORIGIN = os.environ.get("TRIAGE_ALLOWED_ORIGIN", "http://localhost:5173")
RAG_ENABLED = os.environ.get("TRIAGE_RAG", "1") != "0"

app = FastAPI(title="Marsh Risk Triage Agent API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[ALLOWED_ORIGIN],
    allow_methods=["*"],
    allow_headers=["*"],
)

# One ledger instance for the whole server's lifetime, so every real human
# decision accumulates into the same signed file instead of each request's
# .save() overwriting the last one.
ledger = AuthorityLedger(hmac_secret=HMAC_SECRET)

# assessment_id -> the evidence /assess produced. In-memory: it is lost on
# restart, which is acceptable for a demo (the human re-runs the assessment)
# and noted in the README. A real deployment would persist this.
_assessments: dict = {}


class AssessRequest(BaseModel):
    submission: str


class DecideRequest(BaseModel):
    assessment_id: str
    decision: str  # "bind" or "refer" -- the REAL human's choice
    rationale: str


def _build_phase1_graph():
    """intake -> redact -> injection guard -> fan-out -> branch triage ->
    confidence aggregation. Stops BEFORE RiskScorerNode/HumanJuryNode --
    this phase never decides bind/refer, it only produces the evidence a
    human decision needs."""
    if RAG_ENABLED:
        branch_nodes = lar_agent.build_rag_branch_nodes()
    else:
        branch_nodes = [
            LLMNode(
                model_name=lar_agent.MODEL, system_instruction=system,
                prompt_template="Submission:\n{raw_submission}", output_key=key, next_node=None,
            )
            for system, key in (
                (lar_agent.PROPERTY_SYSTEM, "property_analysis"),
                (lar_agent.FINANCIAL_SYSTEM, "financial_analysis"),
                (lar_agent.REGULATORY_SYSTEM, "regulatory_analysis"),
            )
        ]
    batch_node = BatchNode(nodes=branch_nodes, next_node=None)
    # With RAG on, retrieval runs once before the fan-out (see agent.py).
    first_stage = batch_node
    if RAG_ENABLED:
        first_stage = ToolNode(
            tool_function=lar_agent._retrieve_guidelines, input_keys=["__state__"],
            output_key=None, next_node=batch_node,
        )

    confidence_node = ToolNode(
        tool_function=lar_agent._aggregate_confidence, input_keys=["__state__"], output_key=None, next_node=None,
    )
    branch_triage = BranchTriageNode(
        branch_output_keys=["property_analysis", "financial_analysis", "regulatory_analysis"],
        risk_level_key="risk_level", finding_key="finding", critical_threshold="HIGH",
        summary_state_key="branch_findings_summary", critical_flag_key="branch_critical",
        next_node=confidence_node,
    )
    batch_node.next_node = branch_triage

    injection_guard = PromptInjectionGuard(
        input_keys=["raw_submission"], block_on_detection=True, next_node=first_stage,
    )
    redact_node = ToolNode(
        tool_function=lar_agent._redact_for_log, input_keys=["__state__"], output_key=None, next_node=injection_guard,
    )
    intake_node = ToolNode(
        tool_function=lar_agent._validate_intake, input_keys=["__state__"], output_key=None, next_node=redact_node,
    )
    return intake_node


def _classify_failure(msg: str) -> dict:
    if "Adversarial prompt injection" in msg:
        return {"status": "blocked", "reason": msg}
    if "[INTAKE_REJECTED]" in msg:
        return {"status": "rejected_at_intake", "reason": msg}
    return {"status": "error", "reason": msg}


@app.post("/assess")
def assess(req: AssessRequest):
    start_node = _build_phase1_graph()
    executor = GraphExecutor(hmac_secret=HMAC_SECRET)
    t0 = time.time()
    last = None
    try:
        for step in executor.run_step_by_step(start_node, {"raw_submission": req.submission}):
            last = step
    except Exception as e:
        return _classify_failure(f"{type(e).__name__}: {e}")
    elapsed = time.time() - t0

    # GraphExecutor reports a failing node as a final log step with
    # outcome="error" instead of raising, so the except above is not enough:
    # without this check a blocked or rejected submission fell through and
    # was presented as a normal assessment with empty findings.
    if last is None or last.get("outcome") == "error":
        return _classify_failure((last or {}).get("error") or "no steps executed")

    sa = last.get("state_after", {})
    assessment_id = uuid.uuid4().hex
    _assessments[assessment_id] = {
        "branch_findings_summary": sa.get("branch_findings_summary"),
        "branch_critical": sa.get("branch_critical"),
        "model_confidence": sa.get("model_confidence"),
    }
    return {
        "status": "needs_review",
        "assessment_id": assessment_id,
        "elapsed_seconds": round(elapsed, 1),
        "property_analysis": sa.get("property_analysis"),
        "financial_analysis": sa.get("financial_analysis"),
        "regulatory_analysis": sa.get("regulatory_analysis"),
        "branch_findings_summary": sa.get("branch_findings_summary"),
        "branch_critical": sa.get("branch_critical"),
        "model_confidence": sa.get("model_confidence"),
        "guidelines_consulted": sa.get("guidelines_consulted"),
    }


@app.post("/assess/decide")
def decide(req: DecideRequest):
    if req.decision not in ("bind", "refer"):
        raise HTTPException(status_code=400, detail="decision must be 'bind' or 'refer'")
    if not req.rationale.strip():
        raise HTTPException(status_code=400, detail="rationale is required")

    # pop(): an assessment can be decided exactly once, so a replayed request
    # can't write a second signed decision for the same evidence.
    evidence = _assessments.pop(req.assessment_id, None)
    if evidence is None:
        raise HTTPException(status_code=404, detail="unknown or already-decided assessment_id")

    def human_decision_provider(ctx: dict):
        # The decision was already made by a real person in the frontend
        # before this request was even sent -- this just carries it through
        # HumanJuryNode's real validation + ledger-writing path.
        return req.decision, req.rationale

    final_record = ToolNode(
        tool_function=lar_agent._record_final_decision, input_keys=["__state__"], output_key=None, next_node=None,
    )
    jury = HumanJuryNode(
        prompt="Underwriting decision for this submission",
        choices=["bind", "refer"],
        output_key="human_decision",
        context_keys=["branch_findings_summary", "branch_critical"],
        next_node=final_record,
        authority_ledger=ledger,
        stakeholder_id="marsh-app-user",
        stakeholder_role="UNDERWRITING_REVIEWER",
        action_description="Bind/refer decision on P&C submission after 3-way risk fan-out",
        risk_score_key="model_confidence",
        human_decision_provider=human_decision_provider,
    )
    risk_scorer = RiskScorerNode(
        next_node=final_record, jury_node=jury,
        confidence_key="model_confidence", action_type_key="action_type",
    )

    executor = GraphExecutor(hmac_secret=HMAC_SECRET)
    initial_state = {**evidence, "action_type": "PROPERTY_RISK_SUBMISSION"}
    last = None
    for step in executor.run_step_by_step(risk_scorer, initial_state):
        last = step
    sa = last.get("state_after", {})

    Path(LEDGER_PATH).parent.mkdir(parents=True, exist_ok=True)
    ledger.save(LEDGER_PATH)  # whole accumulated ledger, not just this record

    return {
        "status": "decided",
        "final_decision": sa.get("final_decision"),
        "computed_oversight_level": sa.get("computed_oversight_level"),
        "ledger_record": ledger.get_records()[-1] if ledger.get_records() else None,
    }
