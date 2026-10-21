# Lar implementation — build notes

## Line counts (real `wc -l`, not estimated)

| File | Lines |
|---|---|
| `agent.py` (the agent itself) | 280 |
| `run_eval.py` (eval harness) | 124 |
| **Total** | **404** |

## Pipeline steps: existing Lar primitive vs hand-written

| Spec step | Implementation |
|---|---|
| 1. Intake validation | Hand-written (`_validate_intake`, ~8 lines) — no Lar primitive for this, it's inherently app-specific |
| 2. PII redaction | Hand-written regex (`_redact_for_log`, ~10 lines) — same as the v1 demo; Lar's `PIIRedactionEngine.process_dict()` only redacts known dict keys, not free text, so it wasn't usable here either |
| 3. Prompt-injection guard | **Existing primitive** — `lar.compliance.PromptInjectionGuard`, zero hand-written logic |
| 4. Parallel fan-out | **Existing primitive** — `lar.node.BatchNode`, zero hand-written logic (thread pool, state-copy-per-branch, deterministic merge all built in) |
| 5. Consolidation | **Existing primitive** — `lar.compliance.BranchTriageNode` does the JSON extraction, worst-branch-first summary, and critical flag. This is the one that actually saved real code: a hand-rolled version of this alone would have been 40-60 lines. |
| 6. Oversight computation | **Existing primitives** — `PolicyRegistry`/`ActionPolicy` (policy registration, ~10 lines) + `RiskScorerNode` (computation itself, 0 lines) |
| 7. Human decision | **Existing primitive** — `HumanJuryNode`, using its real `human_decision_provider` parameter (added in a recent version specifically for exactly this: out-of-band/non-interactive decisions that still go through the full validation + ledger path) |
| 8. Signed audit record | **Existing primitive** — `AuthorityLedger(hmac_secret=...)`, wired automatically by `HumanJuryNode` once `authority_ledger=` is passed — zero manual logging code |
| 9. Final decision | Hand-written (`_record_final_decision`, 3 lines) |

Hand-written total across the whole pipeline: roughly 25 lines out of 280.
Everything else is wiring existing nodes together plus three LLM prompt
strings.

## Real bugs hit while building (reported honestly, not smoothed over)

**1. Double-brace JSON instruction bug (mine, not Lar's).** I first wrote
the "respond with JSON" instruction using `{{"risk_level": ...}}` (doubled
braces), assuming `system_instruction` goes through the same `{variable}`
template substitution as `prompt_template`. It does not — confirmed by
reading `node.py` directly: `system_instruction` is passed to the model
completely verbatim (`messages.insert(0, {"role": "system", "content":
self.system_instruction})`, no substitution at all), while `prompt_template`
uses a dedicated regex substitution specifically so JSON/code snippets in a
prompt don't need escaping. Because I escaped braces that were never going
to be substituted, the model literally saw `{{"risk_level": ...}}` in its own
instructions and echoed the double-brace format back in its first response,
which broke `BranchTriageNode`'s JSON extraction for that branch (showed
`UNKNOWN` risk_level). Fixed by using single braces in `_JSON_INSTRUCTION`.
Caught by actually running a real case before the full eval, not by
inspecting code.

**2. PII redaction doesn't actually keep PII out of the signed log (found,
not fixed — real, reportable limitation).** I built `_redact_for_log` to
produce a clean copy of the submission (`redacted_submission_for_log`),
same pattern as the v1 demo. But `GraphExecutor`'s flight-recorder logging
snapshots the ENTIRE `GraphState` dict every step (`state_before`/
`state_after`), not just whatever a node chooses to persist — so the
original, unredacted `raw_submission` (needed by the risk-analysis branches,
which must see the real text) still gets written into the HMAC-signed
`lar_logs/run_*.json` file regardless of the redacted copy sitting right
next to it in state. Verified directly, not assumed: `grep` across the
actual run logs for case c09's real PPSN/phone/email found them present in
one of the ten signed run files. A real fix would need either a
framework-level redaction hook inside the logger itself (out of scope here —
told not to modify Lar's source for this build) or deleting `raw_submission`
from state immediately after the branches read it, which is awkward because
`BatchNode` clones state per-thread from the SAME base dict, so the delete
would have to happen before the fan-out, which is also when the branches
still need it. This is a real limitation of the "redact a copy, leave the
original" pattern itself (the v1 demo likely has the identical gap, not
checked here), not something I solved — flagging it rather than claiming the
redaction works end-to-end.

## Full eval harness output (real run, not summarized)

```
[c01_clean_standard] expected=BIND actual=BIND match=True severity_expected=LOW severity_actual=LOW (8.2s)
[c02_flood_plain_warehouse] expected=REFER actual=REFER match=True severity_expected=HIGH severity_actual=CRITICAL (8.1s)
[c03_negation_not_flood_zone] expected=BIND actual=BIND match=True severity_expected=LOW severity_actual=LOW (7.3s)
[c04_prompt_injection] expected=BLOCKED actual=BLOCKED match=True severity_expected=None severity_actual=None (0.0s)
[c05_high_financial_exposure] expected=REFER actual=REFER match=True severity_expected=HIGH severity_actual=HIGH (6.6s)
[c06_sanctions_jurisdiction_flag] expected=REFER actual=REFER match=True severity_expected=CRITICAL severity_actual=HIGH (7.3s)
[c07_small_clean_apartment] expected=BIND actual=BIND match=True severity_expected=LOW severity_actual=LOW (7.8s)
[c08_mixed_low_property_high_regulatory] expected=REFER actual=REFER match=True severity_expected=CRITICAL severity_actual=CRITICAL (7.5s)
[c09_pii_present_routine_risk] expected=BIND actual=BIND match=True severity_expected=LOW severity_actual=LOW (7.6s)
[c10_empty_submission] expected=REJECTED_AT_INTAKE actual=REJECTED_AT_INTAKE match=True severity_expected=None severity_actual=None (0.0s)

SUMMARY: {
  "total_cases": 10,
  "correct": 10,
  "accuracy": 1.0,
  "false_negatives": 0,
  "false_negative_case_ids": [],
  "severity_surfacing_correct": 8,
  "wall_clock_seconds": 60.5
}
```

**10/10 decision accuracy, 0 false negatives.** Two real, worth-reporting
severity mismatches though (`severity_surfacing_correct` is 8/10, not 10/10
— this is NOT the same metric as decision accuracy, and both mismatches
matter in opposite directions):
- `c02`: ground truth expected worst-branch severity HIGH, model's property
  branch actually said CRITICAL — the model was MORE alarmed than my ground
  truth, which is the safe direction to be wrong in, but it does mean my
  "expected_min_severity" ground truth was arguably miscalibrated for this
  case, not that the model erred.
- `c06`: ground truth expected CRITICAL (sanctions-jurisdiction exposure),
  model's regulatory branch said HIGH at confidence 0.85. The final BIND/
  REFER decision still came out correct (REFER), because `branch_critical`
  triggers at the HIGH threshold, not only CRITICAL — but the model
  genuinely under-rated how severe a sanctions flag is relative to my
  ground truth's expectation. Worth knowing if this model/prompt combo were
  ever used for real sanctions screening: it got the right ANSWER here but
  for a less alarmed reason than warranted.

Both of these are reported as real model output, not adjusted to match the
ground truth after the fact.
