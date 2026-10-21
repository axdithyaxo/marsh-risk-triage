# Marsh Risk Triage

A property & casualty underwriting triage agent, built end to end for Marsh's
*Software Engineer, Generative AI and Innovation* role (req `R_355019`): a
React/TypeScript front end, a Node/Express/TypeScript API, and a Python
service running a multi-agent LLM pipeline with guardrails, human sign-off and
a signed audit trail. All submissions are synthetic; no real client data.

```
React + TS  ──fetch──▶  Express + TS  ──fetch──▶  FastAPI + Lár  ──▶  local LLM (Ollama)
 app/frontend            app/backend              app/agent-api
```

## What it does

1. **Intake validation** rejects empty or whitespace-only submissions.
2. **PII redaction** (PPSN, phone, email) for the persisted log copy.
3. **Prompt-injection guard** blocks adversarial input before any model sees it.
4. **Three independent risk analyses in parallel** (property, financial,
   regulatory), each a separate LLM call returning structured JSON. Separate
   calls matter: one combined prompt can average away a single high-risk
   signal, and the eval cases are built to catch that.
5. **Consolidation** takes the *worst* branch, never an average, and lists
   every branch's finding for the reviewer.
6. **Oversight scoring** decides how much human review the action needs.
7. **Human decision.** The reviewer picks bind or refer and must give a
   rationale in the UI.
8. **Signed audit record.** The decision is appended to an HMAC-SHA256
   ledger (stakeholder, decision, rationale, risk score, timestamp).

The agent pipeline is built on [Lár](https://github.com/snath-ai/lar), my own
open-source agent framework.

## Run it

Needs Python 3.10+, Node 20+, and [Ollama](https://ollama.com) with the model
pulled (`ollama pull qwen2.5:14b`).

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# three terminals
cd app/agent-api && uvicorn main:app --port 8010
cd app/backend   && npm ci && npm run dev
cd app/frontend  && npm ci && npm run dev      # http://localhost:5173
```

Configuration is by environment variable; see `.env.example`.
`requirements.txt` installs Lár from a pinned GitHub commit, because the
latest PyPI release (2.1.0) predates the guard and human-decision APIs used
here.

## Evaluation

`eval/` runs the same 10 labelled cases (`eval/cases.json`) through two
implementations of the identical pipeline on the same local model:
`eval/lar_agent` (Lár) and `eval/langchain_agent` (LangChain/LangGraph, with
the compliance layer hand-written). `eval/SPEC.md` is the contract both
follow.

| | Lár | LangChain/LangGraph |
|---|---|---|
| Decision accuracy | 10/10 | 10/10 |
| False negatives (REFER called BIND) | 0 | 0 |
| Severity tier exactly right | 7-8/10 across runs | 7/10 |
| Lines of code | 404 | 522 (188 of them hand-written compliance logic) |

```bash
cd eval/lar_agent && python run_eval.py
cd eval/langchain_agent && python eval_harness.py
```

The decision metric is the one that matters here, since a missed high-risk
submission is the expensive failure. The severity misses are over- or
under-calls by one tier (HIGH vs CRITICAL) that never flipped a final
decision in these runs. That is a statement about these runs, not a
guarantee. Build notes and full output: `eval/lar_agent/NOTES.md`,
`eval/langchain_agent/NOTES.md`.

## Design decisions worth knowing

- **The browser never supplies the evidence.** `/assess` stores the model's
  findings server-side and returns an `assessment_id`; `/assess/decide`
  accepts only that id, the decision and the rationale. A caller cannot sign
  fabricated evidence into the ledger, and each assessment can be decided once.
- **Upstream failures surface as errors**, not blank pages: 502 when the agent
  API is down, 404 for an unknown or already-decided assessment, and a banner
  in the UI.
- **Blocked and rejected submissions** return their own status and never reach
  the decision step.

## Known limitations

- The injection guard is a fixed list of known phrases. A paraphrased attack
  that avoids all of them is not caught (tested; see `eval/` and the v1 repo).
- PII redaction is regex only (PPSN, phone, email). Names and street addresses
  need a real NER detector. The executor also snapshots full state into its
  signed run logs, so unredacted text can still reach those logs (documented in
  `eval/lar_agent/NOTES.md`).
- Pending assessments live in memory and are lost on restart.
- The reviewer identity is a fixed placeholder; there is no authentication.
- The default signing key is a public dev key. Set `TRIAGE_HMAC_SECRET`.
- Everything runs locally against Ollama. No cloud deployment yet.

## Earlier version

[`marsh-risk-triage-agent`](https://github.com/axdithyaxo/marsh-risk-triage-agent)
is the first, single-agent version of this idea.
