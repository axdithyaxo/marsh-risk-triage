import { randomUUID } from "node:crypto";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import type { Deps } from "../deps.js";
import { requireRole } from "../middleware.js";
import { toView, type AssessmentRow } from "../views.js";
import { parseBody, sendAgentError } from "./http.js";

const MAX_SUBMISSION = 20_000;

const AssessBody = z.object({
  submission: z.string().trim().min(1, "submission is required").max(MAX_SUBMISSION, `submission must be at most ${MAX_SUBMISSION} characters`),
});

// The decision is made by a person; the server only needs to know which
// assessment, what they chose, and why. The model's findings and confidence
// never travel back from the browser: they come from our own database, signed
// by the agent service, so a caller can't put fabricated evidence in the audit log.
const DecideBody = z.object({
  assessment_id: z.string().min(1, "assessment_id is required").max(64),
  decision: z.enum(["bind", "refer"], { message: "decision must be 'bind' or 'refer'" }),
  rationale: z.string().trim().min(1, "rationale is required").max(2000, "rationale must be at most 2000 characters"),
});

export function createAssessRouter({ config, db, logger, agent }: Deps) {
  const router = Router();
  const underwriters = requireRole("underwriter");

  // Each assessment costs several LLM calls, so cap them per user.
  const assessLimit = rateLimit({
    windowMs: 3_600_000,
    limit: config.ASSESS_RATE_PER_HOUR,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id ?? "anonymous",
    handler: (_req, res) => void res.status(429).json({ error: "assessment limit reached, try again later" }),
  });

  router.post("/assess", underwriters, assessLimit, async (req, res) => {
    const body = parseBody(AssessBody, req.body, res);
    if (!body) return;

    let result: any;
    try {
      result = await agent.assess(body.submission, String(req.id));
    } catch (err) {
      return sendAgentError(err, res, logger);
    }

    const now = new Date().toISOString();
    if (result.status !== "needs_review") {
      // Blocked / rejected attempts are kept too: an injection attempt is a signal worth seeing.
      const status = result.status === "blocked" ? "blocked" : "rejected";
      if (result.status === "blocked" || result.status === "rejected_at_intake") {
        db.prepare("INSERT INTO assessments (id, user_id, status, created_at, reason) VALUES (?, ?, ?, ?, ?)").run(
          randomUUID(), req.user!.id, status, now, String(result.reason ?? "").slice(0, 500),
        );
      }
      return void res.json({ status: result.status, reason: result.reason });
    }

    db.prepare(
      `INSERT INTO assessments (id, user_id, status, created_at, submission_redacted, submission_sha256, evidence_json, evidence_signature)
       VALUES (?, ?, 'needs_review', ?, ?, ?, ?, ?)`,
    ).run(
      result.assessment_id, req.user!.id, now, result.submission_redacted ?? null, result.submission_sha256,
      JSON.stringify(result.evidence), result.evidence_signature,
    );
    const row = db.prepare("SELECT * FROM assessments WHERE id = ?").get(result.assessment_id) as AssessmentRow;
    res.json({ ...toView(row), status: "needs_review", elapsed_seconds: result.elapsed_seconds });
  });

  router.post("/assess/decide", underwriters, async (req, res) => {
    const body = parseBody(DecideBody, req.body, res);
    if (!body) return;

    const row = db.prepare("SELECT * FROM assessments WHERE id = ?").get(body.assessment_id) as AssessmentRow | undefined;
    if (!row) return void res.status(404).json({ error: "unknown assessment" });
    if (row.status !== "needs_review") return void res.status(409).json({ error: "this assessment has already been decided" });

    let decided: any;
    try {
      decided = await agent.decide(
        {
          assessment_id: row.id,
          submission_sha256: row.submission_sha256,
          evidence: JSON.parse(row.evidence_json!),
          evidence_signature: row.evidence_signature,
          decision: body.decision,
          rationale: body.rationale,
          decided_by: { id: req.user!.id, role: req.user!.role },
          assessed_by: row.user_id,
        },
        String(req.id),
      );
    } catch (err) {
      return sendAgentError(err, res, logger);
    }

    // The audit log is the source of truth for what was decided; this row is
    // the app's convenience copy. Compare-and-set on status so a duplicate
    // that somehow got past the agent can't overwrite the first decision.
    const updated = db
      .prepare(
        `UPDATE assessments SET status = 'decided', decision = ?, rationale = ?, decided_by = ?, decided_at = ?,
                audit_seq = ?, audit_entry_hash = ? WHERE id = ? AND status = 'needs_review'`,
      )
      .run(body.decision, body.rationale, req.user!.id, new Date().toISOString(), decided.audit_entry.seq, decided.audit_entry.entry_hash, row.id);
    if (updated.changes !== 1) logger.error({ assessment_id: row.id }, "decision recorded in audit log but app row was not updated");

    logger.info({ assessment_id: row.id, user_id: req.user!.id, decision: body.decision, seq: decided.audit_entry.seq }, "decision");
    res.json({
      status: "decided",
      final_decision: decided.final_decision,
      computed_oversight_level: decided.computed_oversight_level,
      audit_entry: decided.audit_entry,
    });
  });

  return router;
}
