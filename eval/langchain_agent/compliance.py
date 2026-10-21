"""
Hand-rolled EU AI Act-style compliance primitives for the LangChain/LangGraph
side of the comparison. None of this ships with langchain-core or langgraph --
every function here is something the Lar side gets as an imported, tested
library primitive instead of project-owned code.
"""
import re
import json
import hmac
import hashlib
import datetime
import os
from dataclasses import dataclass, field
from typing import Dict, List, Literal, Optional


# ---------------------------------------------------------------------------
# PII redaction -- same scope/limitation as the Lar side: regex over known
# field *shapes* (PPSN, phone, email), no name/address coverage (that needs
# real NER, not a regex list).
# ---------------------------------------------------------------------------

_PPSN_RE = re.compile(r"\b\d{7}[A-Za-z]{1,2}\b")
_PHONE_RE = re.compile(r"\b0\d{2}[-\s]?\d{3}[-\s]?\d{4}\b")
_EMAIL_RE = re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b")


def redact_pii(text: str) -> str:
    text = _PPSN_RE.sub("[REDACTED-PPSN]", text)
    text = _PHONE_RE.sub("[REDACTED-PHONE]", text)
    text = _EMAIL_RE.sub("[REDACTED-EMAIL]", text)
    return text


# ---------------------------------------------------------------------------
# Prompt-injection guard -- same fixed 7-phrase heuristic list and semantics
# as lar.compliance.prompt_injection_guard.PromptInjectionGuard.
# ---------------------------------------------------------------------------

class PromptInjectionError(Exception):
    pass


DEFAULT_INJECTION_HEURISTICS = [
    "ignore all previous instructions",
    "forget your previous instructions",
    "system prompt",
    "you are now",
    "instead of what you were doing",
    "override",
    "disregard",
]


def check_prompt_injection(text: str, heuristics: Optional[List[str]] = None) -> None:
    heuristics = heuristics or DEFAULT_INJECTION_HEURISTICS
    lower = text.lower()
    hits = [h for h in heuristics if h in lower]
    if hits:
        raise PromptInjectionError(
            f"Adversarial prompt injection detected based on heuristics: {hits}"
        )


# ---------------------------------------------------------------------------
# Policy registry + oversight scoring -- hand-written equivalent of
# lar.compliance.policy_registry + lar.compliance.risk_scorer. LangChain/
# LangGraph has no analogous primitive at all; this entire file section is
# project-owned logic with zero library support.
# ---------------------------------------------------------------------------

@dataclass
class ActionPolicy:
    domain: str
    process: str
    decision_type: str
    risk_tier: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
    reversibility: bool
    oversight_level: Literal["RETROSPECTIVE", "REALTIME", "PRE_EXECUTION"]
    affected_parties: Literal["USER_ONLY", "THIRD_PARTY", "BOTH"] = "USER_ONLY"


POLICY_REGISTRY: Dict[str, ActionPolicy] = {
    "PROPERTY_RISK_SUBMISSION": ActionPolicy(
        domain="INSURANCE",
        process="underwriting",
        decision_type="bind_or_refer",
        risk_tier="HIGH",
        reversibility=False,
        oversight_level="PRE_EXECUTION",
        affected_parties="THIRD_PARTY",
    )
}


def compute_oversight_level(action_type: str, confidence: float) -> Dict:
    """
    Mirrors lar.compliance.risk_scorer.RiskScorerNode.execute()'s logic
    exactly (including its one-tier-per-signal escalation ladder and the
    reversibility=False -> PRE_EXECUTION override), so the two sides are
    scoring the same way, not just producing the same final number by luck.
    """
    policy = POLICY_REGISTRY.get(action_type)
    oversight_level = "RETROSPECTIVE"
    reasoning = []

    if policy:
        oversight_level = policy.oversight_level
        reasoning.append(f"base policy oversight_level={policy.oversight_level}")

        if not policy.reversibility:
            oversight_level = "PRE_EXECUTION"
            reasoning.append("irreversible action -> forced PRE_EXECUTION")

        if confidence < 0.7:
            if oversight_level == "RETROSPECTIVE":
                oversight_level = "REALTIME"
                reasoning.append(f"confidence {confidence}<0.7 -> escalated RETROSPECTIVE->REALTIME")
            elif oversight_level == "REALTIME":
                oversight_level = "PRE_EXECUTION"
                reasoning.append(f"confidence {confidence}<0.7 -> escalated REALTIME->PRE_EXECUTION")

        if policy.affected_parties in ("THIRD_PARTY", "BOTH"):
            if oversight_level == "RETROSPECTIVE":
                oversight_level = "REALTIME"
                reasoning.append("third-party affected -> escalated RETROSPECTIVE->REALTIME")

    return {"oversight_level": oversight_level, "reasoning": reasoning}


# ---------------------------------------------------------------------------
# Authority ledger -- hand-rolled HMAC-signed append-only JSON ledger.
# Equivalent to lar.compliance.authority_record.AuthorityLedger.
# ---------------------------------------------------------------------------

class AuthorityLedger:
    def __init__(self, hmac_secret: Optional[str] = None):
        self.hmac_secret = hmac_secret
        self._records: List[Dict] = []

    def record(
        self,
        action_description: str,
        stakeholder_id: str,
        stakeholder_role: str,
        decision: str,
        rationale: str,
        risk_score: Optional[Dict] = None,
    ) -> Dict:
        rec = {
            "record_type": "AUTHORITY_EXERCISE",
            "eu_ai_act_article": "Art. 12, 14",
            "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
            "action_description": action_description,
            "stakeholder_id": stakeholder_id,
            "stakeholder_role": stakeholder_role,
            "decision": decision,
            "rationale": rationale,
            "risk_score_at_decision": risk_score,
        }
        self._records.append(rec)
        return rec

    def save(self, filepath: str) -> None:
        payload = {
            "ledger_type": "AUTHORITY_EXERCISE_LEDGER",
            "eu_ai_act_reference": "Articles 12-14: Human Oversight Evidence Chain",
            "total_records": len(self._records),
            "records": self._records,
        }
        if self.hmac_secret:
            canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
            sig = hmac.new(
                key=self.hmac_secret.encode("utf-8"),
                msg=canonical.encode("utf-8"),
                digestmod=hashlib.sha256,
            ).hexdigest()
            payload["signature"] = sig
        os.makedirs(os.path.dirname(filepath) or ".", exist_ok=True)
        with open(filepath, "w") as f:
            json.dump(payload, f, indent=2)


_SEVERITY_ORDER = {"LOW": 0, "MEDIUM": 1, "HIGH": 2, "CRITICAL": 3}


def worst_severity(levels: List[str]) -> str:
    return max(levels, key=lambda l: _SEVERITY_ORDER.get(l, -1))
