import express, { Request, Response } from "express";

export const assessRouter = express.Router();

// Where the Python FastAPI service is running.
const AGENT_API = process.env.AGENT_API_URL ?? "http://localhost:8010";

// TypeScript interfaces describing the SHAPE of what we send/receive.
// These don't exist at runtime (TS erases them when compiling to JS) —
// they're purely a compile-time check that you're using the data
// correctly, e.g. that you don't typo `.sumbission` and only find out
// when it silently sends `undefined`.
interface AssessBody {
  submission?: string;
}

// POST /api/assess — phase 1: run the risk analysis, do NOT decide
// bind/refer. That decision is made by a human later, via /decide.
assessRouter.post("/assess", async (req: Request<{}, {}, AssessBody>, res: Response) => {
  const submission = req.body.submission;

  if (!submission || !submission.trim()) {
    return res.status(400).json({ error: "submission is required" });
  }

  try {
    // fetch() is built into Node (has been since Node 18) — no extra
    // package needed, unlike a few years ago.
    const agentRes = await fetch(`${AGENT_API}/assess`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ submission }),
    });

    if (!agentRes.ok) {
      // The Python side is unreachable or itself errored — a 502 ("Bad
      // Gateway") correctly tells the frontend "the thing we proxy to
      // failed", not "you sent us something wrong" (that would be a 400).
      return res.status(502).json({ error: "agent API request failed" });
    }

    const result = await agentRes.json();
    res.json(result);
  } catch (err) {
    // err is `unknown` in TypeScript (as of a few versions back) — you
    // can't assume it has a `.message` without checking, because
    // anything can theoretically be thrown, not just an Error object.
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `could not reach agent API: ${message}` });
  }
});

// The client sends only WHICH assessment it is deciding on and what it
// decided. The model's findings and confidence never travel back from the
// browser: the agent API stored them at /assess time, so a caller can't sign
// fabricated evidence into the audit ledger.
interface DecideBody {
  assessment_id?: string;
  decision?: string;
  rationale?: string;
}

// POST /api/assess/decide — phase 2: carries the REAL human decision
// (made in the browser) through to the signed audit ledger.
assessRouter.post("/assess/decide", async (req: Request<{}, {}, DecideBody>, res: Response) => {
  const { assessment_id, decision, rationale } = req.body;
  if (!assessment_id) {
    return res.status(400).json({ error: "assessment_id is required" });
  }
  if (decision !== "bind" && decision !== "refer") {
    return res.status(400).json({ error: "decision must be 'bind' or 'refer'" });
  }
  if (!rationale || !rationale.trim()) {
    return res.status(400).json({ error: "rationale is required" });
  }

  try {
    const agentRes = await fetch(`${AGENT_API}/assess/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assessment_id, decision, rationale }),
    });
    if (agentRes.status === 404) {
      // Unknown or already-decided assessment: the caller's problem, not a
      // gateway failure, so don't disguise it as a 502.
      return res.status(404).json({ error: "unknown or already-decided assessment" });
    }
    if (!agentRes.ok) {
      return res.status(502).json({ error: "agent API request failed" });
    }
    res.json(await agentRes.json());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `could not reach agent API: ${message}` });
  }
});
